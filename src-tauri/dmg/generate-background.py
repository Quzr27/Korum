#!/usr/bin/env python3
"""Generate the Korum DMG installer background.

The image matches the Tauri DMG window (660x400) and the icon positions
declared in `tauri.conf.json` (app at 180,170 and the Applications link at
480,170, icon centers). It must stay exactly the window size — a wider image
makes Finder add a horizontal scrollbar. Providing a background also makes the
bundler reposition the hidden files (`.background`, `.VolumeIcon.icns`) just
past the window edge, so they don't appear in a normally-sized window (they are
only revealed if the user enables Finder's "show hidden files").

The look is intentionally restrained and "premium dev tool": a deep vertical
gradient, a soft brand-blue glow tracing the drag path, a faint canvas dot grid
(a nod to Korum's infinite canvas), film grain to kill banding, a motion arrow,
and a soft "drop target" halo around the Applications folder that echoes the
app's agent-status halo.

Run from anywhere:  python3 src-tauri/dmg/generate-background.py
Requires Pillow + numpy.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --- Geometry (must match tauri.conf.json) ----------------------------------
# The image MUST be exactly the DMG window size. A background wider than the
# window makes Finder show a horizontal scrollbar (you can scroll into empty
# space past the design), so keep this equal to `windowSize`.
W, H = 660, 400
APP = (180, 170)                 # app icon center
APPS = (480, 170)                # Applications link center
SS = 3                           # supersample factor for crisp vectors/text

# --- Brand palette (from the app theme) -------------------------------------
BG_TOP = (16, 18, 22)            # #101216
BG_BOTTOM = (7, 7, 9)            # #070709
ACCENT = (94, 146, 255)          # #5e92ff
ACCENT_SOFT = (120, 165, 255)    # lighter accent for highlights
FG = (242, 241, 236)             # #f2f1ec  warm white
MUTED = (139, 135, 128)          # #8b8780
DIM = (88, 92, 102)              # arrow / fine detail

HERE = Path(__file__).resolve().parent
OUT = HERE / "background.png"
CONF = HERE.parent / "tauri.conf.json"

FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size: int, weight: str | None = None) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, size)
            if weight:
                try:
                    font.set_variation_by_name(weight)
                except Exception:
                    pass
            return font
        except OSError:
            continue
    return ImageFont.load_default()


def app_version() -> str:
    try:
        return json.loads(CONF.read_text()).get("version", "")
    except Exception:
        return ""


# --- numpy atmosphere layer (final resolution) ------------------------------
def atmosphere() -> Image.Image:
    ys = np.linspace(0.0, 1.0, H)[:, None, None]

    top = np.array(BG_TOP, dtype=np.float32) / 255.0
    bot = np.array(BG_BOTTOM, dtype=np.float32) / 255.0
    img = top + (bot - top) * ys                       # vertical gradient
    img = np.repeat(img, W, axis=1)

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    accent = np.array(ACCENT, dtype=np.float32) / 255.0

    def glow(cx, cy, radius, amp):
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        g = np.exp(-d2 / (2.0 * radius ** 2)) * amp
        return g[:, :, None] * accent

    # Wide glow tracing the drag path, brightest under the app icon.
    img += glow(300, 168, 250, 0.18)
    img += glow(APP[0], APP[1], 130, 0.20)
    img += glow(APPS[0], APPS[1], 120, 0.12)

    # Vignette: darken toward the edges for focus.
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    vig = 1.0 - 0.26 * np.clip(nx * nx + ny * ny, 0.0, 1.0)
    img *= vig[:, :, None]

    # Faint canvas dot grid (Korum's infinite canvas), fading out at the edges.
    step = 22
    dot = np.zeros((H, W), dtype=np.float32)
    dot[step // 2 :: step, step // 2 :: step] = 1.0
    dotfade = np.clip(1.0 - (nx * nx + ny * ny) * 0.7, 0.0, 1.0)
    img += (dot * dotfade)[:, :, None] * accent * 0.06

    # Film grain to avoid banding on the dark gradient.
    rng = np.random.default_rng(0xC0FFEE)
    grain = rng.normal(0.0, 1.0, (H, W, 1)).astype(np.float32) * (3.5 / 255.0)
    img += grain

    img = np.clip(img, 0.0, 1.0)
    return Image.fromarray((img * 255.0 + 0.5).astype(np.uint8), "RGB")


# --- supersampled vector + text layer ---------------------------------------
def vectors() -> Image.Image:
    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    glow_layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    dg = ImageDraw.Draw(glow_layer)

    def s(v):  # scale a scalar
        return int(round(v * SS))

    def pt(x, y):
        return (x * SS, y * SS)

    # --- Drop-target halo around the Applications folder --------------------
    cx, cy = APPS
    for r, a in ((98, 40), (84, 110)):
        dg.ellipse(
            [pt(cx - r, cy - r), pt(cx + r, cy + r)],
            outline=ACCENT + (a,),
            width=s(1.5),
        )
    # faint inner fill
    rr = 84
    dg.ellipse([pt(cx - rr, cy - rr), pt(cx + rr, cy + rr)], fill=ACCENT + (22,))

    # --- Motion arrow along the drag path -----------------------------------
    y = APP[1]
    x_start, x_end = 268, 392          # between app icon edge and the halo
    # leading dots that ramp into the line
    for i, dx in enumerate((0, 11, 22)):
        a = 70 + i * 45
        rdot = 2.0
        d.ellipse(
            [pt(x_start - 30 + dx - rdot, y - rdot), pt(x_start - 30 + dx + rdot, y + rdot)],
            fill=ACCENT + (a,),
        )
    # soft underglow for the shaft
    dg.line([pt(x_start, y), pt(x_end, y)], fill=ACCENT + (90,), width=s(5))
    # crisp shaft + chevron head
    d.line([pt(x_start, y), pt(x_end, y)], fill=ACCENT_SOFT + (235,), width=s(2))
    head = 9
    d.line([pt(x_end - head, y - head), pt(x_end, y)], fill=ACCENT_SOFT + (235,), width=s(2))
    d.line([pt(x_end - head, y + head), pt(x_end, y)], fill=ACCENT_SOFT + (235,), width=s(2))

    # --- Typography ----------------------------------------------------------
    title_font = load_font(30 * SS, "Semibold")
    rule_y = 78

    def tracked(draw, cx, baseline_y, text, font, fill, tracking):
        widths = [draw.textlength(ch, font=font) for ch in text]
        total = sum(widths) + tracking * SS * (len(text) - 1)
        x = cx * SS - total / 2
        for ch, w in zip(text, widths):
            draw.text((x, baseline_y * SS), ch, font=font, fill=fill, anchor="ls")
            x += w + tracking * SS

    # Title sits above the icons.
    tracked(d, W // 2, 56, "Install Korum", title_font, FG + (255,), 1.2)

    # Short accent rule under the title.
    d.line([pt(W // 2 - 22, rule_y), pt(W // 2 + 22, rule_y)], fill=ACCENT + (210,), width=s(2))

    # Instruction under the icons / labels.
    hint_font = load_font(15 * SS)
    tracked(d, W // 2, 344, "Drag Korum into the Applications folder", hint_font, MUTED + (255,), 0.2)

    # Version tag, bottom-right.
    ver = app_version()
    if ver:
        ver_font = load_font(12 * SS)
        d.text((( W - 18) * SS, (H - 14) * SS), f"v{ver}", font=ver_font,
               fill=DIM + (200,), anchor="rs")

    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(2.5 * SS))
    out = Image.alpha_composite(glow_layer, layer)
    return out.resize((W, H), Image.LANCZOS)


def main() -> None:
    base = atmosphere().convert("RGBA")
    base.alpha_composite(vectors())
    base.convert("RGB").save(OUT, "PNG")
    print(f"Wrote {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
