"""web/icon.svg と同じ絵柄の PNG アイコンを作る (アイコンを変えたときだけ実行)。

  python scripts/make_icons.py
"""
import pathlib

from PIL import Image, ImageDraw

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
TEAL = (15, 122, 108)
SCALE = 4  # 大きく描いてから縮小して輪郭をなめらかにする


def bezier(p0, p1, p2, p3, n=40):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def draw(size, rounded):
    s = 512 * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=112 * SCALE, fill=TEAL)
    else:  # iOS は自分で角を丸めるので四角のまま
        d.rectangle((0, 0, s, s), fill=TEAL)
    k = lambda pts: [(x * SCALE, y * SCALE) for x, y in pts]
    drop = (bezier((256, 92), (256, 92), (136, 230), (136, 312))
            + bezier((136, 312), (136, 380), (190, 428), (256, 428))
            + bezier((256, 428), (322, 428), (376, 380), (376, 312))
            + bezier((376, 312), (376, 230), (256, 92), (256, 92)))
    d.polygon(k(drop), fill="white")
    shine = bezier((206, 318), (206, 352), (228, 374), (258, 378))
    d.line(k(shine), fill=TEAL, width=22 * SCALE, joint="curve")
    for x, y in (shine[0], shine[-1]):
        r = 11 * SCALE
        d.ellipse((x * SCALE - r, y * SCALE - r, x * SCALE + r, y * SCALE + r), fill=TEAL)
    return img.resize((size, size), Image.LANCZOS)


draw(180, False).convert("RGB").save(WEB / "icon-180.png")
draw(192, True).save(WEB / "icon-192.png")
draw(512, True).save(WEB / "icon-512.png")
print("wrote icon-180.png, icon-192.png, icon-512.png")
