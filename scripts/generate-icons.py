#!/usr/bin/env python3
"""Generate favicon.ico and apple-touch-icon.png from CloudSeed brand colors."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (59, 108, 244)
ACCENT_LIGHT = (79, 125, 248)
ACCENT_DARK = (43, 92, 230)
WHITE = (255, 255, 255)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_background(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.21875)
    for y in range(size):
        t = y / max(size - 1, 1)
        color = (
            lerp(ACCENT_LIGHT[0], ACCENT_DARK[0], t),
            lerp(ACCENT_LIGHT[1], ACCENT_DARK[1], t),
            lerp(ACCENT_LIGHT[2], ACCENT_DARK[2], t),
            255,
        )
        draw.line([(0, y), (size, y)], fill=color)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    img.putalpha(mask)
    return img


def draw_cloud(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float) -> None:
    s = scale
    blobs = [
        (cx - 12 * s, cy - 2 * s, cx + 12 * s, cy + 26 * s),
        (cx + 4 * s, cy - 8 * s, cx + 48 * s, cy + 28 * s),
        (cx + 32 * s, cy - 2 * s, cx + 64 * s, cy + 24 * s),
    ]
    for box in blobs:
        draw.ellipse(box, fill=WHITE)
    draw.rounded_rectangle(
        (cx - 28 * s, cy + 8 * s, cx + 68 * s, cy + 36 * s),
        radius=int(12 * s),
        fill=WHITE,
    )


def draw_download(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float) -> None:
    s = scale
    width = max(int(4 * s), 2)
    shaft_top = cy + 18 * s
    shaft_bottom = cy + 44 * s
    draw.line([(cx, shaft_top), (cx, shaft_bottom)], fill=WHITE, width=width)
    arrow = [
        (cx - 12 * s, cy + 32 * s),
        (cx, cy + 46 * s),
        (cx + 12 * s, cy + 32 * s),
    ]
    draw.line(arrow, fill=WHITE, width=width, joint="curve")
    r = max(int(3 * s), 2)
    draw.ellipse((cx - r, cy + 48 * s - r, cx + r, cy + 48 * s + r), fill=WHITE)


def render_icon(size: int) -> Image.Image:
    img = gradient_background(size)
    draw = ImageDraw.Draw(img)
    scale = size / 128.0
    draw_cloud(draw, 20 * scale, 34 * scale, scale)
    draw_download(draw, 64 * scale, 34 * scale, scale)
    return img


def save_ico(path: Path, sizes: list[int]) -> None:
    """Write a multi-resolution .ico (Pillow downscales from the largest frame)."""
    master = render_icon(max(sizes)).convert("RGBA")
    master.save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
    )


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    static_root = root / "web" / "public_html"
    out_dir = static_root / "images"
    out_dir.mkdir(parents=True, exist_ok=True)

    touch = render_icon(180)
    touch.save(out_dir / "apple-touch-icon.png", format="PNG")

    ico_sizes = [16, 32, 48, 64, 128, 256]
    for dest in (out_dir / "favicon.ico", static_root / "favicon.ico"):
        save_ico(dest, ico_sizes)

    print(f"Wrote icons to {out_dir} and {static_root / 'favicon.ico'}")


if __name__ == "__main__":
    main()
