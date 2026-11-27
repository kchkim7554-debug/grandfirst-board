#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""풍경채 로고 에셋 생성기 — 헤더 워드마크 + 홈 화면 단축아이콘 + 파비콘.

원본: brand/pungkyungchae-scan.jpg (사용자가 2026-11-24 스캔해 보낸 제일풍경채 로고)
추출: brand/logo_lib.py  (흰 종이 배경 제거 → 투명 PNG)

만드는 파일 (모두 board/icons/)
  logo-wordmark-white.png   헤더용 — 흰 글씨 + 색 잎, 투명 배경 (네이비 상단바 위)
  logo-wordmark-color.png   밝은 배경용 — 잉크색 글씨 + 색 잎, 투명 배경
  icon-192.png / icon-512.png           PWA 'any' 아이콘 (네이비 + 흰 풍경채 + 민트 '게시판 관리')
  icon-maskable-512.png                 안드로이드 적응형(마스크) 아이콘 — 내용 0.75배
  apple-touch-icon-180.png              iOS 홈 화면
  favicon-32.png / favicon-16.png       작은 탭 아이콘 — '풍' 한 글자
  icon.svg                              위 512 아이콘을 넣은 SVG (탭 파비콘용)

사용:
  python3 scripts/make_brand_assets.py          # 생성
  python3 scripts/make_brand_assets.py --check  # 파일이 최신인지만 확인 (다르면 종료코드 1)
