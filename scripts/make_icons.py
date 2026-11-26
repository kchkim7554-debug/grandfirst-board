#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""게시판 관리 시스템 앱 아이콘 생성기 (board/icons/*.png · icon.svg).

디자인 (2026-11-26 사용자 요청 — "글씨좀 넣지 / 풍경채 / 게시판관리" · "아파트 사진도 배경에" · "글자크기 차별" · "글자색 구분")
  · 배경: 단지 조감도 사진(images/bg_complex_aerial.jpg)을 정사각으로 잘라 은은하게 깔고
          그 위에 네이비 반투명 그라데이션(위 75% → 아래 90%) + 아래쪽 민트 워시
  · 위쪽: 민트 체크 배지(흰 테 + 초록 원 + 흰 ✓) — 게시·제거 체크 = 이 앱의 일
  · 가운데: '풍경채'   작은 보조 타이틀 · 밝은 민트(나눔고딕 ExtraBold)
  · 아래:   '게시판관리' 큰 주인공 타이틀 · 선명한 흰색
  글씨 두 줄이 화면을 꽉 채우도록 잉크 폭을 기준으로 폰트 크기를 자동으로 맞추고,
  홈 화면의 작은 아이콘(192px)에서도 읽히도록 글씨에 옅은 그림자를 준다.
  16·32px 파비콘은 글씨가 뭉개지므로 글씨·사진 없이 클립보드+체크 간판형 그대로 둔다.
  maskable(적응형)은 글씨·배지 전체를 0.75배로 줄여 안전영역 안에 넣는다(사진은 화면을 꽉 채움).

사용:
  python3 scripts/make_icons.py            # board/icons/*.png + board/icons/icon.svg 생성
