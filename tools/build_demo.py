"""Copy the web UI into demo-build/ as a page that runs without the server (demo mode).

    python tools/build_demo.py
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "web", ROOT / "demo-build"


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(SRC, OUT, ignore=shutil.ignore_patterns("sw.js", "manifest.webmanifest"))
    html = (SRC / "index.html").read_text(encoding="utf-8")
    html = re.sub(r"<!doctype html>|</?html[^>]*>|</?head>|</?body>", "", html, flags=re.I)
    html = re.sub(r'<meta charset[^>]*>\n|<meta name="viewport"[^>]*>\n|<link rel="manifest"[^>]*>\n', "", html)
    html = html.replace("<title>regTester</title>", "<title>regTester Demo</title>")
    (OUT / "index.html").write_text(html.strip() + "\n", encoding="utf-8")
    print("Demo page written to", OUT)


if __name__ == "__main__":
    main()
