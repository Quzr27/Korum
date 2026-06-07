#!/usr/bin/env python3
"""Generate the Korum DMG installer background.

The image is sized to match the default Tauri DMG window (660x400) with the
default icon positions (app at 180,170 and the Applications link at 480,170).
Providing a background also makes the bundler reposition hidden files such as
`.VolumeIcon.icns` off-screen, so they no longer appear in the installer window.

Run from anywhere:  python3 src-tauri/dmg/generate-background.py
Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 660, 400
APP_X, APP_Y = 180, 170          # icon centers, must match tauri.conf.json
APPLICATIONS_X = 480

# Brand palette (from the app theme)
BG_TOP = (13, 14, 16)            # #0d0e10
BG_BOTTOM = (9, 9, 11)           # #09090b
ACCENT = (94, 146, 255)          # #5e92ff
FG = (239, 238, 232)             # #efeee8
MUTED = (142, 138, 128)          # #8e8a80
ARROW = (74, 78, 86)             # subtle, between border and muted

OUT = Path(__file__).resolve().parent / "background.png"

FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def vertical_gradient(size, top, bottom):
    w, h = size
    base = Image.new("RGB", size, top)
    px = base.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = round(top[0] + (bottom[0] - top[0]) * t)
        g = round(top[1] + (bottom[1] - top[1]) * t)
        b = round(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return base


def radial_glow(size, center, radius, color, max_alpha):
    """Soft circular glow rendered onto a transparent layer."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    px = layer.load()
    cx, cy = center
    for y in range(h):
        for x in range(w):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d >= radius:
                continue
            a = max_alpha * (1 - d / radius) ** 2
            px[x, y] = (color[0], color[1], color[2], round(a))
    return layer


def draw_arrow(draw, x0, x1, y, color, width=3):
    draw.line([(x0, y), (x1, y)], fill=color, width=width)
    head = 9
    draw.line([(x1 - head, y - head), (x1, y)], fill=color, width=width)
    draw.line([(x1 - head, y + head), (x1, y)], fill=color, width=width)


def centered_text(draw, cx, y, text, font, fill):
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (box[2] - box[0]) / 2, y), text, font=font, fill=fill)


def main():
    img = vertical_gradient((W, H), BG_TOP, BG_BOTTOM).convert("RGBA")
    img.alpha_composite(radial_glow((W, H), (W // 2, APP_Y), 320, ACCENT, 26))

    draw = ImageDraw.Draw(img)

    title_font = load_font(30)
    hint_font = load_font(15)

    centered_text(draw, W // 2, 54, "Install Korum", title_font, FG)

    # Arrow from the app icon toward the Applications folder.
    draw_arrow(draw, APP_X + 84, APPLICATIONS_X - 84, APP_Y, ARROW)

    centered_text(
        draw,
        W // 2,
        330,
        "Drag Korum onto the Applications folder",
        hint_font,
        MUTED,
    )

    img.convert("RGB").save(OUT, "PNG")
    print(f"Wrote {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
