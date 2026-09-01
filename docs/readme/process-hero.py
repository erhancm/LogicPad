"""Process hero photo for README: crop, enhance, composite on dark banner."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "hero-source.jpg"
OUT = ROOT / "hero.jpg"

# Manual crop tuned for the provided desk photo (473×1024 portrait).
CROP = (24, 72, 452, 990)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def make_canvas(w: int, h: int) -> Image.Image:
    canvas = Image.new("RGB", (w, h), "#0e1014")
    draw = ImageDraw.Draw(canvas)
    for y in range(h):
        t = y / max(h - 1, 1)
        c = lerp(0x0E, 0x16, t)
        draw.line([(0, y), (w, y)], fill=(c, c + 4, c + 10))
    # soft gold glow behind device
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    cx, cy = w // 2, int(h * 0.52)
    for r in range(280, 0, -4):
        alpha = int(18 * (1 - r / 280))
        g.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(240, 208, 96, alpha))
    canvas.paste(glow, (0, 0), glow)
    return canvas


def main() -> None:
    if not SRC.exists():
        # First run: copy raw upload if source missing
        raw = ROOT.parent.parent / ".cursor" / ".."  # unused fallback
        raise SystemExit(f"Missing source image: {SRC}")

    im = Image.open(SRC).convert("RGB")
    im = im.crop(CROP)

    # Exposure + color polish
    im = ImageEnhance.Brightness(im).enhance(1.06)
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Color(im).enhance(1.08)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=90, threshold=3))

    target_h = 520
    scale = target_h / im.height
    target_w = int(im.width * scale)
    im = im.resize((target_w, target_h), Image.Resampling.LANCZOS)

    pad = 48
    canvas_w = max(880, target_w + pad * 2)
    canvas_h = target_h + pad * 2
    canvas = make_canvas(canvas_w, canvas_h)

    # Drop shadow
    shadow = Image.new("RGBA", (target_w + 40, target_h + 40), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((20, 20, target_w + 20, target_h + 20), radius=18, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    sx = (canvas_w - target_w) // 2
    sy = (canvas_h - target_h) // 2 + 8
    canvas.paste(shadow, (sx - 20, sy - 12), shadow)

    canvas.paste(im, (sx, sy))

    canvas.save(OUT, "JPEG", quality=92, optimize=True, progressive=True)
    print(f"Wrote {OUT} ({canvas_w}x{canvas_h})")


if __name__ == "__main__":
    main()
