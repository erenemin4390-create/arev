from pathlib import Path
from PIL import Image

source = Image.open(Path(__file__).parents[1] / "assets/images/icon.png").convert("RGBA")
out = Path(__file__).parents[1] / "public"
for size in (192, 512):
    source.resize((size, size), Image.Resampling.LANCZOS).save(out / f"icon-{size}.png", optimize=True)
