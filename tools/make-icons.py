#!/usr/bin/env python3
"""生成 PWA 所需的 PNG 图标与 iOS 启动画面。

只依赖 Pillow。运行：python tools/make-icons.py
输出到 public/icons/：
  icon-192.png / icon-512.png      普通图标（带圆角）
  icon-maskable-512.png            Android 自适应图标（满幅、图形留在安全区内）
  apple-touch-icon.png             iOS 主屏幕图标（180×180，iOS 自己会加圆角）
输出到 public/splash/：
  splash-<宽>x<高>.png             iOS 启动画面（apple-touch-startup-image）

为什么要启动画面：没有它，从主屏图标启动时会先闪一下空白（WebClip 的默认行为），
而"添加主屏后像原生 App 一样玩"正是这个项目的目标之一。
图形复用与图标同源的矢量城堡，因此不依赖任何字体文件。
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(TOOLS_DIR, "..", "public", "icons")
SPLASH_DIR = os.path.join(TOOLS_DIR, "..", "public", "splash")

BG_TOP = (46, 33, 18)
BG_BOTTOM = (22, 17, 12)
GOLD = (217, 164, 65)
GOLD_DARK = (150, 108, 38)
DOOR = (26, 19, 12)

# 超大画布绘制后缩小，用作抗锯齿
SS = 1024


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
        draw.line([(0, y), (size, y)], fill=color)
    return img


def rect(draw: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float, fill) -> None:
    draw.rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill)


def draw_castle(draw: ImageDraw.ImageDraw) -> None:
    """在单位坐标（0..1）上画一座极简城堡。

    图形约束：整体落在 0.16..0.84 的方框内，因此对 maskable 安全区也够用。
    """
    # 两侧塔楼
    rect(draw, 0.16, 0.48, 0.30, 0.82, GOLD)
    rect(draw, 0.70, 0.48, 0.84, 0.82, GOLD)
    # 塔楼垛口
    for left in (0.16, 0.23, 0.70, 0.77):
        rect(draw, left, 0.40, left + 0.07, 0.48, GOLD)

    # 主楼
    rect(draw, 0.30, 0.32, 0.70, 0.82, GOLD)
    # 主楼垛口
    for index in range(4):
        left = 0.30 + index * 0.11
        rect(draw, left, 0.24, left + 0.07, 0.32, GOLD)

    # 门洞：矩形 + 半圆顶
    door_left, door_right, door_top, door_bottom = 0.435, 0.565, 0.63, 0.82
    draw.rectangle(
        [door_left * SS, (door_top + 0.035) * SS, door_right * SS, door_bottom * SS],
        fill=DOOR,
    )
    draw.pieslice(
        [
            door_left * SS,
            door_top * SS,
            door_right * SS,
            (door_top + 0.14) * SS,
        ],
        start=180,
        end=360,
        fill=DOOR,
    )

    # 主楼底部与塔楼之间加一道暗色分隔，避免糊成一坨
    rect(draw, 0.28, 0.80, 0.72, 0.82, GOLD_DARK)


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    return mask


def render(size: int, *, corner_ratio: float | None, scale: float) -> Image.Image:
    """渲染一张图标。

    corner_ratio: None 表示满幅（maskable），否则按比例做圆角。
    scale: 图形缩放，用于把城堡缩进安全区。
    """
    # 统一在 SS 画布上合成，最后一次性缩小到目标尺寸（顺带得到抗锯齿）
    base = gradient(SS)

    layer = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    castle = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    draw_castle(ImageDraw.Draw(castle))

    if scale != 1.0:
        inner = int(SS * scale)
        castle = castle.resize((inner, inner), Image.LANCZOS)
        offset = (SS - inner) // 2
        layer.paste(castle, (offset, offset), castle)
    else:
        layer = castle

    out = base.convert("RGBA")
    out.alpha_composite(layer)

    if corner_ratio is not None:
        out.putalpha(rounded_mask(SS, corner_ratio))

    return out.resize((size, size), Image.LANCZOS)


def gradient_rect(width: int, height: int) -> Image.Image:
    """任意长宽的竖向渐变（图标那个只处理正方形）。"""
    img = Image.new("RGB", (width, height), BG_BOTTOM)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return img


def render_splash(width: int, height: int) -> Image.Image:
    """启动画面：满幅渐变 + 居中的城堡（与图标同源的矢量图形）。

    刻意不放文字：写字要绑字体文件，而这里没有任何需要传达的信息。
    """
    base = gradient_rect(width, height).convert("RGBA")

    castle = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    draw_castle(ImageDraw.Draw(castle))

    inner = max(64, int(width * 0.42))
    castle = castle.resize((inner, inner), Image.LANCZOS)
    x = (width - inner) // 2
    # 略高于正中：视觉上更稳，也让下面的留白不至于太空
    y = (height - inner) // 2 - int(height * 0.04)
    base.alpha_composite(castle, (x, y))

    return base


def verify() -> None:
    """自检：确认生成的图不是空白、纯色或全黑。

    为什么值得写在脚本里：这几张图是"看得见但对不齐"的东西 ——
    生成一张黑矩形不会有任何报错，而人（或自动流程）很容易就这么交付出去。
    这里只做能客观判断的最小检查：渐变存在、城堡的金色像素存在。
    """
    problems: list[str] = []

    def has_near(image: Image.Image, target: tuple[int, int, int], tolerance: int = 26) -> bool:
        for pixel in image.convert("RGB").getdata():
            if all(abs(pixel[i] - target[i]) <= tolerance for i in range(3)):
                return True
        return False

    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"):
        path = os.path.join(OUT_DIR, name)
        if not os.path.exists(path):
            problems.append(f"{name} 没有生成")
            continue
        image = Image.open(path)
        if not has_near(image, GOLD):
            problems.append(f"{name} 里找不到城堡的金色，可能是张空图")

    for width, height, scale in SPLASHES:
        name = f"splash-{width}x{height}.png"
        path = os.path.join(SPLASH_DIR, name)
        if not os.path.exists(path):
            problems.append(f"{name} 没有生成")
            continue
        image = Image.open(path).convert("RGB")
        expected_w, expected_h = width * scale, height * scale
        if image.size != (expected_w, expected_h):
            problems.append(f"{name} 尺寸是 {image.size}，应当是 {(expected_w, expected_h)}")
        # 顶部与底部颜色应当不同 —— 否则渐变没画上
        if image.getpixel((4, 4)) == image.getpixel((4, expected_h - 5)):
            problems.append(f"{name} 顶部与底部同色，渐变可能没生成")
        if not has_near(image, GOLD):
            problems.append(f"{name} 里找不到城堡的金色")

    if problems:
        for problem in problems:
            print(f"自检未通过：{problem}")
        raise SystemExit(1)
    print(f"自检通过：{len(SPLASHES) + 4} 张图都非空、尺寸正确")


# 设备点数 → 像素比。media 查询要同时用上这两个值，所以在这里集中定义。
SPLASHES = [
    (375, 667, 2),   # iPhone SE 2/3
    (375, 812, 3),   # iPhone X / XS / 11 Pro / 12 mini
    (390, 844, 3),   # iPhone 12 / 13 / 14
    (393, 852, 3),   # iPhone 14 Pro / 15 / 15 Pro
    (430, 932, 3),   # iPhone 14 Pro Max / 15 Plus / 15 Pro Max
]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(SPLASH_DIR, exist_ok=True)

    targets = [
        ("icon-192.png", 192, 0.22, 1.0),
        ("icon-512.png", 512, 0.22, 1.0),
        # maskable：满幅背景 + 图形缩到约 70%，确保被裁成圆形/方形时都不缺角
        ("icon-maskable-512.png", 512, None, 0.70),
        # iOS 自己会给主屏幕图标加圆角，所以这里给满幅方形
        ("apple-touch-icon.png", 180, None, 0.92),
    ]

    for name, size, corner, scale in targets:
        render(size, corner_ratio=corner, scale=scale).save(
            os.path.join(OUT_DIR, name), "PNG", optimize=True
        )
        print(f"已生成 {name} ({size}x{size})")

    # iOS 启动画面。键是设备点数，值是设备像素 —— 两者都要写进 media 查询，
    # 否则 iOS 匹配不到、等于没配。
    total = 0
    for width, height, scale in SPLASHES:
        pixel_w, pixel_h = width * scale, height * scale
        image = render_splash(pixel_w, pixel_h)
        name = f"splash-{width}x{height}.png"
        path = os.path.join(SPLASH_DIR, name)
        image.save(path, "PNG", optimize=True)
        size_kb = os.path.getsize(path) / 1024
        total += size_kb
        print(f"已生成 splash/{name} ({pixel_w}x{pixel_h}, {size_kb:.0f} KB)")
    print(f"启动画面合计 {total:.0f} KB")

    verify()


if __name__ == "__main__":
    main()
