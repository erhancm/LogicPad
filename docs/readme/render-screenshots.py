"""Render README app tab PNGs via Edge headless."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EDGE64 = Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

PAGES = [
    ("app-keys.html", "app-keys.png"),
    ("app-profiles.html", "app-profiles.png"),
    ("app-auto-switch.html", "app-auto-switch.png"),
]


def edge_path() -> Path:
    for p in (EDGE64, EDGE):
        if p.exists():
            return p
    raise SystemExit("Microsoft Edge not found")


def capture(html: Path, out: Path) -> None:
    cmd = [
        str(edge_path()),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=960,600",
        f"--screenshot={out}",
        html.as_uri(),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout or "screenshot failed")


def main() -> None:
    for html_name, png_name in PAGES:
        html = ROOT / html_name
        out = ROOT / png_name
        if not html.exists():
            raise SystemExit(f"Missing {html}")
        capture(html, out)
        print(f"Wrote {out}")


if __name__ == "__main__":
    main()
