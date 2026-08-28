#!/usr/bin/env python3
"""Rasterise the Harborlight mark into the PNG sizes packaging needs.

The mark is described once here in the same 32x32 coordinate space as
`resources/icons/harborlight.svg` and `src/renderer/components/layout/Logo.tsx`,
so the desktop icon, the tray icon and the in-app logo cannot drift apart.

Run `make icons` after changing the mark. Pillow is the only dependency; the
generated files are committed so packaging never needs Python.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("Pillow is required: python3 -m pip install --user Pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "resources" / "icons"
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)

# Supersampling factor: draw large, then downscale for antialiasing.
SCALE = 8
BASE = 32

GRADIENT_START = (255, 138, 61)
GRADIENT_MID = (240, 78, 35)
GRADIENT_END = (216, 52, 26)
LAMP_ORANGE = (240, 78, 35)


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def diagonal_gradient(size: int) -> Image.Image:
    """Top-left to bottom-right gradient matching the SVG linearGradient."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            if t <= 0.55:
                colour = lerp(GRADIENT_START, GRADIENT_MID, t / 0.55)
            else:
                colour = lerp(GRADIENT_MID, GRADIENT_END, (t - 0.55) / 0.45)
            pixels[x, y] = colour
    return image


def draw_mark(size: int) -> Image.Image:
    """Draws the mark at `size` pixels using the 32-unit design grid."""
    unit = size / BASE

    def u(value: float) -> float:
        return value * unit

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (u(1), u(1), u(31), u(31)), radius=u(9), fill=255
    )
    canvas.paste(diagonal_gradient(size), (0, 0), mask)

    draw = ImageDraw.Draw(canvas, "RGBA")
    white = (255, 255, 255, 242)

    # Lantern room: a rounded cap sitting on the tower.
    draw.rounded_rectangle((u(12.6), u(6.4), u(19.4), u(11.5)), radius=u(3.4), fill=white)
    draw.rectangle((u(12.6), u(9.6), u(19.4), u(11.5)), fill=white)

    # Tower: slightly wider at the base, with a rounded footing.
    draw.polygon(
        [
            (u(12.3), u(12.4)),
            (u(19.7), u(12.4)),
            (u(21.2), u(25.4)),
            (u(20.5), u(26.1)),
            (u(11.5), u(26.1)),
            (u(10.8), u(25.4)),
        ],
        fill=white,
    )

    # Window band in the brand orange.
    draw.polygon(
        [(u(13.9), u(16.2)), (u(18.1), u(16.2)), (u(18.4), u(19.2)), (u(13.6), u(19.2))],
        fill=(*LAMP_ORANGE, 217),
    )

    # Light beams.
    beam = (255, 255, 255, 178)
    width = max(1, round(u(1.6)))
    draw.line([(u(9.4), u(9.6)), (u(6.0), u(8.1))], fill=beam, width=width)
    draw.line([(u(22.6), u(9.6)), (u(26.0), u(8.1))], fill=beam, width=width)

    return canvas


def draw_tray_glyph(size: int, colour: tuple[int, int, int]) -> Image.Image:
    """Flat single-colour lighthouse for the system tray.

    Panel icons must read at 22px against an unknown background, so the tray
    variant drops the gradient and the plate and keeps only the silhouette.
    """
    unit = size / BASE

    def u(value: float) -> float:
        return value * unit

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas, "RGBA")
    solid = (*colour, 255)

    draw.rounded_rectangle((u(11.6), u(4.6), u(20.4), u(11.0)), radius=u(4.4), fill=solid)
    draw.rectangle((u(11.6), u(8.4), u(20.4), u(11.0)), fill=solid)
    draw.polygon(
        [
            (u(11.2), u(12.0)),
            (u(20.8), u(12.0)),
            (u(22.6), u(26.4)),
            (u(21.8), u(27.2)),
            (u(10.2), u(27.2)),
            (u(9.4), u(26.4)),
        ],
        fill=solid,
    )
    # Knock the window out so the shape stays legible when it is one colour.
    draw.polygon(
        [(u(13.6), u(16.0)), (u(18.4), u(16.0)), (u(18.8), u(19.6)), (u(13.2), u(19.6))],
        fill=(0, 0, 0, 0),
    )
    width = max(1, round(u(1.8)))
    draw.line([(u(8.6), u(9.2)), (u(4.6), u(7.4))], fill=solid, width=width)
    draw.line([(u(23.4), u(9.2)), (u(27.4), u(7.4))], fill=solid, width=width)
    return canvas


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_mark(BASE * SCALE)

    for size in SIZES:
        icon = master.resize((size, size), Image.LANCZOS)
        icon.save(OUT_DIR / f"{size}x{size}.png")
        print(f"wrote {OUT_DIR.relative_to(ROOT)}/{size}x{size}.png")

    # electron-builder uses `icon.png` as the application icon.
    master.resize((512, 512), Image.LANCZOS).save(OUT_DIR / "icon.png")

    # `tray-dark.png` is the dark glyph shown on light panels, and vice versa.
    for name, colour in (("tray-dark", (32, 30, 29)), ("tray-light", (245, 243, 242))):
        glyph = draw_tray_glyph(BASE * SCALE, colour)
        glyph.resize((22, 22), Image.LANCZOS).save(OUT_DIR / f"{name}.png")
        glyph.resize((44, 44), Image.LANCZOS).save(OUT_DIR / f"{name}@2x.png")
        print(f"wrote {name}.png and {name}@2x.png")

    print("wrote icon.png")


if __name__ == "__main__":
    main()
