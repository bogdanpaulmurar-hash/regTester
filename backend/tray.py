"""System tray icon (Windows notification area) using pystray + Pillow.

Both packages are optional: without them regTester runs as a plain local
server and the log says the tray is unavailable.
"""
from __future__ import annotations

import logging
import webbrowser
from typing import Callable

LOG = logging.getLogger("regtester.tray")

try:  # optional dependencies
    import pystray  # type: ignore
    from PIL import Image  # type: ignore
    AVAILABLE = True
except Exception:  # noqa: BLE001
    AVAILABLE = False


class Tray:
    def __init__(self, ctx, url: str, on_quit: Callable[[], None]):
        self.ctx = ctx
        self.url = url
        self.on_quit = on_quit
        self.icon = None

    def _image(self):
        img = Image.open(self.ctx.logo_path).convert("RGBA")
        img.thumbnail((64, 64))
        return img

    def _label(self) -> str:
        return self.ctx.db.get_settings().get("app_name") or "regTester"

    def run(self):
        """Blocks on the main thread until Quit is chosen."""
        menu = pystray.Menu(
            pystray.MenuItem("Open", lambda: webbrowser.open(self.url), default=True),
            pystray.MenuItem("Timeline", lambda: webbrowser.open(self.url + "#/timeline")),
            pystray.MenuItem("Specifications", lambda: webbrowser.open(self.url + "#/specs")),
            pystray.MenuItem("Settings", lambda: webbrowser.open(self.url + "#/settings")),
            pystray.MenuItem("Log", lambda: webbrowser.open(self.url + "#/logs")),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )
        self.icon = pystray.Icon("regTester", self._image(), self._label(), menu)
        self.ctx.on_logo_changed = self.refresh
        self.ctx.on_quit = self._quit
        LOG.info("Tray icon started")
        self.icon.run()

    def refresh(self):
        if self.icon:
            self.icon.icon = self._image()
            self.icon.title = self._label()

    def _quit(self, *_):
        LOG.info("Quit from tray")
        if self.icon:
            self.icon.stop()
        self.on_quit()
