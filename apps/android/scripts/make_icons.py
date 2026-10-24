# -*- coding: utf-8 -*-
"""从品牌 badge-512.png 生成 Android 启动器图标（传统 + 自适应前景）。

用法：python scripts/make_icons.py
依赖：Pillow（Anaconda 自带）。重新生成前先删除 res/mipmap-* 下的旧图。
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BADGE = os.path.normpath(os.path.join(HERE, "..", "..", "web", "public", "brand", "badge-512.png"))
RES = os.path.normpath(os.path.join(HERE, "..", "app", "src", "main", "res"))
BLUE = (15, 76, 140, 255)  # --uestc-blue #0f4c8c，见 apps/web/src/styles/main.css

# 自适应图标前景画布（108dp 各密度）；badge 占 66%，留在 61% 安全区内
FOREGROUND = {"mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216, "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432}
# API 24/25 的传统图标
LEGACY = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}


def main():
    badge = Image.open(BADGE).convert("RGBA")

    for folder, size in FOREGROUND.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        b = badge.resize((int(size * 0.66), int(size * 0.66)), Image.LANCZOS)
        canvas.alpha_composite(b, ((size - b.width) // 2, (size - b.height) // 2))
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        canvas.save(os.path.join(out_dir, "ic_launcher_foreground.png"))

    for folder, size in LEGACY.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BLUE
        )
        canvas.alpha_composite(plate)
        b = badge.resize((int(size * 0.74), int(size * 0.74)), Image.LANCZOS)
        canvas.alpha_composite(b, ((size - b.width) // 2, (size - b.height) // 2))
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        canvas.save(os.path.join(out_dir, "ic_launcher.png"))
        canvas.save(os.path.join(out_dir, "ic_launcher_round.png"))

    print("icons written to", RES)


if __name__ == "__main__":
    main()
