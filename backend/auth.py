"""Users, roles, passwords and sessions (standard library only)."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from typing import Any

from .db import ROLES, BusyError, Database, ReadOnlyError, now

PBKDF2_ROUNDS = 200_000


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return digest.hex(), salt


def check_password(password: str, pw_hash: str, salt: str) -> bool:
    calc, _ = hash_password(password, salt)
    return hmac.compare_digest(calc, pw_hash or "")


def public_user(row: Any) -> dict[str, Any]:
    d = dict(row)
    return {
        "username": d["username"], "display": d["display"], "role": d["role"],
        "sections": json.loads(d["sections"] or '["*"]'), "active": bool(d["active"]),
        "must_change": bool(d["must_change"]), "created_at": d["created_at"], "last_login": d["last_login"],
    }


class Auth:
    def __init__(self, db: Database, sessions: Database | None = None):
        """`db` holds the accounts (shared or local); `sessions` the sign-ins of this computer."""
        self.db = db
        self.sessions = sessions or db
        if not db.readonly and not db.q("SELECT 1 FROM users LIMIT 1"):
            self.create_user({"username": "admin", "display": "Administrator", "role": "admin",
                              "password": "admin", "must_change": True}, actor="system")

    # ---------------------------------------------------------------- users
    def list_users(self) -> list[dict[str, Any]]:
        return [public_user(r) for r in self.db.q("SELECT * FROM users ORDER BY username")]

    def get_user(self, username: str) -> dict[str, Any] | None:
        rows = self.db.q("SELECT * FROM users WHERE username=?", (username,))
        return public_user(rows[0]) if rows else None

    def create_user(self, data: dict[str, Any], actor: str) -> dict[str, Any]:
        username = str(data.get("username") or "").strip().lower()
        if not username or not username.replace(".", "").replace("_", "").replace("-", "").isalnum():
            raise ValueError("invalid username")
        if self.get_user(username):
            raise ValueError("user exists")
        role = data.get("role") or "viewer"
        if role not in ROLES:
            raise ValueError("invalid role")
        password = str(data.get("password") or "")
        if len(password) < 4:
            raise ValueError("password too short")
        pw_hash, salt = hash_password(password)
        with self.db.tx(actor) as c:
            c.execute(
                "INSERT INTO users(username,display,role,sections,pw_hash,pw_salt,active,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (username, data.get("display") or username, role, json.dumps(data.get("sections") or ["*"]),
                 pw_hash, salt, 1, 1 if data.get("must_change", True) else 0, now()),
            )
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), actor, "admin", username, "user-create", f"{username} ({role})"),
            )
        return self.get_user(username)  # type: ignore[return-value]

    def update_user(self, username: str, data: dict[str, Any], actor: str) -> dict[str, Any]:
        user = self.get_user(username)
        if not user:
            raise KeyError(username)
        fields, args, changed = [], [], []
        if "display" in data:
            fields.append("display=?"); args.append(str(data["display"])); changed.append("display")
        if "role" in data:
            if data["role"] not in ROLES:
                raise ValueError("invalid role")
            if user["role"] == "admin" and data["role"] != "admin" and self._admin_count() <= 1:
                raise ValueError("last admin")
            fields.append("role=?"); args.append(data["role"]); changed.append("role")
        if "sections" in data:
            fields.append("sections=?"); args.append(json.dumps(list(data["sections"]) or ["*"])); changed.append("sections")
        if "active" in data:
            if not data["active"] and user["role"] == "admin" and self._admin_count() <= 1:
                raise ValueError("last admin")
            fields.append("active=?"); args.append(1 if data["active"] else 0); changed.append("active")
        if data.get("password"):
            if len(str(data["password"])) < 4:
                raise ValueError("password too short")
            h, s = hash_password(str(data["password"]))
            fields += ["pw_hash=?", "pw_salt=?", "must_change=?"]
            args += [h, s, 1 if data.get("must_change", actor != username) else 0]
            changed.append("password")
        if not fields:
            return user
        with self.db.tx(actor) as c:
            c.execute(f"UPDATE users SET {', '.join(fields)} WHERE username=?", (*args, username))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), actor, "admin", username, "user-update", ", ".join(changed)),
            )
        if "active" in changed and not data.get("active", True):
            self.drop_sessions(username)
        return self.get_user(username)  # type: ignore[return-value]

    def delete_user(self, username: str, actor: str) -> None:
        user = self.get_user(username)
        if not user:
            raise KeyError(username)
        if user["role"] == "admin" and self._admin_count() <= 1:
            raise ValueError("last admin")
        if username == actor:
            raise ValueError("cannot delete yourself")
        with self.db.tx(actor) as c:
            c.execute("DELETE FROM users WHERE username=?", (username,))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), actor, "admin", username, "user-delete", username),
            )
        self.drop_sessions(username)

    def reset_password(self, username: str, password: str, actor: str = "recovery") -> dict[str, Any]:
        """Emergency access from the machine that holds the database (console / reset-parola.bat).

        Sets a new password, re-enables the account, ends its open sessions and asks for a new
        password at the next login. An unknown name creates a new administrator, so a lost or
        renamed admin account can always be replaced.
        """
        username = str(username or "").strip().lower()
        if len(str(password or "")) < 4:
            raise ValueError("password too short")
        if not self.get_user(username):
            created = self.create_user({"username": username, "display": username, "role": "admin",
                                        "password": password, "must_change": True}, actor=actor)
            return created
        pw_hash, salt = hash_password(str(password))
        with self.db.tx(actor) as c:
            c.execute("UPDATE users SET pw_hash=?, pw_salt=?, active=1, must_change=1 WHERE username=?",
                      (pw_hash, salt, username))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), actor, "admin", username, "password-reset", f"{username}: password reset, account active"),
            )
        self.drop_sessions(username)
        return self.get_user(username)  # type: ignore[return-value]

    def _admin_count(self) -> int:
        return self.db.q("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1")[0]["n"]

    # -------------------------------------------------------------- sessions
    def login(self, username: str, password: str) -> tuple[str, dict[str, Any]] | None:
        rows = self.db.q("SELECT * FROM users WHERE username=?", (str(username).strip().lower(),))
        if not rows or not rows[0]["active"]:
            return None
        if not check_password(password, rows[0]["pw_hash"], rows[0]["pw_salt"]):
            return None
        token = secrets.token_urlsafe(32)
        with self.sessions.tx() as c:
            c.execute("INSERT INTO sessions VALUES(?,?,?,?)", (token, rows[0]["username"], now(), now()))
        try:
            with self.db.tx(rows[0]["username"]) as c:
                c.execute("UPDATE users SET last_login=? WHERE username=?", (now(), rows[0]["username"]))
        except (ReadOnlyError, BusyError):
            pass  # read-only on the local copy: signing in still works
        return token, public_user(self.db.q("SELECT * FROM users WHERE username=?", (rows[0]["username"],))[0])

    def logout(self, token: str) -> None:
        with self.sessions.tx() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (token,))

    def drop_sessions(self, username: str | None = None) -> None:
        """End the sign-ins on this computer: of one user, or all (after switching the data folder)."""
        with self.sessions.tx() as c:
            if username is None:
                c.execute("DELETE FROM sessions")
            else:
                c.execute("DELETE FROM sessions WHERE username=?", (username,))

    def idle_seconds(self) -> float:
        try:
            minutes = float(self.db.get_settings().get("session_idle_minutes") or 30)
        except (TypeError, ValueError):
            minutes = 30
        return max(5.0, minutes) * 60

    def user_for_token(self, token: str | None, touch: bool = True) -> dict[str, Any] | None:
        """The signed-in user. `touch=False` for background polling, which must not count as activity."""
        if not token:
            return None
        rows = self.sessions.q("SELECT * FROM sessions WHERE token=?", (token,))
        if not rows:
            return None
        if now() - rows[0]["last_seen"] > self.idle_seconds():
            self.logout(token)
            return None
        user = self.get_user(rows[0]["username"])
        if not user or not user["active"]:
            return None
        if touch:
            with self.sessions.tx() as c:
                c.execute("UPDATE sessions SET last_seen=? WHERE token=?", (now(), token))
        return user

    def active_users(self) -> list[str]:
        """Users signed in on this computer and active in the idle window."""
        rows = self.sessions.q("SELECT DISTINCT username FROM sessions WHERE last_seen>?", (now() - self.idle_seconds(),))
        return sorted(r["username"] for r in rows)

    @staticmethod
    def can(user: dict[str, Any], section: str, write: bool = False) -> bool:
        if user["role"] == "admin":
            return True
        if write and user["role"] == "viewer":
            return False
        allowed = user.get("sections") or ["*"]
        return "*" in allowed or section in allowed
