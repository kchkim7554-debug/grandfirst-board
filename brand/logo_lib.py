#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""풍경채 로고 스캔 → 투명 배경 로고 RGBA 이미지 (공용 라이브러리).

brand/pungkyungchae-scan.jpg  →  color(잉크색 글씨 + 색 잎) · white(흰 글씨 + 색 잎)

원리: 스캔은 흰 종이(≈253) 위에 갈색 잉크 글씨 + 노란/연두/주황 잎.
      흰 배경 합성식 C = A·F + (1-A)·W 를 뒤집어 A(불투명도)와 F(순수 색)를 복원한다.
      · A = 1 - min(C)/W   (잉크의 가장 어두운 채널 = 덮인 정도)
      · 종이 잡음은 하한 컷, 흐릿한 테두리는 대비 커브로 또렷하게
      · 잎은 색이 있는 영역 안에서만 번지게 해(모폴로지 재구성) 옅게 비친 부분까지 살린다
"""
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "pungkyungchae-scan.jpg")

WHITE = 253.5          # 종이 밝기
LEAF_SAT = 0.55        # 채도가 이 이상이고 밝기가 110 이상이면 진한 잎 색(씨앗)
LO, HI = 0.09, 0.72    # 알파 대비 커브 — 이보다 옅으면 투명, 진하면 불투명


def _load():
    return np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)


def _raw_alpha(a):
    return 1.0 - np.clip(a.min(axis=2) / WHITE, 0.0, 1.0)


def _leaf_mask(a):
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    seed = (sat >= LEAF_SAT) & (mx >= 110) & (mx < 252)
    colorful = ((mx - mn) >= 14) & (mx >= 85) & (mx < 253)

    m = Image.fromarray((seed * 255).astype(np.uint8), "L")
    c = Image.fromarray((colorful * 255).astype(np.uint8), "L")
    for _ in range(26):
        m = Image.fromarray((np.asarray(m) > 100).astype(np.uint8) * 255, "L").filter(ImageFilter.MaxFilter(7))
        m = Image.fromarray(np.minimum(np.asarray(m), np.asarray(c)).astype(np.uint8), "L")
    m = m.filter(ImageFilter.MaxFilter(5))
    return np.asarray(m) > 100


def _clean_alpha(alpha):
    im = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.MedianFilter(3))
    arr = np.asarray(im).astype(np.float32) / 255.0
    arr = np.clip((arr - LO) / (HI - LO), 0.0, 1.0)
    im2 = Image.fromarray((arr * 255).astype(np.uint8), "L")
    arr = np.asarray(im2.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=2))).astype(np.float32) / 255.0
    return np.clip(arr, 0.0, 1.0)


def _unpremultiply(a, alpha):
    safe = np.maximum(alpha, 1e-3)[..., None]
    return np.clip((a - (1.0 - safe) * WHITE) / safe, 0.0, 255.0)


def _bbox(alpha, pad=6, thresh=0.10):
    ys, xs = np.where(alpha > thresh)
    x0, x1 = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + 1 + pad)
    return x0, y0, x1, y1


def _smooth_leaf_colors(rgba, leaf):
    img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
    rgb = img.convert("RGB").filter(ImageFilter.GaussianBlur(1.2))
    blurred = np.dstack([np.asarray(rgb).astype(np.float32), rgba[..., 3]])
    out = rgba.copy()
    out[leaf] = 0.55 * rgba[leaf] + 0.45 * blurred[leaf]
    return out


def build():
    """returns (color: RGBA Image, white: RGBA Image) — 둘 다 여백 없이 잘린 워드마크."""
    a = _load()
    raw = _raw_alpha(a)
    alpha = _clean_alpha(raw)
    leaf = _leaf_mask(a) & (raw > 0.15)
    F = _unpremultiply(a, alpha)

    x0, y0, x1, y1 = _bbox(alpha)
    alpha_c, F_c, leaf_c = alpha[y0:y1, x0:x1], F[y0:y1, x0:x1], leaf[y0:y1, x0:x1]

    rgba = np.dstack([F_c, alpha_c * 255.0])
    rgba = _smooth_leaf_colors(rgba, leaf_c)
    rgba[..., 3] = alpha_c * 255.0
    color = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")

    # 흰색(네이비 배경용): 글씨는 순백, 잎은 색 유지.
    # 스캔의 옅은 그림자는 네이비 위에서 뿌연 후광이 되므로 글씨 알파를 한 단계 조인다.
    w = rgba.copy()
    a2 = np.clip((w[..., 3] / 255.0 - 0.22) / 0.26, 0.0, 1.0) ** 0.85
    a2 = np.where(leaf_c, w[..., 3] / 255.0, a2)
    w[..., 3] = a2 * 255.0
    w[~leaf_c, 0] = 255.0
    w[~leaf_c, 1] = 255.0
    w[~leaf_c, 2] = 255.0
    white = Image.fromarray(np.clip(w, 0, 255).astype(np.uint8), "RGBA")
    return color, white


if __name__ == "__main__":
    c, w = build()
    work = os.path.join(HERE, "_work")
    os.makedirs(work, exist_ok=True)
    c.save(os.path.join(work, "logo_color.png"))
    w.save(os.path.join(work, "logo_white.png"))
    print("wordmark", c.size)
