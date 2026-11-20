#!/usr/bin/env python3
"""게시판 제거 공지 카드 합성기.

안내 문구 + 체크마크(✓) 위치 배치도 + 제거 대상 게시물 사진을 한 장의
공지 카드 이미지로 합친다. 카톡으로 공유해도 모바일에서 한눈에 읽히도록
가로 1600px 기준으로 설계하고, 내부는 2배 슈퍼샘플링해 글자를 선명하게 그린다.

    python3 board/make_removal_card.py \
      --title "오늘(11/20 금) B조 제거 대상 ①" \
      --message "전층(1·B1·B2) 공동현관 03번 첫 번째 게시물 [승강기 정기 점검] 오늘 제거 바랍니다." \
      --board-type lobby --slots 03 \
      --notice-image board/images/r01_elevator_inspection.jpg \
      --out board/templates/cards/2026-11-20_R01.jpg

체크 배치도는 board/mark_slot.py 로 만들어 board/templates/checked/ 에도 남긴다.

좌표 규칙: 모든 레이아웃 수치는 '디자인 단위'(가로 1600 기준)로 쓰고,
그릴 때 U()=×슈퍼샘플 배율 로 픽셀을 만들며 글꼴도 같은 배율로 키운다.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import mark_slot as MS  # noqa: E402
import slotmap as S  # noqa: E402

WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

# --- 팔레트 ---------------------------------------------------------------
BG_OUT = (233, 237, 243)       # 카드 바깥 여백
CARD = (255, 255, 255)         # 카드 바탕
INK = (21, 32, 54)             # 본문 진한 남색
MUTED = (99, 109, 126)         # 캡션·보조 글자
ACCENT = (212, 32, 40)         # 강조 빨강 (체크마크와 같은 계열)
NAVY = (19, 45, 84)            # 배지·마커
LINE = (222, 228, 237)         # 구분선
FRAME = (212, 219, 230)        # 사진 테두리
INFOBG = (245, 248, 252)       # 요약 박스 바탕
INFOLINE = (226, 233, 243)

BOARD_LABEL = {"lobby": "공동현관 홀", "elevator": "엘리베이터"}

# --- 글꼴 ----------------------------------------------------------------
PRIMARY = S.FONT_XBOLD
PRIMARY_B = S.FONT_BOLD
PRIMARY_R = S.FONT_REG
FALLBACK = "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf"

_CMAP_CACHE: dict[str, set[int]] = {}
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _cmap(path: str) -> set[int]:
    """폰트가 실제로 가진 글자 집합(읽지 못하면 빈 집합 → 검사 생략)."""
    if path in _CMAP_CACHE:
        return _CMAP_CACHE[path]
    cov: set[int] = set()
    try:
        from fontTools.ttLib import TTFont

        with TTFont(path, lazy=True) as tt:
            cov = set(tt.getBestCmap().keys())
    except Exception:
        cov = set()
    _CMAP_CACHE[path] = cov
    return cov


def _covered(path: str, ch: str) -> bool:
    cov = _cmap(path)
    if not cov:
        return True
    return ord(ch) in cov


def font(path: str, size: float) -> ImageFont.FreeTypeFont:
    key = (path, max(6, int(round(size))))
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, key[1])
    return _FONT_CACHE[key]


CIRCLED = {chr(0x2460 + i): i + 1 for i in range(20)}       # ①~⑳
CIRCLED.update({chr(0x2776 + i): i + 1 for i in range(10)})  # ❶~❿


# --- 글자 → 스팬(폰트/색/동그라미 숫자) -------------------------------------
def spans(text: str, path: str, size: int, color, scale: float = 1.0,
          circled_color=None, circled_text=(255, 255, 255)) -> list[dict]:
    """한 문자열을 폰트 폴백까지 반영한 스팬 목록으로 나눈다.

    기본 폰트에 없는 글자는 Noto 로 넘기고, 둘 다 없으면(이모지 등) 버린다.
    동그라미 숫자(①…)는 폰트 글리프 대신 직접 그려 색을 입힌다.
    """
    px = size * scale
    out: list[dict] = []
    for ch in text:
        if ch in CIRCLED:
            out.append({"kind": "circled", "n": CIRCLED[ch], "size": px,
                        "color": circled_color or ACCENT, "text_color": circled_text})
            continue
        if ch.isspace():
            out.append({"kind": "text", "text": " ", "font": font(path, px),
                        "font_path": path + "|space", "color": color})
            continue
        use = path if _covered(path, ch) else (FALLBACK if _covered(FALLBACK, ch) else None)
        if use is None:
            continue
        if out and out[-1]["kind"] == "text" and out[-1].get("font_path") == use:
            out[-1]["text"] += ch
        else:
            out.append({"kind": "text", "text": ch, "font": font(use, px),
                        "font_path": use, "color": color})
    return out


def span_w(s: dict) -> float:
    if s["kind"] == "circled":
        return s["size"] * 1.20
    return s["font"].getlength(s["text"])


def line_w(spans_: list[dict]) -> float:
    return sum(span_w(s) for s in spans_)


def draw_spans(d: ImageDraw.ImageDraw, x: float, y: float, spans_: list[dict]):
    """(x, y) 는 줄의 왼쪽·어센더 기준."""
    for s in spans_:
        if s["kind"] == "circled":
            r = s["size"] * 0.50
            cy = y + s["size"] * 0.62
            d.ellipse([x, cy - r, x + 2 * r, cy + r], fill=s["color"])
            d.text((x + r, cy), str(s["n"]), font=font(PRIMARY_B, s["size"] * 0.62),
                   fill=s["text_color"], anchor="mm")
            x += s["size"] * 1.20
        else:
            d.text((x, y), s["text"], font=s["font"], fill=s["color"], anchor="la")
            x += s["font"].getlength(s["text"])


def wrap_words(words: list[list[dict]], space: dict, max_w: float) -> list[list[dict]]:
    """단어 스팬 목록을 폭에 맞춰 줄로 나눈다(줄 끝 공백은 버린다)."""
    lines: list[list[dict]] = []
    cur: list[dict] = []
    cur_w = 0.0
    for w in words:
        ww = line_w(w)
        if cur and cur_w + span_w(space) + ww > max_w:
            lines.append(cur)
            cur = list(w)
            cur_w = ww
        else:
            if cur:
                cur.append(space)
                cur_w += span_w(space)
            cur.extend(w)
            cur_w += ww
    if cur:
        lines.append(cur)
    return lines


# --- 작은 그리기 도구 ------------------------------------------------------
def rounded(d, box, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def highlight_ranges(message: str, slot_nums: list[int]):
    """메시지에서 강조할 구간: [대괄호 제목] 과 '03번' 같은 칸 번호."""
    ranges: list[tuple[int, int]] = []
    for m in re.finditer(r"\[[^\]]*\]", message):
        ranges.append((m.start(), m.end()))
    for n in slot_nums:
        for m in re.finditer(rf"(?<![\d])0?{n}\s*번", message):
            ranges.append((m.start(), m.end()))
    return ranges


def in_ranges(a: int, b: int, ranges) -> bool:
    return any(a < r[1] and b > r[0] for r in ranges)


def message_lines(text: str, max_w: float, size: int, ranges, scale: float,
                  accent=ACCENT, ink=INK):
    """강조 구간을 반영해 줄별 스팬 목록을 만든다.

    '[승강기 정기 점검]' 같은 대괄호 제목은 통째로 한 묵음으로 취급해
    줄바꿈이 제목 중간에서 끊기는 일을 막는다.
    """
    atoms: list[tuple[int, int, str]] = []
    pos = 0
    for m in re.finditer(r"\[[^\]]*\]", text):
        atoms += [(pos + w.start(), pos + w.end(), w.group(0))
                  for w in re.finditer(r"\S+", text[pos:m.start()])]
        atoms.append((m.start(), m.end(), m.group(0)))
        pos = m.end()
    atoms += [(pos + w.start(), pos + w.end(), w.group(0))
              for w in re.finditer(r"\S+", text[pos:])]

    words: list[list[dict]] = []
    space = spans(" ", PRIMARY_R, size, ink, scale=scale)[0]
    for a, b, chunk in atoms:
        color = accent if in_ranges(a, b, ranges) else ink
        pieces = [chunk]
        sp = spans(chunk, PRIMARY, size, color, scale=scale, circled_color=NAVY)
        if line_w(sp) > max_w:                     # 너무 긴 묶음은 다시 단어로 쪼갠다
            pieces = chunk.split()
        for piece in pieces:
            words.append(spans(piece, PRIMARY, size, color, scale=scale,
                               circled_color=NAVY))
    return wrap_words(words, space, max_w)


def fit_message(text: str, max_w: float, max_lines: int, ranges, scale: float,
                sizes=(72, 68, 64, 60, 56, 52, 48)):
    """폭·줄 수에 맞는 가장 큰 글자 크기를 고른다."""
    for size in sizes:
        lines = message_lines(text, max_w, size, ranges, scale)
        if lines and len(lines) <= max_lines and all(line_w(l) <= max_w for l in lines):
            if len(lines) > 1:
                lines = balance_lines(text, size, ranges, scale, max_w, len(lines))
            return size, lines
    size = sizes[-1]
    return size, message_lines(text, max_w, size, ranges, scale)


def widest_atom(text: str, size: int, scale: float) -> float:
    """대괄호 제목처럼 통째로 묶인 덩어리 중 가장 넓은 것(줄바꿈 하한)."""
    widest = 0.0
    for m in re.finditer(r"\[[^\]]*\]", text):
        widest = max(widest, line_w(spans(m.group(0), PRIMARY, size, INK, scale=scale)))
    return widest


def balance_lines(text: str, size: int, ranges, scale: float, max_w: float, n: int):
    """줄 수를 유지하면서 마지막 줄이 홀로 남지 않게 폭을 줄여 고르게 나눈다.

    대괄호 제목이 중간에서 끊기지 않도록 그 폭보다 좀은 폭은 시도하지 않는다.
    """
    lowest = max(max_w * 0.60, widest_atom(text, size, scale) + 4)
    best = None
    frac = 100
    while True:
        w = max_w * frac / 100.0
        if w < lowest:
            break
        lines = message_lines(text, w, size, ranges, scale)
        if len(lines) == n:
            score = max(line_w(l) for l in lines) - 0.45 * min(line_w(l) for l in lines)
            if best is None or score < best[0]:
                best = (score, lines)
        frac -= 2
    return best[1] if best else message_lines(text, max_w, size, ranges, scale)


def fit_one_line(text: str, path: str, max_w_px: float, start: int,
                 minimum: int = 18, scale: float = 1.0):
    """한 줄에 들어가는 가장 큰 크기(디자인 단위). max_w_px 는 캔버스 픽셀."""
    size = start
    while size > minimum:
        if font(path, size * scale).getlength(text) <= max_w_px:
            return size
        size -= 1
    return minimum


# --- 카드 -----------------------------------------------------------------
def build(args):
    SS = float(args.supersample)
    CW = int(args.card_width)
    MARGIN = 26
    PAD_X = 64
    PAD_TOP = 54
    PAD_BOTTOM = 42
    GAP = 26

    def U(v: float) -> int:            # 디자인 단위 → 캔버스 픽셀
        return int(round(v * SS))

    def F(path: str, size: float):     # 디자인 단위 크기 글꼴
        return font(path, size * SS)

    content_w = CW - 2 * MARGIN - 2 * PAD_X
    area_w = content_w

    nums = MS.parse_numbers(args.slots)
    tag = "_".join(f"{n:02d}" for n in nums)

    # 1) 체크마크 배치도 생성 (mark_slot.py 재사용)
    checked_path = os.path.join(HERE, "templates", "checked", f"{args.board_type}_{tag}.jpg")
    MS.mark(args.board_type, nums, checked_path)

    board_img = ImageOps.exif_transpose(Image.open(checked_path)).convert("RGB")
    notice_img = ImageOps.exif_transpose(Image.open(args.notice_image)).convert("RGB")

    # 2) 두 사진 배치(원본 비율 유지)
    a_b = board_img.width / board_img.height
    a_n = notice_img.width / notice_img.height
    eq_h = (area_w - GAP) / (a_b + a_n)
    min_notice_w = area_w * 0.40
    max_h = 980
    if eq_h <= max_h and a_n * eq_h >= min_notice_w:
        layout = "row"
        h_n = eq_h
        w_n = a_n * h_n
        w_b = area_w - GAP - w_n
        h_b = w_b / a_b
    else:
        layout = "split"
        w_n = area_w * 0.40
        h_n = w_n / a_n
        if h_n > max_h:
            h_n = max_h
            w_n = a_n * h_n
        w_b = area_w - GAP - w_n
        h_b = w_b / a_b
        if h_b > max_h:
            h_b = max_h
            w_b = a_b * h_b

    # 3) 제목 배지·본문 측정
    ranges = highlight_ranges(args.message, nums)
    msg_size, msg_lines = fit_message(args.message, U(area_w), 3, ranges, SS)

    cap_size = 33
    cap_h = cap_size * 1.5
    footer_size = 28
    footer_h = footer_size * 2.0

    # 제목 배지 폭은 실제 그릴 때 쓰는 스팬으로 잰다
    title_spans = spans(args.title, PRIMARY, 44, (255, 255, 255), scale=SS,
                        circled_color=ACCENT)
    title_size = 44
    while title_size > 24:
        ts = spans(args.title, PRIMARY, title_size, (255, 255, 255), scale=SS,
                   circled_color=ACCENT)
        if line_w(ts) <= U(area_w - 76):
            title_spans = ts
            break
        title_size -= 1
    pill_h = title_size * 2.0
    title_gap = U(12)
    pill_w = min(U(area_w), line_w(title_spans) + U(76))

    block_h = max(h_b, h_n)
    left_extra = block_h - h_b

    # 4) 요약 박스(왼쪽 열이 비면 채운다)
    slot_count = len(S.load_slots()["images"][args.board_type]["slots"])
    floor_text = floor_prefix(args.message, args.board_type)
    info_rows = []
    if floor_text:
        info_rows.append(("층", floor_text))
    info_rows += [
        ("게시판", f"{BOARD_LABEL.get(args.board_type, args.board_type)} {slot_count}칸"),
        ("칸 번호", "·".join(f"{n:02d}" for n in nums) + "번"),
        ("게시물", bracket_title(args.message) or "첫 번째 게시물"),
    ]
    row_h = 56
    info_h = 22 * 2 + row_h * len(info_rows)
    use_info = (not args.no_info) and layout == "split" and left_extra >= info_h + 20

    # 5) 전체 높이
    lines_h = msg_size * 1.44 * len(msg_lines)
    y = MARGIN + PAD_TOP
    y += pill_h + 34                       # 배지
    y += lines_h + 40                      # 본문
    y += 2 + 36                            # 구분선
    y += cap_h + 12                        # 캡션
    images_top = y
    images_bottom = images_top + block_h
    y = images_bottom + 44 + 2 + footer_size * 1.9 + PAD_BOTTOM + MARGIN
    CH = int(round(y))

    W, H = U(CW), U(CH)
    img = Image.new("RGB", (W, H), BG_OUT)

    # 카드 그림자 + 카드 본체
    card_box = [U(MARGIN), U(MARGIN), W - U(MARGIN), H - U(MARGIN)]
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [card_box[0], card_box[1] + U(6), card_box[2], card_box[3] + U(9)],
        radius=U(30), fill=(18, 32, 58, 40))
    img = Image.alpha_composite(img.convert("RGBA"),
                                sh.filter(ImageFilter.GaussianBlur(U(13)))).convert("RGB")
    d = ImageDraw.Draw(img)
    rounded(d, card_box, U(30), fill=CARD)

    x0 = U(MARGIN + PAD_X)
    x1 = U(CW - MARGIN - PAD_X)

    # --- 배지 ------------------------------------------------------------
    y = MARGIN + PAD_TOP
    rounded(d, [x0, y, x0 + pill_w, y + U(pill_h)], U(pill_h / 2), fill=NAVY)
    asc, desc = F(PRIMARY, title_size).getmetrics()
    ty = y + (U(pill_h) - (asc + desc)) / 2
    draw_spans(d, x0 + U(38), ty, title_spans)

    # --- 본문 ------------------------------------------------------------
    y += U(pill_h) + U(34)
    for line in msg_lines:
        draw_spans(d, x0, y, line)
        y += U(msg_size * 1.44)

    # --- 구분선 ----------------------------------------------------------
    y += U(40)
    d.rectangle([x0, y, x1, y + U(2)], fill=LINE)
    d.rectangle([x0, y, x0 + U(96), y + U(2)], fill=ACCENT)

    # --- 캡션 ------------------------------------------------------------
    cap_y = y + U(2) + U(36)
    cap_size_used = fit_one_line(
        f"위치: {BOARD_LABEL.get(args.board_type)} {'·'.join(f'{n:02d}' for n in nums)}번",
        PRIMARY_B, U(area_w * 0.42), cap_size, scale=SS)
    for cap, marker, cx in [
        (f"위치: {BOARD_LABEL.get(args.board_type)} {'·'.join(f'{n:02d}' for n in nums)}번",
         ACCENT, x0),
        ("제거 대상 게시물", NAVY, x0 + U(w_b + GAP)),
    ]:
        m = U(13)
        top = cap_y + U(cap_size_used * 0.34)
        d.rounded_rectangle([cx, top, cx + m, top + m], radius=U(3), fill=marker)
        d.text((cx + m + U(12), cap_y), cap, font=F(PRIMARY_B, cap_size_used),
               fill=(58, 70, 90), anchor="la")

    # --- 사진 ------------------------------------------------------------
    def place(im: Image.Image, cx: float, cy: float, w: float, h: float, radius=14):
        bw, bh = U(w), U(h)
        bx, by = U(cx), U(cy)
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw - 1, bh - 1],
                                               radius=U(radius), fill=255)
        fitted = ImageOps.pad(im, (bw, bh), color=(250, 251, 253), method=Image.LANCZOS)
        img.paste(fitted, (bx, by), mask)
        d.rounded_rectangle([bx, by, bx + bw - 1, by + bh - 1], radius=U(radius),
                            outline=FRAME, width=max(1, U(1.6)))

    img_top = images_top
    b_y = img_top + (left_extra / 2 if not use_info and left_extra > 0 else 0)
    place(board_img, x0, b_y, w_b, h_b)
    place(notice_img, x0 + w_b + GAP, img_top, w_n, h_n)

    # --- 요약 박스 --------------------------------------------------------
    if use_info:
        by = U(img_top + block_h - info_h)
        rounded(d, [x0, by, x0 + U(w_b), by + U(info_h)], U(16),
                fill=INFOBG, outline=INFOLINE, width=max(1, U(1.6)))
        ry = by + U(22)
        for i, (label, value) in enumerate(info_rows):
            mid = ry + U(row_h / 2)
            d.text((x0 + U(28), mid), label, font=F(PRIMARY_B, 27),
                   fill=MUTED, anchor="lm")
            vsize = fit_one_line(value, PRIMARY, U(w_b - 52 - 152), 33, 18, SS)
            d.text((x0 + U(152), mid), value, font=F(PRIMARY, vsize), fill=INK, anchor="lm")
            ry += U(row_h)
            if i < len(info_rows) - 1:
                d.line([x0 + U(28), ry, x0 + U(w_b) - U(28), ry],
                       fill=INFOLINE, width=max(1, U(1.4)))

    # --- 푸터 ------------------------------------------------------------
    fy = U(images_bottom) + U(44)
    d.rectangle([x0, fy, x1, fy + U(2)], fill=LINE)
    fy += U(2) + U(20)
    foot = args.footer_left or "제일풍경채 그랑퍼스트 별하람마을 1단지 · 게시판 기한관리"
    d.text((x0, fy), foot, font=F(PRIMARY_R, footer_size), fill=MUTED, anchor="la")
    right = args.footer_right if args.footer_right is not None else \
        f"{args.date_text} ({WEEKDAYS[args.date.weekday()]})"
    d.text((x1, fy), right, font=F(PRIMARY_B, footer_size), fill=(58, 70, 90), anchor="ra")

    out = img.resize((int(round(W / SS)), int(round(H / SS))), Image.LANCZOS)
    meta = {
        "layout": layout,
        "board_px": (int(round(w_b)), int(round(h_b))),
        "notice_px": (int(round(w_n)), int(round(h_n))),
        "msg_size": msg_size,
        "msg_lines": len(msg_lines),
        "info_box": bool(use_info),
        "checked": checked_path,
        "size": out.size,
    }
    return out, meta


def bracket_title(message: str) -> str:
    m = re.search(r"\[([^\]]+)\]", message)
    return m.group(1).strip() if m else ""


def floor_prefix(message: str, board_type: str) -> str:
    """메시지에서 게시판 이름 앞의 층 표기를 봽아낸다.

    '전층(1·B1·B2) 공동현관 03번 …' → '전층(1·B1·B2)' / '1층 공동현관 12번 …' → '1층'
    """
    heads = ["공동현관", "엘리베이터", "E/V", "EV"]
    idx = -1
    for h in heads:
        i = message.find(h)
        if i >= 0 and (idx < 0 or i < idx):
            idx = i
    if idx <= 0:
        return ""
    head = message[:idx].strip(" ,·-–")
    if not head or len(head) > 22:
        return ""
    return head


def main():
    ap = argparse.ArgumentParser(description="게시판 제거 공지 카드(안내문+배치도+게시물 사진) 생성")
    ap.add_argument("--title", required=True, help="상단 배지 제목")
    ap.add_argument("--message", required=True, help="큰 본문 안내 문구")
    ap.add_argument("--board-type", default="lobby", choices=sorted(BOARD_LABEL),
                    help="lobby(공동현관) 또는 elevator(E/V)")
    ap.add_argument("--slots", required=True, help="칸 번호: 03 / 03,12 / 01-03")
    ap.add_argument("--notice-image", required=True, help="제거 대상 게시물 사진")
    ap.add_argument("--out", required=True, help="출력 파일(.jpg/.png)")
    ap.add_argument("--date", default=None, help="푸터 기준일 YYYY-MM-DD (기본: 오늘)")
    ap.add_argument("--card-width", type=int, default=1600)
    ap.add_argument("--supersample", type=float, default=2.0)
    ap.add_argument("--footer-left", default=None)
    ap.add_argument("--footer-right", default=None)
    ap.add_argument("--no-info", action="store_true", help="요약 박스를 넣지 않는다")
    args = ap.parse_args()

    args.date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else date.today()
    args.date_text = args.date.strftime("%Y-%m-%d")

    card, meta = build(args)
    out_path = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if out_path.lower().endswith(".png"):
        card.save(out_path, "PNG", optimize=True)
    else:
        card.save(out_path, "JPEG", quality=93, subsampling=0, optimize=True)

    kb = os.path.getsize(out_path) / 1024
    print(f"카드 → {out_path}  {card.width}×{card.height}px  {kb:.0f}KB")
    print(f"  배치: {meta['layout']} · 배치도 {meta['board_px'][0]}×{meta['board_px'][1]}"
          f" · 게시물 {meta['notice_px'][0]}×{meta['notice_px'][1]}")
    print(f"  본문 {meta['msg_size']}px {meta['msg_lines']}줄 · "
          f"요약박스 {'있음' if meta['info_box'] else '없음'}")
    print(f"  체크 배치도: {meta['checked']}")


if __name__ == "__main__":
    main()