"""
import base64
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # board/
sys.path.insert(0, os.path.join(ROOT, "brand"))
import logo_lib                                     # noqa: E402

OUT = os.path.join(ROOT, "icons")
WORKSPACE = os.path.dirname(ROOT)

NAVY_TOP = (27, 74, 125)      # #1b4a7d
NAVY_BOT = (10, 32, 56)       # #0a2038
MINT = (142, 240, 198)        # #8ef0c6
SS = 4                        # 슈퍼샘플 배율

FONT_CANDIDATES = [
    os.path.join(WORKSPACE, "fonts", "NanumGothic-ExtraBold.ttf"),
    os.path.join(WORKSPACE, "fonts", "NanumGothic-Bold.ttf"),
    "/usr/share/fonts/truetype/nanum/NanumGothicExtraBold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
]
SUB_TEXT = "게시판 관리"


def font(px):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    raise SystemExit("한글 폰트를 찾지 못했습니다: " + str(FONT_CANDIDATES))


def gradient_bg(n):
    """네이비 세로 그라데이션 + 아래쪽 민트 글로우 + 위쪽 은은한 하이라이트."""
    y = np.linspace(0, 1, n, dtype=np.float32)[:, None]
    top, bot = np.array(NAVY_TOP, np.float32), np.array(NAVY_BOT, np.float32)
    rgb = top[None, :] * (1 - y) + bot[None, :] * y
    rgb = np.repeat(rgb[:, None, :], n, axis=1)

    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    # 아래쪽 중앙 민트 글로우
    d = np.sqrt((xx - 0.5) ** 2 + (yy - 1.05) ** 2 * 0.55)
    glow = np.clip(1.0 - d / 0.75, 0, 1) ** 2 * 0.20
    rgb += np.array([45, 160, 120], np.float32)[None, None, :] * glow[..., None]
    # 위쪽 은은한 빛
    d2 = np.sqrt((xx - 0.5) ** 2 + (yy + 0.25) ** 2)
    hi = np.clip(1.0 - d2 / 0.9, 0, 1) ** 2 * 0.12
    rgb += np.array([120, 170, 220], np.float32)[None, None, :] * hi[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def rounded_mask(n, radius_ratio=0.225):
    m = Image.new("L", (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius_ratio), fill=255)
    return m


def text_width(draw, text, fnt, track=0):
    if not text:
        return 0
    w = sum(draw.textlength(ch, font=fnt) for ch in text)
    return w + track * (len(text) - 1)


def draw_tracked(draw, cx, cy, text, fnt, fill, track=0):
    total = text_width(draw, text, fnt, track)
    x = cx - total / 2
    asc, desc = fnt.getmetrics()
    y = cy - (asc + desc) / 2
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + track


def compose_icon(wordmark, n, maskable=False, sub=True):
    """n×n 아이콘. maskable 이면 안전영역(지름 80%) 안에 내용을 줄여 넣는다."""
    S = n * SS
    base = gradient_bg(S)

    wm_w = int(S * (0.60 if maskable else 0.76))
    wm_h = round(wm_w * wordmark.height / wordmark.width)
    wm = wordmark.resize((wm_w, wm_h), Image.LANCZOS)

    sub_f = font(int(S * (0.058 if maskable else 0.072)))
    track = S * 0.006
    draw = ImageDraw.Draw(base)
    sub_h = int(sub_f.size * 1.15) if sub else 0
    gap = int(S * (0.028 if maskable else 0.034))
    block = wm_h + (gap + sub_h if sub else 0)
    top = (S - block) // 2

    base.paste(wm, ((S - wm_w) // 2, top), wm)
    if sub:
        draw_tracked(draw, S / 2, top + wm_h + gap + sub_h / 2, SUB_TEXT, sub_f, MINT, track)

    icon = base.resize((n, n), Image.LANCZOS).convert("RGBA")
    if not maskable:
        icon.putalpha(rounded_mask(n))
    return icon


def first_glyph(wordmark):
    """워드마크에서 첫 글자 '풍'만 오려 낸다 (해당 글자의 잉크 영역에 꼭 맞게).

    글자 사이 빈 열을 찾아 첫 글자 구간을 잡고, 그 안의 세로 범위로 다시 자른다.
    """
    a = np.asarray(wordmark)[..., 3].astype(np.float32) / 255.0
    h, w = a.shape
    band = a[int(h * 0.45):, :].sum(axis=0)
    thr = band.max() * 0.05
    runs, start = [], None
    for i, v in enumerate(band > thr):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, w))
    x0, x1 = [r for r in runs if r[1] - r[0] > 30][0]
    sub = a[:, x0:x1]
    rows = np.where(sub.sum(axis=1) > 1)[0]
    y0, y1 = rows.min(), rows.max() + 1
    return wordmark.crop((x0, y0, x1, y1))


def favicon_glyph(color_wordmark, n):
    """작은 파비콘 — 첫 글자 '풍'만 흰색으로, 네이비 사각형 가득."""
    S = n * SS
    glyph = first_glyph(color_wordmark)
    arr = np.asarray(glyph).astype(np.float32)
    ink = arr[..., 3] > 10
    arr[ink, 0] = arr[ink, 1] = arr[ink, 2] = 255
    glyph = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")

    base = gradient_bg(S)
    target_h = int(S * 0.72)
    target_w = round(glyph.width * target_h / glyph.height)
    if target_w > S * 0.76:
        target_w = int(S * 0.76)
        target_h = round(glyph.height * target_w / glyph.width)
    g = glyph.resize((target_w, target_h), Image.LANCZOS)
    base.paste(g, ((S - target_w) // 2, (S - target_h) // 2), g)
    out = base.resize((n, n), Image.LANCZOS).convert("RGBA")
    out.putalpha(rounded_mask(n, 0.26))
    return out


def svg_for(png: Image.Image) -> str:
    buf = io.BytesIO()
    png.save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" '
        'role="img" aria-label="풍경채 게시판 관리">\n'
        '  <title>풍경채 게시판 관리</title>\n'
        f'  <image href="data:image/png;base64,{b64}" x="0" y="0" width="512" height="512" '
        'preserveAspectRatio="xMidYMid meet"/>\n'
        '</svg>\n'
    )


def wordmark_png(img, height_px):
    w = round(img.width * height_px / img.height)
    # 3x 여유 있게 미리 키운 뒤 넘긴다 (레티나에서도 또렷하게)
    return img.resize((w, height_px), Image.LANCZOS)


def main(check=False):
    color, white = logo_lib.build()
    os.makedirs(OUT, exist_ok=True)

    files = {}
    files["logo-wordmark-white.png"] = wordmark_png(white, 112)
    files["logo-wordmark-color.png"] = wordmark_png(color, 112)
    icon512 = compose_icon(white, 512)
    files["icon-512.png"] = icon512
    files["icon-192.png"] = compose_icon(white, 192)
    files["icon-maskable-512.png"] = compose_icon(white, 512, maskable=True)
    files["apple-touch-icon-180.png"] = compose_icon(white, 180)
    files["favicon-32.png"] = favicon_glyph(color, 32)
    files["favicon-16.png"] = favicon_glyph(color, 16)

    stale = []
    for name, img in files.items():
        path = os.path.join(OUT, name)
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        old = open(path, "rb").read() if os.path.exists(path) else None
        if check:
            if old != data:
                stale.append(name)
        else:
            open(path, "wb").write(data)
            print("  · icons/" + name, img.size)

    svg = svg_for(icon512)
    svg_path = os.path.join(OUT, "icon.svg")
    old_svg = open(svg_path, encoding="utf-8").read() if os.path.exists(svg_path) else None
    if check:
        if old_svg != svg:
            stale.append("icon.svg")
    else:
        open(svg_path, "w", encoding="utf-8").write(svg)
        print("  · icons/icon.svg")

    if check:
        if stale:
            print("✗ 오래된 아이콘: " + ", ".join(stale))
            return 1
        print("✓ 아이콘 최신")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(check="--check" in sys.argv[1:]))