"""
import os
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # board/
WORKSPACE = os.path.dirname(ROOT)                  # 게시판 프로젝트 바깥(공용 fonts/)
OUT = os.path.join(ROOT, "icons")

# ---- 색 (index.html 헤더 로고와 같은 계열) ----
NAVY_TOP = (30, 84, 134)       # #1e5486
NAVY_BOT = (14, 44, 76)        # #0e2c4c
MINT_LIGHT = (126, 245, 200)   # #7ef5c8  '풍경채' 위쪽(밝은 민트)
MINT_DEEP = (52, 214, 158)     # #34d69e  '풍경채' 아래쪽(선명한 민트)
MINT_BOT = (32, 168, 116)      # #20a874  배지
ROW = (201, 217, 230)          # #c9d9e6
ROW_HI = (226, 242, 235)       # #e2f2eb
CHECK_GREEN = (22, 172, 110)   # #16ac6e
WHITE = (255, 255, 255)
INK_SHADOW = (3, 14, 26)

# ---- 글씨 ----
FONT_CANDIDATES = [
    os.path.join(WORKSPACE, "fonts", "NanumGothic-ExtraBold.ttf"),
    os.path.join(WORKSPACE, "fonts", "NanumGothic-Bold.ttf"),
    "/usr/share/fonts/truetype/nanum/NanumGothicExtraBold.ttf",
    "/usr/share/fonts/opentype/nanum/NanumGothicExtraBold.ttf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
]
BRAND_TEXT = "풍경채"
NAME_TEXT = "게시판관리"
TRACK_EM = -0.015              # 자간(글자 크기 대비). 한글이 꽉 차서 살짝 조인다

UNIT = 1024                    # 디자인 좌표계
SS = 4                         # 슈퍼샘플 배율

# ---- 배경 사진 (단지 조감도 — 앱 첫 화면 히어로와 같은 사진) ----
PHOTO_SRC = os.path.join(ROOT, "images", "bg_complex_aerial.jpg")
PHOTO_OUT = os.path.join(OUT, "icon-bg.jpg")      # icon.svg 도 같은 사진을 쓴다
PHOTO_FOCUS = (0.50, 0.47)     # 정사각으로 자를 때 중심(단지가 가운데 오게)
PHOTO_SQUARE_PX = 768
PHOTO_SCRIM_TOP = (NAVY_TOP, 190)   # 사진 위 네이비 반투명 (위)
PHOTO_SCRIM_BOT = (NAVY_BOT, 230)   # 사진 위 네이비 반투명 (아래)
PHOTO_DIM = 0.35                    # 사진 자체를 네이비로 가라앉히는 정도
MINT_WASH = (46, 202, 146, 45)      # 아래쪽 민트 워시

# ---- 글씨판 레이아웃 (디자인 좌표 1024 기준) ----
BADGE_D = 142                  # 체크 배지 지름
GAP_BADGE = 36                 # 배지 → '풍경채'
GAP_LINES = 22                 # '풍경채' → '게시판관리'
W_BRAND = 410                  # '풍경채'   잉크 폭 (작은 보조 타이틀)
W_NAME = 860                   # '게시판관리' 잉크 폭 (주인공 타이틀)
MASKABLE_SC = 0.75             # 적응형 안전영역(지름 80%) 안쪽 — 여백 넉넉히


def _linear(size, top, bot):
    """세로 그라데이션 (size x size)."""
    w, h = size
    small = Image.new("RGB", (1, 256))
    px = small.load()
    for y in range(256):
        t = y / 255.0
        px[0, y] = tuple(int(round(top[i] + (bot[i] - top[i]) * t)) for i in range(3))
    return small.resize((w, h), Image.BILINEAR)


def _rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def _check_points(cx, cy, w, h):
    """중심 (cx, cy) 기준 체크(✓) 꼭짓점 3개."""
    return [
        (cx - w * 0.52, cy + h * 0.02),
        (cx - w * 0.10, cy + h * 0.46),
        (cx + w * 0.62, cy - h * 0.44),
    ]


def _font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit(
        "한글 굵은 폰트를 찾지 못했습니다. 다음 중 하나를 두세요:\n  "
        + "\n  ".join(FONT_CANDIDATES))


@lru_cache(maxsize=None)
def _font(size_px):
    return ImageFont.truetype(_font_path(), int(round(size_px)))


def _measure(text, font, tracking):
    return sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def _fit_text(text, target_w, track_em):
    """잉크 폭이 target_w 에 맞는 (폰트, 자간) 을 찾는다."""
    size = float(target_w) / max(1, len(text)) * 1.06
    for _ in range(6):
        f = _font(size)
        w = _measure(text, f, track_em * size)
        if w <= 0:
            break
        nxt = size * target_w / w
        if abs(nxt - size) < 0.4:
            size = nxt
            break
        size = nxt
    f = _font(size)
    return f, track_em * size


def _line_mask(text, target_w, n):
    """한 줄을 (n x n) 투명 마스크에 가운데 정렬로 그려, 잉크 영역만 잘라 돌려준다."""
    font, track = _fit_text(text, target_w, TRACK_EM)
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    adv = [font.getlength(ch) for ch in text]
    total = sum(adv) + track * (len(text) - 1)
    x = (n - total) / 2.0
    base = n * 0.70
    for ch, a in zip(text, adv):
        d.text((x, base), ch, font=font, fill=255, anchor="ls")
        x += a + track
    bb = m.getbbox()
    if bb is None:
        raise SystemExit("글씨를 그리지 못했습니다: %r" % text)
    return m.crop(bb)


def _paste_text(canvas, mask, xy, top, bot, k):
    """그림자 + 그라데이션 글씨를 canvas 에 얹는다."""
    w, h = mask.size
    x, y = int(round(xy[0])), int(round(xy[1]))

    # 옅은 그림자 (작은 아이콘에서 글씨 테두리를 살린다)
    sh = Image.new("L", canvas.size, 0)
    sh.paste(mask, (x, y + int(round(8 * k))))
    sh = sh.filter(ImageFilter.GaussianBlur(6 * k))
    sh = sh.point(lambda v: int(v * 0.34))
    dark = Image.new("RGBA", canvas.size, INK_SHADOW + (255,))
    dark.putalpha(sh)
    canvas.alpha_composite(dark)

    # 글씨 몸통 (위→아래 그라데이션)
    grad = _linear((w, h), top, bot).convert("RGBA")
    grad.putalpha(mask)
    canvas.alpha_composite(grad, (x, y))


def _draw_badge(canvas, cx, cy, d_px, k):
    """민트 체크 배지 — 흰 테 + 초록 원 + 흰 ✓."""
    d = ImageDraw.Draw(canvas)
    r = d_px / 2.0
    ring = 13 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    d.ellipse([cx - r + ring, cy - r + ring, cx + r - ring, cy + r - ring], fill=CHECK_GREEN)
    lw = 19 * k
    pts = _check_points(cx, cy + 2 * k, d_px * 0.50, d_px * 0.56)
    d.line(pts, fill=WHITE, width=int(round(lw)), joint="curve")
    for p in (pts[0], pts[2]):
        rr = lw / 2.0
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=WHITE)


def _grad_rgba(size, top, bot, start=0.0):
    """(색, 알파) 두 점 사이 세로 그라데이션. start 이후 구간만 알파가 자란다."""
    c0, a0 = top
    c1, a1 = bot
    ramp = Image.new("L", (1, 256))
    for y in range(256):
        t = (y / 255.0 - start) / max(1e-6, 1.0 - start)
        ramp.putpixel((0, y), int(round(a0 + (a1 - a0) * max(0.0, min(1.0, t)))))
    alpha = ramp.resize(size, Image.BILINEAR)
    col = _linear(size, c0, c1).convert("RGBA")
    col.putalpha(alpha)
    return col


def _photo_square():
    """단지 조감도를 정사각으로 자른다."""
    im = Image.open(PHOTO_SRC).convert("RGB")
    w, h = im.size
    side = min(w, h)
    cx, cy = int(w * PHOTO_FOCUS[0]), int(h * PHOTO_FOCUS[1])
    left = max(0, min(w - side, cx - side // 2))
    top = max(0, min(h - side, cy - side // 2))
    return im.crop((left, top, left + side, top + side))


@lru_cache(maxsize=4)
def _photo(size):
    return _photo_square().resize((size, size), Image.LANCZOS).convert("RGBA")


def _bg(canvas, n, k, square_corners, photo=True):
    """단지 사진 + 네이비/민트 반투명 오버레이 + 둥근 모서리."""
    base = _linear((n, n), NAVY_TOP, NAVY_BOT).convert("RGBA")

    if photo and os.path.exists(PHOTO_SRC):
        ph = _photo(n).filter(ImageFilter.GaussianBlur(1.6 * k))
        # 사진을 살짝 가라앉혀 글씨 대비를 올린다
        ph = Image.blend(ph, Image.new("RGBA", (n, n), NAVY_BOT + (255,)), PHOTO_DIM)
        base.alpha_composite(ph)
        base.alpha_composite(_grad_rgba((n, n), PHOTO_SCRIM_TOP, PHOTO_SCRIM_BOT))
        base.alpha_composite(_grad_rgba((n, n), (MINT_WASH[:3], 0), (MINT_WASH[:3], MINT_WASH[3]), start=0.55))

    if not square_corners:
        mask = base.getchannel("A")
        mask = Image.frombytes("L", mask.size, mask.tobytes())
        base.putalpha(ImageChops.multiply(mask, _rounded_mask(n, 228 * k)))

    canvas.alpha_composite(base)

    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-260 * k, -380 * k, 640 * k, 380 * k], fill=(255, 255, 255, 20))
    glow = glow.filter(ImageFilter.GaussianBlur(90 * k))
    canvas.alpha_composite(glow)


def _words_content(n, k):
    """배지 + 두 줄 글씨를 (n x n) 투명 레이어에 그린다."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    ink_brand = _line_mask(BRAND_TEXT, W_BRAND * k, n)
    ink_name = _line_mask(NAME_TEXT, W_NAME * k, n)
    hb = BADGE_D * k
    h1, h2 = ink_brand.size[1], ink_name.size[1]

    total = hb + GAP_BADGE * k + h1 + GAP_LINES * k + h2
    y = (n - total) / 2.0

    _draw_badge(layer, n / 2.0, y + hb / 2.0, hb, k)

    y1 = y + hb + GAP_BADGE * k
    _paste_text(layer, ink_brand, ((n - ink_brand.size[0]) / 2.0, y1), MINT_LIGHT, MINT_DEEP, k)

    y2 = y1 + h1 + GAP_LINES * k
    _paste_text(layer, ink_name, ((n - ink_name.size[0]) / 2.0, y2), (255, 255, 255), (245, 253, 250), k)

    return layer


