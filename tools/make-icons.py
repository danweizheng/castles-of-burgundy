#!/usr/bin/env python3
"""生成 PWA 所需的 PNG 图标。

只依赖 Pillow。运行：python tools/make-icons.py
输出到 public/icons/：
  icon-192.png / icon-512.png      普通图标（带圆角）
  icon-maskable-512.png            Android 自适应图标（满幅、图形留在安全区内）
  apple-touch-icon.png             iOS 主屏幕图标（180×180，iOS 自己会加圆角）
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")

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


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

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


if __name__ == "__main__":
    main()
