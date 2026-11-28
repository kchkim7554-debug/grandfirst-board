#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도시락 관리 앱 아이콘 생성 (PWA · 홈 화면 · 파비콘).

    python3 icons/gen_icons.py

디자인은 게시판 관리(parent board) 앱 아이콘과 같은 톤으로 맞춘다.
  · 배경: 어두운 네이비 → 짙은 청록 그라데이션 (게시판 아이콘과 같은 색 계열)
  · 심볼: 위쪽 가운데에 깔끔한 도시락 통(흰 트레이 + 밥·반찬 3칸), 오른쪽 위에 젓가락
  · 글씨: 가운데 '도시락' 흰색 굵게, 아래 '관리' 민트색 — 게시판 아이콘의 '풍경채 / 게시판 관리' 와 같은 구성

512 기준 좌표로 그린 뒤 4배(2048)에서 LANCZOS 로 줄여 가장자리를 부드럽게 한다.
maskable 아이콘은 안드로이드가 원형으로 잘라 내므로 내용을 74% 안쪽에 모은다.
파비콘(32·16)은 글씨가 뭉개지므로 심볼만 크게 넣는다.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
S = 2048                       # 작업 해상도 (512 기준 4배)
K = S / 512.0                  # 512 좌표 → 작업 좌표 배율

# 게시판 관리 아이콘에서 딴 색
TOP = (30, 82, 136)            # 위쪽 네이비 #1E5288
MID = (20, 62, 100)            # 가운데 #143E64
BOTTOM = (11, 37, 58)          # 아래 짙은 청록 #0B253A
WHITE = (248, 250, 252)
MINT = (150, 253, 206)         # '게시판 관리' 글씨와 같은 민트
AMBER = (251, 191, 36)         # 밥
GREEN = (52, 211, 153)         # 반찬
ROSE = (251, 113, 133)         # 반찬
STICK_A = (253, 224, 150)      # 젓가락
STICK_B = (244, 190, 100)

FONT_CANDIDATES = [
    "/workspace/fonts/NanumGothic-ExtraBold.ttf",
    "/workspace/fonts/NanumGothic-Bold.ttf",
    "/usr/share/fonts/opentype/pickle-hwp/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, int(round(size)))
    raise SystemExit("한글 폰트를 찾지 못했습니다: " + ", ".join(FONT_CANDIDATES))


def px(v):
    return int(round(v * K))


def background():
    """세로 그라데이션 — 위 네이비에서 아래 짙은 청록으로."""
    img = Image.new("RGB", (S, S), TOP)
    d = ImageDraw.Draw(img)
    for y in range(S):
        t = y / (S - 1)
        if t < 0.55:
            u = t / 0.55
            c = tuple(int(TOP[i] + (MID[i] - TOP[i]) * u) for i in range(3))
        else:
            u = (t - 0.55) / 0.45
            c = tuple(int(MID[i] + (BOTTOM[i] - MID[i]) * u) for i in range(3))
        d.line([(0, y), (S, y)], fill=c)
    # 왼쪽 위 옅은 빛무리 — 게시판 아이콘의 은은한 광택
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([px(-140), px(-190), px(330), px(300)], fill=(120, 180, 235, 40))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(px(60))))
    return img


def geometry(with_text):
    if with_text:
        return dict(tray_w=190, tray_h=148, tray_cy=194, rad=22, r_in=11,
                    title_size=106, title_cy=336, sub_size=50, sub_cy=418,
                    stick_w=9.0, stick_gap=15, shadow=True)
    return dict(tray_w=252, tray_h=198, tray_cy=256, rad=30, r_in=15,
                title_size=0, title_cy=0, sub_size=0, sub_cy=0,
                stick_w=11.0, stick_gap=18, shadow=False)