def draw_icon(px_size=512, *, small=False, square_corners=False, maskable=False):
    """아이콘 한 장을 RGBA 로 그린다.

    small          : 16·32px 파비콘 — 글씨 없이 클립보드+굵은 체크 간판형
    square_corners : apple-touch-icon 용 — iOS 가 모서리를 깎으므로 네모로
    maskable       : 안드로이드 적응형 — 내용을 82% 안전영역 안으로
    """
    n = px_size * SS
    k = n / float(UNIT)

    canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    _bg(canvas, n, k, square_corners, photo=not small)

    if not small:
        content = _words_content(n, k)
        if maskable:
            side = int(round(n * MASKABLE_SC))
            content = content.resize((side, side), Image.LANCZOS)
            canvas.alpha_composite(content, ((n - side) // 2, (n - side) // 2))
        else:
            canvas.alpha_composite(content)
        return canvas.resize((px_size, px_size), Image.LANCZOS)

    # ---------- 이하 16·32px 파비콘: 글씨 없이 클립보드 + 체크 ----------
    def S(v):
        return v * k

    # 2) 흰 클립보드 + 그림자 (작은 크기: 내용을 크게 채워 형태가 남게)
    sc = 1.30

    def C(v):
        return S(UNIT / 2 + (v - UNIT / 2) * sc)

    sheet = [C(298), C(244), C(706), C(792)]
    sh = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [sheet[0], sheet[1] + S(20), sheet[2], sheet[3] + S(20)],
        radius=C(52) - C(0), fill=(4, 18, 32, 92))
    sh = sh.filter(ImageFilter.GaussianBlur(S(22)))
    canvas.alpha_composite(sh)

    paper = _linear((n, n), (255, 255, 255), (243, 251, 247)).convert("RGBA")
    pm = Image.new("L", (n, n), 0)
    ImageDraw.Draw(pm).rounded_rectangle(sheet, radius=S(54) * sc, fill=255)
    paper.putalpha(pm)
    canvas.alpha_composite(paper)

    d = ImageDraw.Draw(canvas)

    # 3) 민트 클립 (클립보드 상단)
    clip = [C(448), C(196), C(578), C(266)]
    d.rounded_rectangle(clip, radius=S(36) * sc, fill=WHITE)
    d.rounded_rectangle([clip[0] + S(15) * sc, clip[1] + S(15) * sc,
                         clip[2] - S(15) * sc, clip[3] - S(15) * sc],
                        radius=S(24) * sc, fill=MINT_BOT)
    d.rounded_rectangle([clip[0] + S(15) * sc, clip[1] + S(15) * sc,
                         clip[2] - S(15) * sc, clip[3] - S(40) * sc],
                        radius=S(24) * sc, fill=(78, 211, 160))

    # 4) 체크 배지 (흰 카드 위 민트-그린 체크 하나, 경계 없이 또렷)
    pts = _check_points(C(505), C(548), S(236) * sc, S(268) * sc)
    lw = 96
    d.line(pts, fill=MINT_BOT, width=int(round(S(lw) * sc)), joint="curve")
    for p in (pts[0], pts[2]):
        rr = S(lw) * sc / 2.0
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=MINT_BOT)

    return canvas.resize((px_size, px_size), Image.LANCZOS)


