import glob
import io
import os
import re

import cairosvg
from PIL import Image

SIZES = [256, 128, 64, 48, 32, 16]

for svg_path in glob.glob("*.svg"):
    with open(svg_path, "r", encoding="utf-8") as f:
        svg = f.read()

    # Force white fill: set it on the root <svg> element so paths without an
    # explicit fill inherit it (default would otherwise be black).
    if "fill=" not in svg.split(">", 1)[0]:
        svg = re.sub(r"<svg\b", '<svg fill="#FFFFFF"', svg, count=1)

    # Render the largest size, then downscale for crisp smaller sizes.
    png_bytes = cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=256,
        output_height=256,
    )
    base = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    ico_path = os.path.splitext(svg_path)[0] + ".ico"
    base.save(ico_path, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"{svg_path} -> {ico_path}")
