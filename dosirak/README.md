# 🍱 도시락 관리 — 도시락 식수·대금 정산 웹앱

경비 근무 중 먹는 도시락(하솜푸드)의 **식수·금액 달력**과 **월별 대금 정산**을
두 사람(김기춘 · 조명수)이 같은 링크로 함께 보는 앱입니다.
`dosirak.html`(내 컴퓨터에만 저장되던 파일)을 게시판 관리(`grandfirst-board`)와 같은 방식으로
**GitHub Pages + Firebase 실시간 DB + PWA(홈 화면 설치·버전 업데이트)** 로 옮긴 것입니다.

- 서비스: **https://kchkim7554-debug.github.io/grandfirst-board/dosirak/**
- 저장소: https://github.com/kchkim7554-debug/grandfirst-board (`dosirak/` 폴더)
  · 앱을 새 저장소로 떼어 내려면 `dosirak-board` 저장소를 만든 뒤 이 폴더만 옮겨 그대로 배포하면 됩니다
    (Pickle 의 GitHub 연결은 저장소를 새로 만들 권한이 없어 게시판 저장소 안 폴더로 먼저 배포했습니다).
- 테스트용(관리자 자동, 실제 데이터와 분리): 같은 주소에 `?sandbox=1`

## 화면

| 화면 | 내용 |
|---|---|
| 달력(첫 화면) | 상단 `총 식수 / 총 금액` → 김기춘·조명수 각 식수·금액 → **월말 예상 표** → 달력(일~토, 날짜별 금액) → 하단 버튼 `김기춘 리스트` · `조명수 리스트` · `총 리스트` · **`거래명세서, 도시락대금 정산 결과`** |
| 도시락 대금 정산 | **월별 행 목록(최신 월이 위)** — 컬럼 `년월 · 거래명세서 · 수금일 · 대금송금일 · 현금영수증`. 년월 칸에 그 달 `식수 · 금액 · 조명수 몫`을 함께 적어 송금 금액을 바로 알 수 있게 했습니다. 사진 칸을 누르면 **사진 팝업**(확대/맞추기), 관리자는 빈 칸(＋)을 눌러 등록·수정 |
| 정산 등록(관리자) | 년월 · 거래명세서 사진(촬영/앨범) · 수금일 · 대금송금일 · 현금영수증 사진 · 메모. 사진은 **긴 변 1200px·JPEG 0.72로 줄여** Firebase RTDB에 base64로 저장(별도 Storage 설정 불필요). 거래명세서를 올리면 **수금일이 오늘로 자동 기록** |
| 리스트 | 김기춘/조명수/총 리스트 — 관리자는 행마다 삭제, 조회자는 보기만 |
| 식수 추가(관리자) | 달력 칸이나 ＋ 버튼 → 날짜·이름·중식/석식·단가, 그날 등록 내역 확인·삭제 |

## 권한

| | 조회(조명수 님 등) | 관리자(김기춘) |
|---|---|---|
| 달력·리스트·월말 예상 | ✅ | ✅ |
| 정산 표·거래명세서/현금영수증 사진 팝업 | ✅ | ✅ |
| 식수 추가·삭제 | ✕ | ✅ |
| 정산 등록·수정·삭제 | ✕ | ✅ |

- 관리자 인증: 상단 오른쪽 `조회` 칩 → **관리자 인증** → 암호 입력. 인증은 **그 기기에만** 기억되고
  암호 자체는 저장하지 않습니다. (게시판 관리와 같은 암호, salt 는 이 앱 전용 `dosirak-board|`)
- 암호의 SHA-256 만 `app.js` 의 `DEFAULT_PW_HASH` 에 있고 **평문은 소스·커밋 어디에도 없습니다.**
  암호를 바꾸려면 새 salt+암호의 SHA-256 을 계산해 `DEFAULT_PW_HASH` 를 바꾸거나,
  DB `config/pinHash` 에 넣으면 그 값이 우선합니다.
- 일반 조회자는 달력 칸을 눌러도 그날 내역 **보기**만 됩니다(추가 시트가 열리지 않음).

## 데이터 (Firebase Realtime Database)