@lru_cache(maxsize=None)
def _tt():
    """글씨 폰트를 fontTools 로 연다 (SVG 용 윤곽선 추출)."""
    tt = TTFont(_font_path(), fontNumber=0)
    return tt, tt.getBestCmap(), tt.getGlyphSet(), tt["head"].unitsPerEm


def _design_line(text, target_w):
    """디자인 좌표(1024)에서 한 줄의 글리프 배치·윤곽선·잉크 상자를 계산한다."""
    font, track = _fit_text(text, target_w, TRACK_EM)   # 치수 = 디자인 좌표
    size = float(font.size)
    _tt_obj, cmap, gs, upm = _tt()
    s = size / float(upm)

    glyphs, x = [], 0.0
    for ch in text:
        gn = cmap[ord(ch)]
        bp = BoundsPen(gs)
        gs[gn].draw(bp)
        pen = SVGPathPen(gs)
        gs[gn].draw(pen)
        glyphs.append((x, pen.getCommands(), bp.bounds))
        x += gs[gn].width * s + track

    xs0 = min(gx + b[0] * s for gx, _d, b in glyphs)
    xs1 = max(gx + b[2] * s for gx, _d, b in glyphs)
    ys1 = max(b[3] * s for _gx, _d, b in glyphs)      # 베이스라인 위쪽 잉크(top, +)
    ys0 = min(b[1] * s for _gx, _d, b in glyphs)
    return dict(glyphs=glyphs, s=s, w=xs1 - xs0, h=ys1 - ys0, x0=xs0, y_top=ys1)


