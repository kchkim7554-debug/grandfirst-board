#!/usr/bin/env python3
"""찍힌 게시판 칸에 체크마크(✓)를 그려 출력한다.

    python3 board/mark_slot.py lobby 03 --out /tmp/check_lobby_03.jpg
    python3 board/mark_slot.py lobby 03,12 --out /tmp/check_lobby_03_12.jpg
    python3 board/mark_slot.py elevator 05 --out /tmp/check_ev_05.jpg
    python3 board/mark_slot.py elevator 01-03 --out /tmp/check_ev_01_03.jpg

번호는 , 로 여러 개, - 로 범위를 줄 수 있다. --out 을 생략하면
board/templates/checked/<이미지>_<번호>.jpg 로 저장한다.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slotmap as S  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK_COLOR = (224, 32, 32)
HALO = (255, 255, 255)


def parse_numbers(text: str):
    """'03,12' 또는 '01-03' → [3, 12] / [1, 2, 3] (번호 순, 중복 제거)."""
    out = []
    for part in re.split(r"[,\s]+", text.strip()):
        if not part:
            continue
        m = re.fullmatch(r"(\d{1,2})\s*-\s*(\d{1,2})", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            out.extend(range(min(a, b), max(a, b) + 1))
        elif part.isdigit():
            out.append(int(part))
        else:
            raise SystemExit(f"번호를 읽을 수 없습니다: {part!r}")
    seen, uniq = set(), []
    for n in out:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    return uniq


def check_overlay(width: int, height: int, color=CHECK_COLOR, wash=True,
                  center_y: float = 0.855) -> Image.Image:
    """슬롯 크기에 맞춘 강조 체크마크 오버레이(굵은 테두리 + 선명한 배지 ✓)."""
    W, H = int(width), int(height)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    inset = max(2, int(W * 0.015))
    border = max(6, int(min(W, H) * 0.052))

    # 1) 선명한 붉은 하이라이트 워시
    if wash:
        d.rectangle([0, 0, W - 1, H - 1], fill=color + (78,))

    # 2) 흰 외곽선 + 두꺼운 빨간 테두리 (작은 화면에서도 즉시 구분)
    d.rectangle([0, 0, W - 1, H - 1], outline=HALO + (230,), width=max(2, border // 3))
    d.rectangle([inset, inset, W - inset, H - inset], outline=color + (255,), width=border)

    # 3) 원형 빨간 배지 + 흰 테두리 + 굵은 흰색 체크마크
    r = min(W * 0.23, H * 0.125)
    cx, cy = W * 0.5, H * center_y
    halo_r = r + max(3, int(r * 0.16))
    d.ellipse([cx - halo_r, cy - halo_r, cx + halo_r, cy + halo_r], fill=HALO + (245,))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (255,))

    s = r * 1.15
    pts = [
        (cx - s * 0.45, cy - s * 0.02),
        (cx - s * 0.12, cy + s * 0.34),
        (cx + s * 0.48, cy - s * 0.36),
    ]
    thick = max(4, int(r * 0.28))
    d.line(pts, fill=HALO + (255,), width=thick, joint="curve")
    return img


def dim_overlay(width: int, height: int) -> Image.Image:
    """대상 아닌 칸을 한 톤 더 흐릿하게 눌러 체크 칸이 돋보이게 하는 오버레이."""
    W, H = int(width), int(height)
    img = Image.new("RGBA", (W, H), (232, 234, 238, 205))
    return img


def mark(image_key: str, numbers, out_path: str, color=CHECK_COLOR) -> str:
    data = S.load_slots()
    if image_key not in data["images"]:
        raise SystemExit(f"알 수 없는 이미지: {image_key} (lobby / elevator)")
    meta = data["images"][image_key]
    src = os.path.join(ROOT, meta["path"])
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"템플릿을 열 수 없습니다: {src}")

    missing = [f"{n:02d}" for n in numbers if f"{n:02d}" not in meta["slots"]]
    if missing:
        raise SystemExit(f"{image_key}에 없는 번호: {', '.join(missing)}")

    target_keys = {f"{n:02d}" for n in numbers}
    for key, slot in meta["slots"].items():
        if key not in target_keys:
            quad = slot["quad"]
            w, h = S.quad_size(quad)
            img = S.paste_panel(img, dim_overlay(w, h), quad)

    for n in numbers:
        slot = meta["slots"][f"{n:02d}"]
        quad = slot["quad"]
        w, h = S.quad_size(quad)
        img = S.paste_panel(img, check_overlay(w, h, color=color,
                                               center_y=slot.get("check_y", 0.855)), quad)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cv2.imwrite(out_path, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return out_path


def main():
    ap = argparse.ArgumentParser(description="게시판/E/V 번호 칸에 체크마크를 찍습니다.")
    ap.add_argument("image", help="lobby 또는 elevator")
    ap.add_argument("numbers", help="예: 03  /  03,12  /  01-03")
    ap.add_argument("--out", "-o", help="출력 파일 경로(.jpg)")
    ap.add_argument("--color", default=None, help="강조색 (예: #E02020)")
    args = ap.parse_args()

    color = CHECK_COLOR
    if args.color:
        h = args.color.lstrip("#")
        color = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    nums = parse_numbers(args.numbers)
    if not nums:
        raise SystemExit("번호를 지정하세요. 예: 03 또는 03,12")
    tag = "_".join(f"{n:02d}" for n in nums)
    out = args.out or os.path.join(ROOT, "board", "templates", "checked", f"{args.image}_{tag}.jpg")

    path = mark(args.image, nums, out, color=color)
    print(f"{args.image} {', '.join(f'{n:02d}번' for n in nums)} 체크 → {path}")


if __name__ == "__main__":
    main()
