"""Strip the light background from the user's HYPERTANGENT logo screenshot.

Approach: pixels near the sampled top-left background color become transparent.
Edges get a feather. Tight crop around remaining content. Output a clean PNG
with alpha channel suitable as a Three.js texture.
"""
from pathlib import Path

from PIL import Image, ImageFilter

SRC = Path(r"c:\Users\himanshu bhatt\Pictures\Screenshots\Screenshot 2026-06-29 215550.png")
DST = Path(r"D:\HYPERTANGENT\Truck simualtor\renderer\public\assets\logo.png")

# Background match tolerance in 0-255 channel units. The screenshot's bg is a
# pale blue ~ (230, 240, 250). 60 is forgiving but not too aggressive.
TOL = 60


def main():
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size

    # Sample several corners to determine background color.
    corners = [img.getpixel((1, 1)), img.getpixel((w - 2, 1)),
               img.getpixel((1, h - 2)), img.getpixel((w - 2, h - 2))]
    avg = tuple(int(sum(c[i] for c in corners) / len(corners)) for i in range(3))
    print(f"Sampled background: {avg}")

    pixels = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            dr = r - avg[0]
            dg = g - avg[1]
            db = b - avg[2]
            dist = (dr * dr + dg * dg + db * db) ** 0.5
            if dist < TOL:
                pixels[x, y] = (255, 255, 255, 0)
            else:
                # Light feather: closer-to-bg pixels get lower alpha.
                fade_start = TOL
                fade_end = TOL + 30
                if dist < fade_end:
                    alpha = int(255 * (dist - fade_start) / (fade_end - fade_start))
                    pixels[x, y] = (r, g, b, max(alpha, 32))
                # else fully opaque — keep as-is.

    # Crop to non-empty bounding box.
    bbox = img.getbbox()
    if bbox is None:
        raise SystemExit("Logo content not detected; tolerance too aggressive")
    img = img.crop(bbox)

    # Optional: small inner padding so the texture has clean borders.
    pad = 8
    padded = Image.new("RGBA", (img.size[0] + 2 * pad, img.size[1] + 2 * pad), (0, 0, 0, 0))
    padded.paste(img, (pad, pad), img)

    DST.parent.mkdir(parents=True, exist_ok=True)
    padded.save(DST, "PNG", optimize=True)
    print(f"Wrote {DST}  ({padded.size[0]}x{padded.size[1]})")


if __name__ == "__main__":
    main()