def _svg():
    """같은 도안의 벡터 아이콘 — 글씨는 폰트 의존 없이 <path> 윤곽선으로 새긴다."""
    brand = _design_line(BRAND_TEXT, W_BRAND)
    name = _design_line(NAME_TEXT, W_NAME)

    total = BADGE_D + GAP_BADGE + brand["h"] + GAP_LINES + name["h"]
    top = (UNIT - total) / 2.0
    badge_cy = top + BADGE_D / 2.0
    y_brand = top + BADGE_D + GAP_BADGE      # '풍경채' 잉크 위쪽
    y_name = y_brand + brand["h"] + GAP_LINES

    def line_paths(line, ink_top):
        left = (UNIT - line["w"]) / 2.0
        X = left - line["x0"]
        base = ink_top + line["y_top"]       # 베이스라인 y (화면 좌표)
        s = line["s"]
        out = []
        for gx, d, _b in line["glyphs"]:
            out.append('<path transform="translate(%.2f %.2f) scale(%.6f %.6f)" d="%s"/>'
                       % (X + gx, base, s, -s, d))
        return "".join(out)

    check = _check_points(UNIT / 2, badge_cy + 2, BADGE_D * 0.50, BADGE_D * 0.56)
    has_photo = os.path.exists(PHOTO_SRC)
    dim = ('<rect width="1024" height="1024" fill="#0e2c4c" opacity="%.2f"/>' % PHOTO_DIM)
    photo_xml = ('<g clip-path="url(#clip)">'
                 '<image href="icon-bg.jpg" xlink:href="icon-bg.jpg" x="0" y="0" '
                 'width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>'
                 + dim +
                 '<rect width="1024" height="1024" fill="url(#scrim)"/>'
                 '<rect width="1024" height="1024" fill="url(#mintwash)"/>'
                 '</g>') if has_photo else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="풍경채 게시판관리">
  <title>풍경채 게시판관리</title>
  <defs>
    <clipPath id="clip"><rect width="1024" height="1024" rx="228"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e5486"/><stop offset="1" stop-color="#0e2c4c"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e5486" stop-opacity="{PHOTO_SCRIM_TOP[1] / 255:.3f}"/>
      <stop offset="1" stop-color="#0e2c4c" stop-opacity="{PHOTO_SCRIM_BOT[1] / 255:.3f}"/>
    </linearGradient>
    <linearGradient id="mintwash" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".55" stop-color="#2eca92" stop-opacity="0"/>
      <stop offset="1" stop-color="#2eca92" stop-opacity="{MINT_WASH[3] / 255:.3f}"/>
    </linearGradient>
    <linearGradient id="mint" gradientUnits="userSpaceOnUse" x1="0" y1="{y_brand:.1f}" x2="0" y2="{y_brand + brand['h']:.1f}">
      <stop offset="0" stop-color="#7ef5c8"/><stop offset="1" stop-color="#34d69e"/>
    </linearGradient>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="{y_name:.1f}" x2="0" y2="{y_name + name['h']:.1f}">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f5fdfa"/>
    </linearGradient>
    <filter id="ts" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#030e1a" flood-opacity=".34"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>{photo_xml}
  <g filter="url(#ts)">
    <circle cx="{UNIT/2:.0f}" cy="{badge_cy:.2f}" r="{BADGE_D/2:.0f}" fill="#ffffff"/>
    <circle cx="{UNIT/2:.0f}" cy="{badge_cy:.2f}" r="{BADGE_D/2-13:.0f}" fill="#16ac6e"/>
    <path d="M{check[0][0]:.1f} {check[0][1]:.1f} L{check[1][0]:.1f} {check[1][1]:.1f} L{check[2][0]:.1f} {check[2][1]:.1f}"
          fill="none" stroke="#ffffff" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g filter="url(#ts)" fill="url(#mint)">{line_paths(brand, y_brand)}</g>
  <g filter="url(#ts)" fill="url(#ink)">{line_paths(name, y_name)}</g>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    print("· 글씨 폰트: %s" % _font_path())

    # 배경 사진(정사각 크롭) — PNG 와 icon.svg 가 같은 사진을 쓴다
    if os.path.exists(PHOTO_SRC):
        _photo_square().resize((PHOTO_SQUARE_PX, PHOTO_SQUARE_PX), Image.LANCZOS).save(
            PHOTO_OUT, quality=86, optimize=True, progressive=True)
        print("✓ %-26s %4dpx  %6.1f KB" % ("icon-bg.jpg", PHOTO_SQUARE_PX,
                                          os.path.getsize(PHOTO_OUT) / 1024.0))
    else:
        print("! 배경 사진이 없습니다(%s) — 네이비 그라데이션만으로 그립니다" % PHOTO_SRC)

    jobs = [
        ("icon-512.png", dict(px_size=512)),
        ("icon-192.png", dict(px_size=192)),
        ("icon-maskable-512.png", dict(px_size=512, maskable=True, square_corners=True)),
        ("apple-touch-icon-180.png", dict(px_size=180, square_corners=True)),
        ("favicon-32.png", dict(px_size=32, small=True)),
        ("favicon-16.png", dict(px_size=16, small=True)),
    ]
    for name, kw in jobs:
        img = draw_icon(**kw)
        if name.startswith("apple-touch-icon"):
            img = img.convert("RGB")           # iOS: 투명도 없이
        path = os.path.join(OUT, name)
        img.save(path, optimize=True)
        print("✓ %-26s %4dpx  %6.1f KB" % (name, kw["px_size"], os.path.getsize(path) / 1024.0))

    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(_svg())
    print("✓ %-26s           %6.1f KB" % ("icon.svg", os.path.getsize(os.path.join(OUT, "icon.svg")) / 1024.0))


if __name__ == "__main__":
    main()
