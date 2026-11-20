#!/usr/bin/env python3
"""Shared helpers for the 게시판 / E/V slot templates.

A slot is described by a quadrilateral in image pixel coordinates
(clockwise from top-left) plus the panel size used when the slot was drawn.
The same quad lets mark_slot.py put a check mark exactly where the template
drew its slot panel.
"""
from __future__ import annotations

import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SLOTS_PATH = os.path.join(HERE, "templates", "slots.json")

FONT_DIR = os.path.join(os.path.dirname(HERE), "fonts")
_NANUM_BOLD = os.path.join(FONT_DIR, "NanumGothic-Bold.ttf")
_NANUM_XBOLD = os.path.join(FONT_DIR, "NanumGothic-ExtraBold.ttf")
_NANUM_REG = os.path.join(FONT_DIR, "NanumGothic-Regular.ttf")
_NOTO = "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf"
# 워크스페이스 나눔고딕 → 시스템 Noto Sans CJK KR 순으로 고른다
FONT_BOLD = _NANUM_BOLD if os.path.exists(_NANUM_BOLD) else _NOTO
FONT_XBOLD = _NANUM_XBOLD if os.path.exists(_NANUM_XBOLD) else FONT_BOLD
FONT_REG = _NANUM_REG if os.path.exists(_NANUM_REG) else _NOTO

WHITE = (255, 255, 253)
INK = (24, 33, 52)
GRAY = (128, 130, 136)
BORDER = (206, 189, 152)
RED = (214, 40, 40)


def load_slots(path: str = SLOTS_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, max(6, int(round(size))))


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def fit_font(draw, text, path, target_w, start, min_size=6):
    """Largest font size whose rendered width stays under target_w."""
    size = start
    while size > min_size:
        f = font(path, size)
        if text_size(draw, text, f)[0] <= target_w:
            return f
        size -= 1
    return font(path, min_size)


def draw_tracked(draw, xy, text, fnt, fill, tracking=0):
    """Draw text with letter spacing; xy is the top-left of the run."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x - tracking


def make_panel(width: int, height: int, label: str, number: int,
               suffix: str = "번", white: bool = True,
               border: bool = True) -> Image.Image:
    """Render one clean slot panel: small label on top, big number below."""
    W, H = int(width), int(height)
    img = Image.new("RGB", (W, H), WHITE if white else (16, 16, 16))
    d = ImageDraw.Draw(img)

    pad = max(3, int(W * 0.045))
    if border and white:
        d.rounded_rectangle([pad, pad, W - pad, H - pad], radius=max(2, int(W * 0.02)),
                            outline=BORDER, width=max(2, int(W * 0.008)))

    ink = INK if white else (255, 255, 255)
    gray = GRAY if white else (185, 185, 190)

    # --- label ---------------------------------------------------------
    lab_f = fit_font(d, label, FONT_BOLD, W * 0.62, H * 0.10)
    lw, lh = text_size(d, label, lab_f)
    ly = H * 0.20 - lh / 2
    draw_tracked(d, ((W - lw - (len(label) - 1) * W * 0.012) / 2, ly), label, lab_f,
                 gray, tracking=W * 0.012)

    # --- number --------------------------------------------------------
    num = f"{number:02d}"
    num_f = fit_font(d, num + suffix, FONT_XBOLD, W * 0.80, min(W * 0.50, H * 0.34))
    suf_f = font(FONT_BOLD, min(num_f.size * 0.40, W * 0.22))
    nw = d.textlength(num, font=num_f)
    sw = d.textlength(suffix, font=suf_f)
    total = nw + sw + W * 0.01
    nx = (W - total) / 2
    ny = H * 0.60
    d.text((nx, ny), num, font=num_f, fill=ink, anchor="lm")
    d.text((nx + nw + W * 0.01, ny + num_f.size * 0.12), suffix, font=suf_f, fill=ink, anchor="lm")
    return img


def quad_center(quad):
    q = np.array(quad, dtype=float)
    return float(q[:, 0].mean()), float(q[:, 1].mean())


def quad_size(quad):
    q = np.array(quad, dtype=float)
    w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    return int(round(w)), int(round(h))


def warp_matrix(panel_size, quad):
    W, H = panel_size
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    dst = np.float32(quad)
    return cv2.getPerspectiveTransform(src, dst)


def paste_panel(bgr: np.ndarray, panel: Image.Image, quad):
    """Perspective-composite a PIL panel image into a BGR canvas.

    An RGBA panel keeps its own alpha; an RGB panel is opaque.
    """
    h, w = bgr.shape[:2]
    W, H = panel.size
    M = warp_matrix((W, H), quad)
    rgb = np.array(panel.convert("RGB"))[:, :, ::-1].copy()
    warped = cv2.warpPerspective(rgb, M, (w, h), flags=cv2.INTER_LANCZOS4,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    if panel.mode == "RGBA":
        src_a = np.array(panel)[:, :, 3]
    else:
        src_a = np.full((H, W), 255, np.uint8)
    mask = cv2.warpPerspective(src_a, M, (w, h), flags=cv2.INTER_LANCZOS4,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    alpha = (mask.astype(np.float32) / 255.0)[:, :, None]
    out = bgr.astype(np.float32) * (1 - alpha) + warped.astype(np.float32) * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def make_text_overlay(width: int, height: int, label: str, number: int,
                      suffix: str = "번", color=(255, 255, 255),
                      label_color=(210, 210, 215),
                      label_y: float = 0.20, num_y: float = 0.60) -> Image.Image:
    """Transparent overlay carrying only the slot text (for slots left black)."""
    W, H = int(width), int(height)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if label:
        lab_f = fit_font(d, label, FONT_BOLD, W * 0.44, H * 0.085)
        lw, _ = text_size(d, label, lab_f)
        draw_tracked(d, ((W - lw - (len(label) - 1) * W * 0.02) / 2, H * label_y), label, lab_f,
                     label_color, tracking=W * 0.02)
    num = f"{number:02d}"
    num_f = fit_font(d, num, FONT_XBOLD, W * 0.62, min(W * 0.60, H * 0.34))
    suf_f = font(FONT_BOLD, min(num_f.size * 0.38, W * 0.20))
    nw = d.textlength(num, font=num_f)
    sw = d.textlength(suffix, font=suf_f)
    nx = (W - nw - sw - W * 0.02) / 2
    ny = H * num_y
    d.text((nx, ny), num, font=num_f, fill=color + (255,), anchor="lm")
    d.text((nx + nw + W * 0.02, ny + num_f.size * 0.10), suffix, font=suf_f,
           fill=color + (235,), anchor="lm")
    return img


def poly_points(quad):
    return np.array(quad, dtype=np.int32).reshape(-1, 2)


def fill_poly(bgr: np.ndarray, quad, color=(255, 255, 255)):
    cv2.fillPoly(bgr, [poly_points(quad)], color, lineType=cv2.LINE_AA)
    return bgr
