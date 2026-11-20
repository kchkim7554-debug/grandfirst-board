#!/usr/bin/env python3
"""Build the empty 게시판 / E/V templates from the two site photos.

    python3 board/build_templates.py            # both
    python3 board/build_templates.py lobby      # one

Outputs board/templates/lobby_board_template.jpg, board/templates/elevator_board_template.jpg
and board/templates/slots.json (slot quads used by mark_slot.py).
"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slotmap as S  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "board", "templates")

LOBBY_SRC = os.path.join(ROOT, "attachments/2026-11-20", "1000039950-e08381582c114a9793ae71fc8043bcfb.jpg")
ELEV_SRC = os.path.join(ROOT, "attachments/2026-11-20", "1000039951-724b9a50d3774d9e91fa85e03ea83cff.jpg")

# ---------------------------------------------------------------- geometry
# Lobby: 12 gold frames, clock-wise quads measured from the gold trim.
LOBBY_QUADS = {
    1: [(0, 56), (296, 56), (309, 467), (27, 467)],
    2: [(347, 57), (645, 57), (650, 470), (364, 470)],
    3: [(693, 57), (976, 57), (980, 470), (699, 470)],
    4: [(1072, 59), (1353, 59), (1357, 474), (1075, 474)],
    5: [(1403, 59), (1684, 59), (1687, 476), (1405, 476)],
    6: [(1736, 59), (2018, 59), (2019, 477), (1737, 477)],
    7: [(29, 533), (314, 533), (322, 928), (39, 928)],
    8: [(363, 535), (650, 535), (652, 931), (368, 931)],
    9: [(699, 535), (980, 535), (982, 929), (700, 929)],
    10: [(1073, 537), (1356, 537), (1359, 932), (1077, 932)],
}
# Slots 11/12 are the empty black glass panels on the right panel: keep the
# black background, only print the number (white on black).
LOBBY_BLACK_QUADS = {
    11: [(1405, 545), (1684, 545), (1686, 918), (1407, 918)],
    12: [(1737, 545), (2016, 545), (2017, 918), (1739, 918)],
}

# Elevator (coordinates in ORIGINAL 1536x2048 pixels; scaled by ELEV_SCALE).
ELEV_SCALE = 1.5
# every notice sheet inside the acrylic holder (안쪽 → 문쪽) is erased to black first
ELEV_POSTERS = [
    [(1195, 1001), (1275, 996), (1277, 1246), (1197, 1251)],
    [(1279, 1006), (1381, 1001), (1383, 1281), (1281, 1285)],
    [(1387, 1010), (1524, 1002), (1520, 1312), (1386, 1316)],
]
# clean white sheets drawn back into the holder, one per slot
ELEV_SLOTS = {           # 01 안쪽 → 03 문쪽
    1: [(1202, 1012), (1284, 1007), (1286, 1252), (1204, 1256)],
    2: [(1294, 1010), (1377, 1005), (1379, 1254), (1296, 1258)],
    3: [(1388, 1012), (1492, 1007), (1494, 1256), (1390, 1260)],
}
ELEV_WALL_04 = [(1212, 368), (1492, 336), (1497, 668), (1215, 706)]
ELEV_FRONT_05 = [(457, 792), (727, 787), (731, 1118), (460, 1126)]
ELEV_LEFT_06 = [(60, 792), (200, 786), (204, 1056), (64, 1062)]
# notices erased from the walls before the wall boxes are drawn (original pixels)
ELEV_PAPER_FRONT = [(482, 796), (702, 790), (706, 1090), (486, 1098)]
ELEV_PAPER_LEFT = [(102, 828), (208, 820), (204, 1048), (98, 1062)]


def scaled(quad, k=ELEV_SCALE):
    return [(int(round(x * k)), int(round(y * k))) for x, y in quad]


# ---------------------------------------------------------------- lobby
def build_lobby():
    src = cv2.imread(LOBBY_SRC, cv2.IMREAD_COLOR)
    img = src.copy()

    # 1. white panels for slots 1-10
    for no, quad in LOBBY_QUADS.items():
        w, h = S.quad_size(quad)
        panel = S.make_panel(w, h, "게시판", no)
        img = S.paste_panel(img, panel, quad)

    # 2. slots 11/12 keep the black glass: only the number is printed
    for no, quad in LOBBY_BLACK_QUADS.items():
        w, h = S.quad_size(quad)
        img = S.paste_panel(img, S.make_text_overlay(w, h, "", no, num_y=0.79), quad)

    out = os.path.join(TPL, "lobby_board_template.jpg")
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print("wrote", out, img.shape)
    return img


# ---------------------------------------------------------------- elevator
def build_elevator():
    src = Image.open(ELEV_SRC).convert("RGB")
    big = src.resize((int(src.width * ELEV_SCALE), int(src.height * ELEV_SCALE)), Image.LANCZOS)
    img = cv2.cvtColor(np.array(big), cv2.COLOR_RGB2BGR)

    # 1a. the acrylic holder's sheets are painted back to the holder's own black
    y0, y1 = int(986 * ELEV_SCALE), int(1000 * ELEV_SCALE)
    x0, x1 = int(1200 * ELEV_SCALE), int(1480 * ELEV_SCALE)
    plate = img[y0:y1, x0:x1].reshape(-1, 3)
    holder_black = tuple(int(v) for v in np.median(plate, axis=0))
    fmask = np.zeros(img.shape[:2], np.uint8)
    for poly in ELEV_POSTERS:
        cv2.fillPoly(fmask, [S.poly_points(scaled(poly))], 255)
    fmask = cv2.GaussianBlur(fmask, (0, 0), 3.0)
    a = (fmask.astype(np.float32) / 255.0)[:, :, None]
    img = np.clip(img.astype(np.float32) * (1 - a) +
                  np.array(holder_black, np.float32) * a, 0, 255).astype(np.uint8)

    # 1b. the wall notices are inpainted into the surrounding wood / wall tone
    mask = np.zeros(img.shape[:2], np.uint8)
    for poly in (ELEV_PAPER_FRONT, ELEV_PAPER_LEFT):
        cv2.fillPoly(mask, [S.poly_points(scaled(poly))], 255)
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=2)
    img = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)

    # 2. clean sheets in the acrylic holder (01–03, 안쪽 → 문쪽)
    for no, quad in ELEV_SLOTS.items():
        q = scaled(quad)
        w, h = S.quad_size(q)
        img = S.paste_panel(img, S.make_panel(w, h, "E/V", no), q)

    # 3. new boxes on the walls (04 위쪽 벽면, 05 정면, 06 좌측 벽면)
    for no, quad in ((4, ELEV_WALL_04), (5, ELEV_FRONT_05), (6, ELEV_LEFT_06)):
        q = scaled(quad)
        w, h = S.quad_size(q)
        img = S.paste_panel(img, S.make_panel(w, h, "E/V", no), q)

    out = os.path.join(TPL, "elevator_board_template.jpg")
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print("wrote", out, img.shape)
    return img


def write_slots():
    data = {
        "generated": "2026-11-20",
        "images": {
            "lobby": {
                "path": "board/templates/lobby_board_template.jpg",
                "size": [2048, 1105],
                "slots": {f"{no:02d}": {"quad": LOBBY_QUADS[no], "panel": "white"}
                          for no in LOBBY_QUADS},
            },
            "elevator": {
                "path": "board/templates/elevator_board_template.jpg",
                "size": [int(1536 * ELEV_SCALE), int(2048 * ELEV_SCALE)],
                "slots": {},
            },
        },
    }
    for no, quad in LOBBY_BLACK_QUADS.items():
        data["images"]["lobby"]["slots"][f"{no:02d}"] = {"quad": quad, "panel": "black",
                                                        "check_y": 0.255}

    elev = data["images"]["elevator"]["slots"]
    for no, quad in ELEV_SLOTS.items():
        elev[f"{no:02d}"] = {"quad": scaled(quad), "panel": "white"}
    for no, quad in ((4, ELEV_WALL_04), (5, ELEV_FRONT_05), (6, ELEV_LEFT_06)):
        elev[f"{no:02d}"] = {"quad": scaled(quad), "panel": "white"}

    with open(S.SLOTS_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print("wrote", S.SLOTS_PATH)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what not in ("all", "lobby", "elevator"):
        raise SystemExit("사용법: python3 board/build_templates.py [all|lobby|elevator]")
    os.makedirs(TPL, exist_ok=True)
    if what in ("all", "lobby"):
        build_lobby()
    if what in ("all", "elevator"):
        build_elevator()
    write_slots()