def draw_symbol(d, with_text=True):
    """512 좌표 기준으로 도시락 통 · 젓가락 · 글씨를 그린다."""
    g = geometry(with_text)

    def p(v):
        return int(round(v * K))

    cx = 256
    x0, y0 = cx - g["tray_w"] / 2, g["tray_cy"] - g["tray_h"] / 2
    x1, y1 = cx + g["tray_w"] / 2, g["tray_cy"] + g["tray_h"] / 2

    # ---- 도시락 통 (위에서 본 모양) ----
    d.rounded_rectangle([p(x0), p(y0), p(x1), p(y1)], radius=p(g["rad"]), fill=WHITE + (255,))

    # 안쪽 칸 — 왼쪽 큰 칸(밥) + 오른쪽 위/아래(반찬)
    pad = g["tray_w"] * 0.075
    ix0, iy0, ix1, iy1 = x0 + pad, y0 + pad, x1 - pad, y1 - pad
    iw, ih = ix1 - ix0, iy1 - iy0
    gap = iw * 0.05
    rice_w = iw * 0.60
    r_in = g["r_in"]

    d.rounded_rectangle([p(ix0), p(iy0), p(ix0 + rice_w), p(iy1)], radius=p(r_in), fill=AMBER + (255,))
    for (fx, fy) in [(0.24, 0.24), (0.48, 0.33), (0.30, 0.55), (0.55, 0.66), (0.22, 0.78), (0.44, 0.87)]:
        r = p(3.4 if with_text else 4.6)
        ex, ey = p(ix0 + rice_w * fx), p(iy0 + ih * fy)
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=(255, 251, 235, 200))

    rx0 = ix0 + rice_w + gap
    mid = iy0 + (ih - gap) / 2
    d.rounded_rectangle([p(rx0), p(iy0), p(ix1), p(mid)], radius=p(r_in), fill=GREEN + (255,))
    d.rounded_rectangle([p(rx0), p(mid + gap), p(ix1), p(iy1)], radius=p(r_in), fill=ROSE + (255,))

    # ---- 젓가락 두 개 (오른쪽 위, 게시판 아이콘의 잎 자리) ----
    def stick(dx, dy, w, color):
        a = (x1 - 34 + dx, y0 - 30 + dy)
        b = (x1 + 8 + dx, y0 - 68 + dy)
        d.line([(p(a[0]), p(a[1])), (p(b[0]), p(b[1]))], fill=color + (255,), width=p(w))
        for pt in (a, b):
            r = p(w) / 2
            d.ellipse([p(pt[0]) - r, p(pt[1]) - r, p(pt[0]) + r, p(pt[1]) + r], fill=color + (255,))

    # 두 짝이 겹쳐 한 줄로 보이지 않도록 선에 수직 방향으로 나란히 띄운다
    stick(0, 0, g["stick_w"], STICK_A)
    stick(-g["stick_gap"] * 0.62, -g["stick_gap"] * 0.70, g["stick_w"] - 1, STICK_B)

    # ---- 글씨 ----
    if not with_text:
        return

    d.text((p(256), p(g["title_cy"])), "도시락", font=font(g["title_size"] * K),
           fill=WHITE + (255,), anchor="mm")
    # '관리' 두 글자 사이를 살짝 벌린다 (게시판 아이콘의 자간 느낌)
    d.text((p(256), p(g["sub_cy"])), "관 리", font=font(g["sub_size"] * K),
           fill=MINT + (255,), anchor="mm")


def content_layer(scale, with_text=True):
    """512 칸 안에 (scale 만큼 줄여) 내용을 그린 투명 레이어."""
    tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 그림자 먼저 — 통 모양을 살짝 아래로 복사해 흐리게
    if geometry(with_text)["shadow"]:
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        g = geometry(with_text)
        cxy = (256, g["tray_cy"])
        ImageDraw.Draw(sh).rounded_rectangle(
            [px(256 - g["tray_w"] / 2 + 3), px(cxy[1] - g["tray_h"] / 2 + 10),
             px(256 + g["tray_w"] / 2 + 4), px(cxy[1] + g["tray_h"] / 2 + 12)],
            radius=px(g["rad"]), fill=(0, 0, 0, 110))
        tmp = Image.alpha_composite(tmp, sh.filter(ImageFilter.GaussianBlur(px(9))))

    draw_symbol(ImageDraw.Draw(tmp), with_text)

    if scale >= 0.999:
        return tmp
    side = int(round(S * scale))
    small = tmp.resize((side, side), Image.LANCZOS)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    off = (S - side) // 2
    layer.paste(small, (off, off), small)
    return layer


def icon(with_text=True, scale=1.0):
    base = background()
    return Image.alpha_composite(base, content_layer(scale, with_text)).convert("RGB")


def save(img, size, name):
    out = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(HERE, name)
    out.save(path, "PNG", optimize=True)
    print("%-28s %dx%d  %6.1f KB" % (name, size, size, os.path.getsize(path) / 1024))


def main():
    normal = icon(True, 1.0)
    maskable = icon(True, 0.74)          # 원형으로 잘려도 글씨가 살아남는 크기
    symbol = icon(False, 1.0)            # 파비콘용 — 심볼만

    save(normal, 512, "icon-512.png")
    save(normal, 192, "icon-192.png")
    save(maskable, 512, "icon-maskable-512.png")
    save(normal, 180, "apple-touch-icon-180.png")
    save(symbol, 32, "favicon-32.png")
    save(symbol, 16, "favicon-16.png")

    # 확인용 시트 — 512 · 원형 마스크(안드로이드) · 192 · 파비콘
    sheet = Image.new("RGB", (1500, 640), (238, 242, 247))
    d = ImageDraw.Draw(sheet)
    sheet.paste(normal.resize((512, 512), Image.LANCZOS), (20, 60))
    circle = maskable.resize((512, 512), Image.LANCZOS)
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 511, 511], fill=255)
    sheet.paste(circle, (572, 60), mask)
    sheet.paste(normal.resize((192, 192), Image.LANCZOS), (1140, 60))
    sheet.paste(normal.resize((96, 96), Image.LANCZOS), (1140, 276))
    sheet.paste(symbol.resize((56, 56), Image.LANCZOS), (1140, 400))
    sheet.paste(symbol.resize((28, 28), Image.LANCZOS), (1210, 400))
    caps = [(20, "512 · 홈 화면"), (572, "maskable 512 · 원형 마스크"), (1140, "192 / 96 · 파비콘 56 / 28")]
    for x, cap in caps:
        d.text((x, 600), cap, font=font(22), fill=(60, 72, 88))
    sheet.save(os.path.join(HERE, "_preview.png"), "PNG")
    print("_preview.png (확인용, 배포 안 함)")


if __name__ == "__main__":
    main()
