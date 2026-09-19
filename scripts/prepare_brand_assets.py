# -*- coding: utf-8 -*-
"""
素材加工：把 LOGO&成电元素 的原始 PNG 加工成前端可用的品牌资源。

加工原则（与站点设计 token 对齐）：
- 深蓝 #0F4C8C（校徽主色）/ 浅蓝 #4A7FB5 / 银杏金 #D99F00
- 白色线稿 → 转绘为指定颜色（保留抗锯齿 alpha）
- 全部降采样到前端实际需要的尺寸，输出到 apps/web/public/brand/

用法：python scripts/prepare_brand_assets.py
"""
import os

from PIL import Image

SRC = "LOGO&成电元素"
DST = os.path.join("apps", "web", "public", "brand")
os.makedirs(DST, exist_ok=True)

BLUE = (15, 76, 140)        # uestc-600
BLUE_LIGHT = (74, 127, 181) # uestc-400
GOLD = (217, 159, 0)        # ginkgo-500


def recolor(src_img, color):
    """保留原图 alpha，把不透明像素统一改为指定颜色（用于白色/深色线稿上色）。"""
    img = src_img.convert("RGBA")
    alpha = img.getchannel("A")
    solid = Image.new("RGBA", img.size, color + (0,))
    solid.putalpha(alpha)
    return solid


def trim(img, pad=8):
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def resize_w(img, width):
    ratio = width / img.width
    return img.resize((width, max(1, round(img.height * ratio))), Image.LANCZOS)


def save(img, name):
    path = os.path.join(DST, name)
    img.save(path, optimize=True)
    print("%-28s %5dx%-5d %6.1f KB" % (name, img.width, img.height, os.path.getsize(path) / 1024))


# ---------- 1. 校徽：导航 Logo + favicon 全套 ----------
badge = Image.open(os.path.join(SRC, "校徽.png")).convert("RGBA")
badge = trim(badge, 0)
side = min(badge.size)
badge = badge.crop((0, 0, side, side))  # 徽章近似正方形，取中心方
for size in (32, 48, 96, 192):
    save(badge.resize((size, size), Image.LANCZOS), f"badge-{size}.png")
save(badge.resize((180, 180), Image.LANCZOS), "apple-touch-icon.png")

# ---------- 2. 校训：蓝色单色徽章（浅色背景用） ----------
mono = Image.open(os.path.join(SRC, "校徽单色.png")).convert("RGBA")
mono = trim(mono, 0)
save(resize_w(recolor(mono, BLUE), 96), "badge-blue-96.png")

# ---------- 3. 主楼线稿-正：首页 Hero 水印（转绘深蓝） ----------
front = Image.open(os.path.join(SRC, "主楼线稿-正.png")).convert("RGBA")
front = trim(front)
front = resize_w(front, 2400)
save(recolor(front, BLUE), "building-front-blue.png")

# ---------- 4. 主楼线稿-侧：登录页背景（转绘浅蓝） ----------
side_b = Image.open(os.path.join(SRC, "主楼线稿-侧.png")).convert("RGBA")
side_b = trim(side_b)
side_b = resize_w(side_b, 1600)
save(recolor(side_b, BLUE_LIGHT), "building-side-blue.png")

# ---------- 5. 图书馆线稿：页脚装饰（转绘深蓝，低透明度由 CSS 控制） ----------
lib = Image.open(os.path.join(SRC, "图书馆线稿.png")).convert("RGBA")
lib = trim(lib)
lib = resize_w(lib, 2200)
save(recolor(lib, BLUE), "library-blue.png")

# ---------- 6. 银杏：金色枝叶（按金色像素定位裁剪，转绘 token 金） ----------
gk = Image.open(os.path.join(SRC, "银杏.png")).convert("RGBA")
px = gk.load()
# 找金色像素（R 高、B 偏低）的包围盒
minx, miny, maxx, maxy = gk.width, gk.height, 0, 0
step = 4
for y in range(0, gk.height, step):
    for x in range(0, gk.width, step):
        r, g, b, a = px[x, y]
        if a > 40 and r > 170 and g > 130 and b < 170 and r > b + 60:
            minx = min(minx, x)
            maxx = max(maxx, x)
            miny = min(miny, y)
            maxy = max(maxy, y)
gold_crop = gk.crop((max(0, minx - 12), max(0, miny - 12), min(gk.width, maxx + 12), min(gk.height, maxy + 12)))
gold_crop = trim(gold_crop, 0)
gold_crop = resize_w(gold_crop, 1100)
save(recolor(gold_crop, GOLD), "ginkgo-gold.png")

# 白色线稿银杏叶（左侧）→ 转绘金色，用于小装饰
line_leaves = gk.crop((0, 0, max(1, minx - 40), gk.height))
line_leaves = trim(line_leaves, 0)
if line_leaves.width > 50:
    line_leaves = resize_w(line_leaves, 640)
    save(recolor(line_leaves, GOLD), "ginkgo-line-gold.png")

print("\n完成，输出目录:", DST)
