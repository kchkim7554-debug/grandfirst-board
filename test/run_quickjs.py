#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""겹침 순번(order) 자동화 로직 검증 — Node 없이 QuickJS 로 app.js 를 돌린다.

실행: python3 test/run_quickjs.py     (board/ 폴더에서)
DB에는 아무것도 쓰지 않습니다. (test/live-snapshot.json = 2026-11-18 실 DB 읽기 스냅샷)

함께 확인하는 것:
  - test/*.test.js (QuickJS 로 app.js 실행 후 렌더 결과 검사)
  - index.html 껍데기(시안 A 상단바·하단 5탭바·설정 시트) 구조 검사
"""
import json, os, re, sys

try:
    import quickjs
except ImportError:
    sys.exit("quickjs 모듈이 필요합니다: pip install quickjs")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


TEST_FILES = [
    "test/order.test.js",
    "test/stats.test.js",
    "test/alerts.test.js",
    "test/create.test.js",
    "test/deploy.test.js",
    "test/ocr.test.js",
    "test/portal.test.js",
    "test/sandbox.test.js",
]


def check_shell():
    """index.html 껍데기 — 시안 A 상단바 · 하단 5탭바 · 설정(⚙) 시트"""
    html = read("index.html")
    out = []
    n_pass = 0
    n_fail = 0

    def ok(name, cond, extra=""):
        nonlocal n_pass, n_fail
        if cond:
            n_pass += 1
            out.append("  ✓ " + name)
        else:
            n_fail += 1
            out.append("  ✗ " + name + ("  → " + extra if extra else ""))

    def has(s, sub):
        return sub in s

    out.append("\n[shell] index.html — 상단바 · 하단 탭바 · 설정 시트")
    ok("상단 로고·이름", has(html, 'class="bd-t"') and has(html, "게시판 관리") and has(html, "풍경채 그랑퍼스트"))
    ok("상단 실시간 칩", has(html, 'id="liveChip"'))
    ok("상단 관리자 칩 자리", has(html, 'id="whoBtn"') and has(html, 'data-act="who"'))
    ok("상단 가+ 글자 크기 버튼", has(html, 'data-act="font"') and has(html, "가<sup>+</sup>"))
    ok("상단 ⚙ 설정 버튼", has(html, 'data-act="settings-menu"'))
    ok("설정 시트에 권한 관리·단지 정보", has(html, 'id="setSheet"')
       and has(html, 'data-go="#/admin"') and has(html, 'data-go="#/info"'))
    tabs = [t for t in re.findall(r'id="(tb[A-Za-z]+)"', html) if not t.endswith("Badge")]
    ok("하단 탭 5개(홈·생성·배포·알림·더보기)",
       tabs == ["tbHome", "tbCreate", "tbDeploy", "tbAlerts", "tbMore"], str(tabs))
    ok("탭 이름", all(lbl in html for lbl in ['>홈<', '>생성<', '>배포<', '>알림<', '>더보기<']))
    ok("탭 연결", has(html, 'data-go="#/create"') and has(html, 'data-go="#/deploy"') and has(html, 'data-go="#/alerts"'))
    ok("배포·알림 탭 배지", has(html, 'id="tbDeployBadge"') and has(html, 'id="tbAlertBadge"'))
    ok("더보기 시트(게시 상태·이력·통계·설정)", has(html, 'id="moreSheet"')
       and has(html, 'data-go="#/status"') and has(html, 'data-go="#/history"'))
    ok("탭바가 본문을 가리지 않도록 여백(--tabh)", "--tabh" in html and "padding-bottom:calc(var(--tabh)" in html)
    # 배경 — 2026-11-26 사용자 요청: 화면 전체 기본 배경을 민트색으로
    ok("민트색 기본 배경(--bg)", "--bg:#e5f6f1" in html)
    ok("배경 워시(단지 사진 위 채색)도 민트 톤",
       "linear-gradient(180deg,#ecfaf5 0%,#e3f6ef 52%,#d9f1e8 100%)" in html)
    ok("예전 회색 바탕(#f2f5fa)이 기본 배경에서 빠졌다",
       "--bg:#f2f5fa" not in html and "linear-gradient(180deg,#f4f8fc" not in html)
    ok("theme-color 도 민트", 'name="theme-color" content="#e5f6f1"' in html)
    ver = re.search(r'app\.js\?v=(\d{8}[a-z]?)', html)
    ok("app.js 캐시 버전 쿼리", bool(ver) and ver.group(1) >= "20261126b", ver.group(1) if ver else "없음")
    return out, n_pass, n_fail


SANDBOX_DIR = os.path.join(ROOT, "sandbox")


def check_sandbox():
    """카피본 — 🧪 배너 · <base> 공용 에셋 · 자동 Admin 설정 · 원본과 코드 동기"""
    out, n_pass, n_fail = [], 0, 0

    def ok(name, cond, extra=""):
        nonlocal n_pass, n_fail
        if cond:
            n_pass += 1
            out.append("  ✓ " + name)
        else:
            n_fail += 1
            out.append("  ✗ " + name + ("  → " + extra if extra else ""))

    def readp(p):
        fp = os.path.join(ROOT, p)
        if not os.path.exists(fp):
            return None
        with open(fp, encoding="utf-8") as f:
            return f.read()

    out.append("\n[sandbox] 카피본 — 배너 · DB 분리 · 자동 Admin")
    page = readp("sandbox/index.html")
    env = readp("sandbox/env.js")
    ok("sandbox/index.html 있음", page is not None)
    page = page or ""
    env = env or ""
    ok("🧪 테스트용 배너", "🧪 테스트용 (카피본)" in page and "sbxbar" in page)
    ok("<base href=\"../\"> 공용 에셋", '<base href="../">' in page)
    ok("env.js 를 app.js 보다 먼저", env and page.find("sandbox/env.js") >= 0
       and page.find("sandbox/env.js") < page.find('src="app.js?v='))
    ok("DB 경로 board/sandbox", 'dbRoot: "board/sandbox"' in env)
    ok("자동 Admin", "sandbox: true" in env and 'adminLabel: "Admin"' in env)
    ok("기기 저장 키 분리", 'lsPrefix: "gf.sandbox."' in env)

    # 원본 index.html 을 고친 뒤 카피본을 다시 만들지 않았는지
    gen_ok = False
    try:
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import make_sandbox  # type: ignore
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
            gen_ok = make_sandbox.build(f.read()) == page
    except Exception as e:  # noqa: BLE001
        gen_ok = False
        ok("카피본 생성기 실행", False, str(e))
    ok("원본 index.html 과 동기화", gen_ok, "python3 scripts/make_sandbox.py 실행 필요")

    # 개인 닉네임이 화면·코드 어디에도 남지 않았는지
    for f in ["index.html", "app.js", "sandbox/index.html", "sandbox/env.js", "README.md"]:
        t = readp(f)
        ok(f + " 에 개인 닉네임 없음", t is not None and "\uce74\uc77c" not in t)

    # 카피본에서 [안내 문구 복사] 링크가 카피본 주소로 나가는지 (env.js 와 같은 설정으로 app.js 재실행)
    try:
        c2 = quickjs.Context()
        c2.eval("var document = { getElementById: function () { return null; } };"
                "var window = globalThis;"
                "window.GF_ENV = {dbRoot: 'board/sandbox', sandbox: true, adminLabel: 'Admin', lsPrefix: 'gf.sandbox.'};")
        c2.eval(readp("app.js"))
        url = c2.eval("__boardTest.boardUrl('#/deploy')")
        ok("카피본 복사 링크는 카피본 주소",
           url == "https://kchkim7554-debug.github.io/grandfirst-board/sandbox/#/deploy", str(url))
    except Exception as e:  # noqa: BLE001
        ok("카피본 복사 링크는 카피본 주소", False, str(e))
    return out, n_pass, n_fail


ctx = quickjs.Context()
lines = []
ctx.add_callable("__log", lambda s: lines.append(str(s)))
ctx.eval("""
var console = { log: function () {
  var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
  __log(a.join(" "));
} };
var document = { getElementById: function () { return null; } };
var window = globalThis;
""")
ctx.eval(read("app.js"))
ctx.eval("globalThis.__BOARD_FAC = " + read("data.json") + ";\n"
         "globalThis.__BOARD_LIVE = " + read("test/live-snapshot.json") + ";")
for f in TEST_FILES:
    ctx.eval(read(f))

print("\n".join(lines))
fail = ctx.eval("globalThis.__BOARD_TEST_FAIL")

shell_out, shell_pass, shell_fail = check_shell()
print("\n".join(shell_out))
print("\n  껍데기 확인 %d개 통과%s" % (shell_pass, "" if not shell_fail else ", %d개 실패" % shell_fail))

sbx_out, sbx_pass, sbx_fail = check_sandbox()
print("\n".join(sbx_out))
print("\n  카피본 확인 %d개 통과%s" % (sbx_pass, "" if not sbx_fail else ", %d개 실패" % sbx_fail))

sys.exit(1 if (fail or shell_fail or sbx_fail) else 0)
