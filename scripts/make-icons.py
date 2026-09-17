"""
Generates the application and file-association icons.

Kept as a script so the icons are reproducible rather than opaque binaries:
re-run `python scripts/make-icons.py` after changing the design.

The app mark is a marmalade jar: the product is named after the colour of a
highlighter stroke, and a warm orange blob is the one thing that stands out in a
taskbar otherwise full of blue-grey document icons. The gloss across the jar is
drawn as a diagonal swipe so it reads as a highlighter stroke as well.

Geometry is deliberately bold and low-detail, because the smallest ICO frame is
16x16 and fine strokes turn to mush at that size.
"""

from PIL import Image, ImageDraw

BASE = 1024
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]

INK = (26, 30, 42, 255)
PAGE = (252, 252, 252, 255)
LINE = (150, 157, 170, 255)

# Brand palette.
PLUM_TOP = (92, 46, 78, 255)
PLUM_BOTTOM = (48, 24, 44, 255)
MARMALADE = (243, 146, 33, 255)
MARMALADE_DEEP = (208, 98, 18, 255)
LID = (255, 201, 71, 255)
LID_DEEP = (226, 164, 40, 255)


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return img


def app_icon() -> Image.Image:
    """A marmalade jar on a rounded plum tile."""
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))

    tile_mask = Image.new("L", (BASE, BASE), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle(
        [0, 0, BASE - 1, BASE - 1], radius=int(BASE * 0.22), fill=255
    )
    img.paste(vertical_gradient(BASE, PLUM_TOP, PLUM_BOTTOM), (0, 0), tile_mask)

    def px(f: float) -> int:
        return int(BASE * f)

    # The jar is built on its own layer so the gloss can be masked to its body.
    jar = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    jd = ImageDraw.Draw(jar)

    body = [px(0.255), px(0.360), px(0.745), px(0.815)]
    neck = [px(0.330), px(0.268), px(0.670), px(0.395)]
    lid = [px(0.285), px(0.170), px(0.715), px(0.292)]

    jd.rounded_rectangle(neck, radius=px(0.030), fill=MARMALADE_DEEP)
    jd.rounded_rectangle(body, radius=px(0.105), fill=MARMALADE)

    # A darker foot so the jar has weight rather than reading as a flat square.
    foot = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    # Square-cornered on purpose: the rounding comes from the body mask below,
    # otherwise the base reads as a separate pill floating inside the jar.
    ImageDraw.Draw(foot).rectangle([body[0], px(0.640), body[2], body[3]], fill=MARMALADE_DEEP)
    body_mask = Image.new("L", (BASE, BASE), 0)
    ImageDraw.Draw(body_mask).rounded_rectangle(body, radius=px(0.105), fill=255)
    jar.paste(foot, (0, 0), Image.composite(foot.split()[3], Image.new("L", (BASE, BASE), 0), body_mask))

    # The gloss: a diagonal swipe, i.e. a highlighter stroke across the jar.
    gloss = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).polygon(
        [(px(0.30), px(0.60)), (px(0.62), px(0.36)), (px(0.72), px(0.36)), (px(0.40), px(0.60))],
        fill=(255, 255, 255, 96),
    )
    jar.alpha_composite(Image.composite(gloss, Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0)), body_mask))

    jd.rounded_rectangle(lid, radius=px(0.042), fill=LID)
    jd.rounded_rectangle([lid[0], px(0.256), lid[2], lid[3]], radius=px(0.020), fill=LID_DEEP)

    img.alpha_composite(jar)
    return img


def doc_icon() -> Image.Image:
    """The .pdf file-association icon: a page with a folded corner, no tile."""
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pw, ph = int(BASE * 0.70), int(BASE * 0.86)
    px, py = (BASE - pw) // 2, (BASE - ph) // 2
    fold = int(pw * 0.30)

    d.rounded_rectangle([px, py, px + pw, py + ph], radius=int(BASE * 0.05), fill=PAGE)
    # Folded corner.
    d.polygon(
        [(px + pw - fold, py), (px + pw, py + fold), (px + pw - fold, py + fold)],
        fill=(214, 219, 228, 255),
    )
    d.line([(px + pw - fold, py), (px + pw - fold, py + fold), (px + pw, py + fold)],
           fill=(180, 187, 198, 255), width=max(2, BASE // 200))

    left = px + int(pw * 0.14)
    right = px + pw - int(pw * 0.14)
    line_h = int(ph * 0.05)
    gap = int(ph * 0.125)
    top = py + int(ph * 0.42)

    for i, frac in enumerate([1.0, 1.0, 0.55]):
        y = top + i * gap
        x1 = left + int((right - left) * frac)
        if i == 0:
            pad = int(line_h * 0.85)
            d.rounded_rectangle(
                [left - pad, y - pad, x1 + pad, y + line_h + pad],
                radius=int(line_h * 0.7),
                fill=MARMALADE,
            )
        d.rounded_rectangle([left, y, x1, y + line_h], radius=line_h // 2, fill=INK if i == 0 else LINE)

    return img


def save_ico(img: Image.Image, path: str) -> None:
    img.save(path, format="ICO", sizes=ICO_SIZES)
    print("wrote", path)


if __name__ == "__main__":
    app = app_icon()
    save_ico(app, "build/icon.ico")
    app.resize((512, 512), Image.LANCZOS).save("build/icon.png")
    print("wrote build/icon.png")

    save_ico(doc_icon(), "build/pdf.ico")

    # A side-by-side preview at real sizes, for eyeballing legibility.
    sizes = (128, 64, 48, 32, 24, 16)
    doc = doc_icon()
    pad, gap = 24, 18
    width = pad * 2 + sum(sizes) + gap * (len(sizes) - 1)
    preview = Image.new("RGBA", (width, 128 + 128 + pad * 3), (245, 246, 248, 255))
    for row, src in enumerate((app, doc)):
        x = pad
        base_y = pad + row * (128 + pad)
        for size in sizes:
            scaled = src.resize((size, size), Image.LANCZOS)
            preview.paste(scaled, (x, base_y + (128 - size) // 2), scaled)
            x += size + gap
    preview.save("build/icon-preview.png")
    print("wrote build/icon-preview.png")