게시판 관리와 **같은 Firebase 프로젝트**를 쓰되 경로를 나눕니다.
이 프로젝트의 접근 규칙이 `/board` 아래만 열어 두고 있어(다른 루트는 `Permission denied`)
도시락 데이터는 **`/board/dosirak`** 에 둡니다. 게시판 데이터(`/board/notices`, `config` …)와 섞이지 않습니다.

```
/board/dosirak/records/{id}       { date, person, mealType, price, at, by }
/board/dosirak/settlements/{ym}   { collectDate, remitDate, memo,
                                    invoice: { img(사진 dataURL), at, by },
                                    receipt: { img, at, by }, updatedAt }
/board/dosirak/config             { pinHash }   ← 없으면 소스의 기본 해시 사용
/board/dosirak/sandbox/…          테스트용(같은 구조, 실제 데이터와 분리)
```

- 처음 화면은 `seed_dosirak.py` 로 10월·11월 식수를 올려 두었습니다.
  10월 **42식 346,500원**(김 20 · 조 22), 11월 **46식 379,500원**(각 23식 189,750원).
- 한 사람이 식수를 추가하면 다른 사람 화면에 **즉시** 반영됩니다(RTDB `on("value")`).
- Firebase 를 못 쓰는 환경(파일로 열기·비행기 모드)에서는 **오프라인 보기 모드**로 뜨고
  기록은 그 기기에만 저장됩니다.

## PWA — 홈 화면 설치 · 새 버전 업데이트

- `manifest.json`(이름 `도시락 관리`, 아이콘 `icons/`) + `sw.js`(캐시 없는 패스스루: 항상 최신 파일)
- `pwa.js` — 크롬의 설치 창을 잡아 두었다가 **`📲 앱 설치`** 배너 한 번으로 설치.
  새 배포를 감지하면 자동 새로고침하지 않고 **`🆕 새 버전이 준비됐습니다 · 지금 업데이트`** 배너를 띄웁니다.
  (앱 실행 시 · 화면 복귀 시 · 5분마다 `version.json` 확인)
- 아이폰 사파리·카톡 인앱브라우저처럼 설치 창을 못 띄우는 곳에서는 설정 시트에 한 줄 안내가 나옵니다.
- 시트·팝업이 열리면 뒤 화면 스크롤을 잠급니다(`html.lock/body.lock`).

## 배포하기 (버전 올리기)

1. `index.html` 의 `DS_APP_VERSION`, `sw.js` 의 `VERSION`, `version.json` 의 `version`,
   `manifest.json` 아이콘 `?v=` 를 **같은 값**으로 올립니다(예: `20261128b`).
2. `python3 test/run_tests.py` → 144개 항목 통과 확인.
3. `git add -A && git commit -m "…" && git push`
4. GitHub Pages(`main` 브랜치 `/root`)가 자동 배포 → 폰에서 앱을 다시 열면 `지금 업데이트` 배너.

## 검사

```bash
python3 test/run_tests.py        # 단위 테스트(QuickJS, Node 불필요) — 144개
DOSIRAK_PW='…' python3 test/run_tests.py    # 암호 해시 대조까지(평문은 저장하지 않음)
python3 seed_dosirak.py --dry    # 초기 데이터 미리보기
python3 icons/gen_icons.py       # 아이콘 다시 그리기
```

실제 화면 검증은 `test/verify_ui.py`(Playwright, 390×844 모바일 뷰포트)로 했습니다 —
한 화면에 들어오는지, 정산 목록·등록·사진 팝업, 관리자 잠금/해제, 설치·업데이트 배너까지 확인합니다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 껍데기 + CSS(CDN 없음 — Tailwind·FontAwesome 미사용) |
| `core.js` | 순수 계산(집계·월말 예상·정산 행) — 테스트가 이 파일만 돌린다 |
| `app.js` | 화면 렌더 · Firebase 실시간 동기화 · 관리자 인증 · 사진 압축 |
| `pwa.js` / `sw.js` / `manifest.json` / `version.json` | 설치·업데이트 |
| `icons/` | 앱 아이콘(도시락통) — `gen_icons.py` 로 생성 |
| `seed_dosirak.py` | 10·11월 식수 초기 데이터 |
| `test/` | 단위 테스트 · 화면 검증 |
