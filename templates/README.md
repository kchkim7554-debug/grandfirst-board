# 게시판 · E/V 번호판 템플릿

현장 사진 두 장에서 게시물을 지우고 번호 칸만 남긴 템플릿과, 원하는 칸에 체크마크를 찍어
출력하는 스크립트입니다.

| 파일 | 설명 |
| --- | --- |
| `lobby_board_template.jpg` | 공동현관 홀 12분할 게시판 (2048×1105). 게시판 01~12번 |
| `elevator_board_template.jpg` | 엘리베이터 내부 (2304×3072). E/V 01~06번 |
| `slots.json` | 각 칸의 좌표(사각형 4점)와 성격. `mark_slot.py`가 이 파일만 보고 찍습니다 |
| `checked/` | `mark_slot.py` 기본 출력 폴더 |

## 번호 순서

**공동현관 12분할** — 사진 그대로 윗줄 왼쪽부터 01→06, 아랫줄 왼쪽부터 07→12.

```
01 02 03 | 04 05 06
07 08 09 | 10 11 12
```

11·12번은 사진에서 금색 액자 없이 검은 유리에 걸이만 있는 칸이라, 검은 바탕은 그대로 두고
흰색 숫자만 얹었습니다(액자 10칸은 흰 바탕 + 남색 번호).

**엘리베이터 6분할**

- `E/V 01~03` — 오른쪽 아크릴 액자 3칸. 안쪽(뒤)에서 문쪽(앞) 순서로 01 → 03.
- `E/V 04` — 같은 아크릴 액자 위쪽 벽면에 새로 그린 박스
- `E/V 05` — 정면(풍경채 로고 아래 나무 벽면)에 새로 그린 박스
- `E/V 06` — 좌측 벽면에 새로 그린 박스

기존에 붙어 있던 종이는 모두 지웠습니다(나무·벽면은 주변 톤으로 메움).

## 체크마크 찍기

```bash
python3 board/mark_slot.py lobby 03 --out /tmp/check_lobby_03.jpg
python3 board/mark_slot.py lobby 03,12 --out /tmp/check_lobby_03_12.jpg
python3 board/mark_slot.py elevator 05 --out /tmp/check_ev_05.jpg
python3 board/mark_slot.py elevator 01-03            # 범위도 됩니다
```

- `--out` 을 생략하면 `board/templates/checked/<이미지>_<번호>.jpg` 로 저장합니다.
- `--color "#0B7BE0"` 처럼 강조색을 바꿀 수 있습니다(기본 빨강 `#E02020`).
- 칸마다 옅은 붉은 워시 + 이중 테두리 + 큰 ✓ 를 그리고, 번호는 가리지 않습니다.

## 템플릿 다시 만들기

```bash
python3 board/build_templates.py          # 둘 다
python3 board/build_templates.py lobby    # 공동현관만
python3 board/build_templates.py elevator # 엘리베이터만
```

`build_templates.py` 안의 좌표 상수(`LOBBY_QUADS`, `ELEV_SLOTS`, `ELEV_WALL_04` …)가
사진 위 칸 위치를 정합니다. 사진을 바꾸면 이 값만 고쳐 다시 돌리면 되고, `slots.json`도
같이 갱신됩니다.

## 제거 공지 카드 합성 (`make_removal_card.py`)

안내 문구 + 체크 배치도 + 제거 대상 게시물 사진을 **한 장의 카드 이미지**로 합칩니다.
카톡·문자로 그대로 보낼 수 있게 가로 1600px, 2배 슈퍼샘플링으로 글자를 선명하게 그립니다.

```bash
python3 board/make_removal_card.py \
  --title "오늘(11/20 금) B조 제거 대상 ①" \
  --message "전층(1·B1·B2) 공동현관 03번 첫 번째 게시물 [승강기 정기 점검] 오늘 제거 바랍니다." \
  --board-type lobby --slots 03 \
  --notice-image board/images/r01_elevator_inspection.jpg \
  --out board/templates/cards/2026-11-20_R01.jpg
```

| 인자 | 설명 |
| --- | --- |
| `--title` | 상단 배지 제목 (`①`~`⑳` 동그라미 숫자는 직접 그려 색을 입힘) |
| `--message` | 큰 본문. `[제목]`과 `03번` 같은 칸 번호는 자동으로 빨강 강조 |
| `--board-type` | `lobby`(공동현관 홀) 또는 `elevator` |
| `--slots` | `03` / `03,12` / `01-03` |
| `--notice-image` | 제거 대상 게시물 사진 |
| `--out` | `.jpg` 또는 `.png` |
| `--date` | 푸터 기준일(기본: 오늘) |
| `--card-width` | 기본 1600 |
| `--no-info` | 왼쪽 열 요약 박스를 넣지 않음 |

- 체크 배치도는 내부에서 `mark_slot.py`로 만들어 `templates/checked/<타입>_<번호>.jpg` 에도 남깁니다.
- 두 사진은 **원본 비율 그대로**(잘리지 않게) 배치됩니다. 두 장의 비율이 비슷하면 좌우 같은 높이로,
  많이 다르면(공동현관 배치도 + 세로 문서) 문서 쪽을 크게 두고 배치도 아래에 요약 박스(층·게시판·칸 번호·게시물)를 채웁니다.
- 글꼴은 `fonts/NanumGothic-*.ttf`, 없는 글자는 Noto Sans CJK KR로 넘기고, 둘 다 없는 글자(이모지 등)는 버립니다(□ 깨짐 방지).

## 참고

- 글꼴은 워크스페이스 `fonts/NanumGothic-*.ttf`(나눔고딕 ExtraBold/Bold)를 쓰고, 없으면
  시스템 `/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf` 로 넘어갑니다.
- 템플릿은 사진 위에 그린 것이라 원본 사진과 같은 원근·기울기를 그대로 따릅니다.
  칸 좌표는 금색 액자 안쪽을 기준으로 잡았습니다.
