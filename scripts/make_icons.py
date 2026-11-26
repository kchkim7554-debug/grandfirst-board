#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""게시판 관리 시스템 앱 아이콘 생성기 (board/icons/*.png · icon.svg).

디자인 — 상단바 로고와 같은 톤(진한 네이비 #123a63 + 민트)을 그대로 이어받아
  ① 네이비 둥근 사각 바탕     (홈 화면에서 눈에 띄게)
  ② 흰 클립보드(게시판)       + 민트 클립
  ③ 체크 표시(민트 원 + 흰 ✓)  (게시·제거 체크 = 이 앱의 일)
을 겹친 형태. 작은 크기(32px)에서는 줄을 줄이고 체크를 굵게 한 간판형으로 다시 그린다.

사용:
  python3 scripts/make_icons.py            # board/icons/*.png + board/icons/icon.svg 생성
"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)              # board/
OUT = os.path.join(ROOT, "icons")

# ---- 색 (index.html 헤더 로고와 같은 계열) ----
NAVY_TOP = (30, 84, 134)       # #1e5486
NAVY_BOT = (14, 44, 76)        # #0e2c4c
MINT_TOP = (78, 211, 160)      # #4ed3a0
MINT_BOT = (32, 168, 116)      # #20a874
ROW = (201, 217, 230)          # #c9d9e6
ROW_HI = (226, 242, 235)       # #e2f2eb
CHECK_GREEN = (22, 172, 110)   # #16ac6e
WHITE = (255, 255, 255)

UNIT = 1024                    # 디자인 좌표계
SS = 4                         # 슈퍼샘플 배율


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


def draw_icon(px_size=512, *, small=False, square_corners=False, maskable=False):
    """아이콘 한 장을 RGBA 로 그린다.

    small          : 32px 급 — 줄 수를 줄이고 체크를 키운 간판형
    square_corners : apple-touch-icon 용 — 모서리를 깎는다면 iOS 가 깎으므로 네모로
    maskable       : 안드로이드 적응형 — 내용을 80% 안전영역 안으로
    """
    n = px_size * SS
    k = n / float(UNIT)

    def S(v):
        return v * k

    # 1) 바탕 (네이비 세로 그라데이션 + 둥근 모서리)
    bg = _linear((n, n), NAVY_TOP, NAVY_BOT).convert("RGBA")
    if not square_corners:
        bg.putalpha(_rounded_mask(n, S(228)))

    canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    canvas.alpha_composite(bg)

    # 1-1) 왼쪽 위 은은한 하이라이트
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S(-260), S(-380), S(640), S(380)], fill=(255, 255, 255, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(S(90)))
    canvas.alpha_composite(glow)

    # 2) 흰 클립보드 + 그림자
    #  small = 32px 급: 내용을 크게 채워 작은 탭에서도 형태가 남게
    sc = 1.30 if small else (0.82 if maskable else 1.0)
    def C(v):
        """maskable 일 때 중심 기준 82% 축소."""
        return S(UNIT / 2 + (v - UNIT / 2) * sc)

    sheet = ([C(298), C(244), C(706), C(792)] if small else [C(272), C(228), C(752), C(806)])
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
    clip = ([C(448), C(196), C(578), C(266)] if small else [C(430), C(186), C(594), C(262)])
    d.rounded_rectangle(clip, radius=S(36) * sc, fill=WHITE)
    d.rounded_rectangle([clip[0] + S(15) * sc, clip[1] + S(15) * sc,
                         clip[2] - S(15) * sc, clip[3] - S(15) * sc],
                        radius=S(24) * sc, fill=MINT_BOT)
    d.rounded_rectangle([clip[0] + S(15) * sc, clip[1] + S(15) * sc,
                         clip[2] - S(15) * sc, clip[3] - S(40) * sc],
                        radius=S(24) * sc, fill=MINT_TOP)

    # 4) 게시글 줄
    if small:
        rows = []                      # 32px 급은 줄 생략 — 흰 카드 + 굵은 체크로 간판화
        bh, rad = 62, 31
    else:
        rows = [(332, 350, 590), (332, 440, 500), (332, 530, 556)]
        bh, rad = 50, 25
    for i, (x1, y, x2) in enumerate(rows):
        fill = ROW_HI if i == len(rows) - 1 else ROW
        d.rounded_rectangle([C(x1), C(y), C(x2), C(y + bh)],
                            radius=S(rad) * sc, fill=fill)

    # 5) 체크 배지 (민트 원 + 흰 ✓)
    if small:
        # 작은 화면: 흰 카드 위에 민트-그린 체크 하나 (경계 없이 또렷)
        pts = _check_points(C(505), C(548), S(236) * sc, S(268) * sc)
        lw = 96
        d.line(pts, fill=MINT_BOT, width=int(round(S(lw) * sc)), joint="curve")
        for p in (pts[0], pts[2]):
            rr = S(lw) * sc / 2.0
            d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=MINT_BOT)
    else:
        cx, cy, r, ring, lw = 726, 736, 152, 26, 34
        d.ellipse([C(cx) - S(r + ring) * sc, C(cy) - S(r + ring) * sc,
                   C(cx) + S(r + ring) * sc, C(cy) + S(r + ring) * sc], fill=WHITE)
        d.ellipse([C(cx) - S(r) * sc, C(cy) - S(r) * sc,
                   C(cx) + S(r) * sc, C(cy) + S(r) * sc], fill=CHECK_GREEN)
        pts = _check_points(C(cx), C(cy) + S(4) * sc, S(r * 1.02) * sc, S(r * 1.10) * sc)
        d.line(pts, fill=WHITE, width=int(round(S(lw) * sc)), joint="curve")
        for p in (pts[0], pts[2]):
            rr = S(lw) * sc / 2.0
            d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=WHITE)

    return canvas.resize((px_size, px_size), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="게시판 관리">
  <title>게시판 관리 · 풍경채 그랑퍼스트</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e5486"/><stop offset="1" stop-color="#0e2c4c"/>
    </linearGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4ed3a0"/><stop offset="1" stop-color="#20a874"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f3fbf7"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
  <rect x="272" y="248" width="480" height="578" rx="54" fill="#04121f" opacity=".28"/>
  <rect x="272" y="228" width="480" height="578" rx="54" fill="url(#paper)"/>
  <rect x="430" y="186" width="164" height="76" rx="36" fill="#ffffff"/>
  <rect x="445" y="201" width="134" height="46" rx="24" fill="url(#mint)"/>
  <rect x="332" y="350" width="258" height="50" rx="25" fill="#c9d9e6"/>
  <rect x="332" y="440" width="168" height="50" rx="25" fill="#c9d9e6"/>
  <rect x="332" y="530" width="224" height="50" rx="25" fill="#e2f2eb"/>
  <circle cx="726" cy="736" r="178" fill="#ffffff"/>
  <circle cx="726" cy="736" r="152" fill="#16ac6e"/>
  <path d="M647 732 L700 785 L804 673" fill="none" stroke="#ffffff" stroke-width="34"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
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
        f.write(SVG)
    print("✓ %-26s           %6.1f KB" % ("icon.svg", os.path.getsize(os.path.join(OUT, "icon.svg")) / 1024.0))


if __name__ == "__main__":
    main()
