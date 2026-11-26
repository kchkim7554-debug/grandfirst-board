#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""테스트용 카피본(sandbox/index.html) 생성기.

원본(board/index.html)을 그대로 복제하되 카피본 전용 설정만 덧붙인다.
  · <base href="../">        — app.js·data.json·images·templates 를 원본 그대로 공용 사용
  · sandbox/env.js 먼저 로드 — DB 경로를 board/sandbox 로, 자동 Admin 권한으로
  · 상단 🧪 배너             — 원본/카피본을 한눈에 구분

사용:
  python3 scripts/make_sandbox.py           # sandbox/index.html 생성(덮어쓰기)
  python3 scripts/make_sandbox.py --check   # 최신 상태인지 확인만 (다르면 종료코드 1)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # board/
SRC = os.path.join(ROOT, "index.html")
OUT = os.path.join(ROOT, "sandbox", "index.html")

BANNER = (
    '<div class="sbxbar" role="note">🧪 테스트용 (카피본) — 마음껏 눌러보세요</div>'
)

BANNER_CSS = """/* ===== 테스트용 카피본 전용 ===== */
.sbxbar{
  max-width:760px;margin:7px auto 0;padding:5px 10px;border-radius:9px;
  background:linear-gradient(90deg,#7c3aed 0%,#c026d3 55%,#f59e0b 100%);
  color:#fff;font-size:.70rem;font-weight:800;letter-spacing:.2px;text-align:center;
  box-shadow:0 2px 8px rgba(124,58,237,.28);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
@media (max-width:420px){ .sbxbar{font-size:.64rem;padding:4px 6px;} }
"""

ENV_TAG = '<script src="sandbox/env.js"></script>\n'


def build(src_html: str) -> str:
    html = src_html

    # 1) base — 카피본은 원본의 app.js·data.json·이미지를 그대로 쓴다
    assert '<meta charset="utf-8">' in html, "charset meta not found"
    html = html.replace('<meta charset="utf-8">',
                        '<meta charset="utf-8">\n<base href="../">', 1)

    # 2) 제목 — 탭에서도 원본/카피본이 구분된다
    html = html.replace(
        "<title>게시판 관리 시스템 · 풍경채 그랑퍼스트</title>",
        "<title>🧪 테스트용 (카피본) · 게시판 관리 시스템 · 풍경채 그랑퍼스트</title>", 1)

    # 3) 배너 CSS
    assert "</style>\n</head>" in html, "style block not found"
    html = html.replace("</style>\n</head>", "\n" + BANNER_CSS + "</style>\n</head>", 1)

    # 4) 배너 — 흰색 고정 헤더(게시판 관리 / 풍경채 그랑퍼스트) 바로 아래 줄
    #    (상태바가 화면을 덮는 edge-to-edge 기기에서도 상태바와 절대 겹치지 않는다)
    assert '  </div>\n</header>' in html, "topbar-in end not found"
    html = html.replace('  </div>\n</header>',
                        '  </div>\n  ' + BANNER + '\n</header>', 1)

    # 5) env.js — app.js 보다 먼저 (DB 경로 board/sandbox · 자동 Admin)
    assert '<script src="app.js?v=' in html, "app.js script not found"
    html = html.replace('<script src="app.js?v=', ENV_TAG + '<script src="app.js?v=', 1)

    return html


def main() -> int:
    check = "--check" in sys.argv[1:]
    with open(SRC, encoding="utf-8") as f:
        src_html = f.read()
    out_html = build(src_html)

    if check:
        try:
            with open(OUT, encoding="utf-8") as f:
                cur = f.read()
        except FileNotFoundError:
            print("✗ sandbox/index.html 이 없습니다 — python3 scripts/make_sandbox.py")
            return 1
        if cur == out_html:
            print("✓ sandbox/index.html 최신 (원본과 일치)")
            return 0
        print("✗ sandbox/index.html 이 원본과 다릅니다 — python3 scripts/make_sandbox.py")
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out_html)
    print("✓ sandbox/index.html 생성 (%.1f KB)" % (len(out_html.encode("utf-8")) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
