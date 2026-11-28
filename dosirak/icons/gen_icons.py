#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도시락 관리 앱 아이콘 생성 (PWA · 홈 화면 · 파비콘).

    python3 icons/gen_icons.py

512 기준으로 4배(2048) 크게 그린 뒤 LANCZOS 로 줄여 가장자리를 부드럽게 한다.
maskable 아이콘은 안드로이드가 원형으로 잘라 내므로 그림을 80% 안쪽에 둔다.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
S = 2048                      # 작업 해상도
SS = S / 512.0                # 512 기준 좌표 → 작업 좌표 배율

TOP = (15, 23, 42)            # #0f172a
BOTTOM = (49, 46, 129)        # #312e81
WHITE = (248, 250, 252)
AMBER = (251, 191, 36)
GREEN = (52, 211, 153)
ROSE = (251, 113, 133)
LINE = (226, 232, 240)
STICK = (226, 232, 240)


def px(v):
    return int(round(v * SS))


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        # 대각선 느낌을 주기 위해 위에서 아래로 색을 섞는다
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    return img


def rounded(size, radius, fill, box=None):
    """투명 배경 위에 둥근 사각형 한 장"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box or (0, 0, size - 1, size - 1)
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill)
    return img


def draw_icon(safe=False):
    """safe=True 이면 maskable — 그림을 가운데 78% 안에 모은다."""
    base = gradient(S, TOP, BOTTOM).convert("RGBA")
    d = ImageDraw.Draw(base)

    # 아주 옅은 원형 하이라이트
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([px(-90), px(-160), px(420), px(330)], fill=(99, 102, 241, 46))
    base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(px(40))))
    d = ImageDraw.Draw(base)

    scale = 0.78 if safe else 0.92
    # 도시락통(위에서 본 모양) 중심·크기
    box_w = 512 * 0.66 * scale
    box_h = 512 * 0.66 * scale
    cx, cy = 256, 256 + (512 * 0.02 if not safe else 0)
    x0, y0 = cx - box_w / 2, cy - box_h / 2
    x1, y1 = cx + box_w / 2, cy + box_h / 2

    # 그림자
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([px(x0), px(y0 + 8), px(x1), px(y1 + 10)], radius=px(26), fill=(0, 0, 0, 120))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(px(10))))
    d = ImageDraw.Draw(base)

    # 통 본체
    d.rounded_rectangle([px(x0), px(y0), px(x1), px(y1)], radius=px(26), fill=WHITE)

    # 안쪽 3칸 — 왼쪽 큰 칸(밥) + 오른쪽 두 칸(반찬)
    pad = box_w * 0.075
    inner_x0, inner_y0 = x0 + pad, y0 + pad
    inner_x1, inner_y1 = x1 - pad, y1 - pad
    iw = inner_x1 - inner_x0
    ih = inner_y1 - inner_y0
    gap = iw * 0.055

    # 밥(왼쪽, 약 62%)
    rice_w = iw * 0.6
    d.rounded_rectangle([px(inner_x0), px(inner_y0), px(inner_x0 + rice_w), px(inner_y1)],
                        radius=px(12), fill=AMBER)
    # 밥알 느낌의 작은 점
    for (dx, dy) in [(0.22, 0.24), (0.45, 0.32), (0.3, 0.56), (0.52, 0.66), (0.2, 0.78), (0.42, 0.86)]:
        r = px(4.5)
        px_ = px(inner_x0 + rice_w * dx)
        py_ = px(inner_y0 + ih * dy)
        d.ellipse([px_ - r, py_ - r, px_ + r, py_ + r], fill=(255, 251, 235, 190))

    # 오른쪽 위(반찬 綠) · 오른쪽 아래(반찬 紅)
    rx0 = inner_x0 + rice_w + gap
    mid = inner_y0 + (ih - gap) / 2
    d.rounded_rectangle([px(rx0), px(inner_y0), px(inner_x1), px(mid)], radius=px(11), fill=GREEN)
    d.rounded_rectangle([px(rx0), px(mid + gap), px(inner_x1), px(inner_y1)], radius=px(11), fill=ROSE)

    return base.convert("RGB")


def save(img, size, name):
    out = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(HERE, name)
    out.save(path, "PNG", optimize=True)
    print("%-28s %dx%d  %6.1f KB" % (name, size, size, os.path.getsize(path) / 1024))


def main():
    normal = draw_icon(False)
    maskable = draw_icon(True)
    save(normal, 512, "icon-512.png")
    save(normal, 192, "icon-192.png")
    save(maskable, 512, "icon-maskable-512.png")
    save(normal, 180, "apple-touch-icon-180.png")
    save(normal, 32, "favicon-32.png")
    save(normal, 16, "favicon-16.png")
    # 미리보기(192·32 을 한 장에) — 눈으로 확인용
    sheet = Image.new("RGB", (512 + 40 + 192, 512), (238, 242, 247))
    sheet.paste(normal.resize((512, 512), Image.LANCZOS), (0, 0))
    sheet.paste(maskable.resize((192, 192), Image.LANCZOS), (552, 40))
    sheet.paste(normal.resize((32, 32), Image.LANCZOS), (552, 300))
    sheet.save(os.path.join(HERE, "_preview.png"), "PNG")
    print("_preview.png (확인용, 배포 안 함)")


if __name__ == "__main__":
    main()
