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
    "test/welcome.test.js",
    "test/admin.test.js",
    "test/sandbox.test.js",
    "test/pwa.test.js",
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
    ok("하단 탭 5개(홈·생성·배포·제거·알림·더보기)",
       tabs == ["tbHome", "tbCreate", "tbDeploy", "tbAlerts", "tbMore"], str(tabs))
    ok("탭 이름(배포 탭은 '배포·제거')", all(lbl in html for lbl in ['>홈<', '>생성<', '>배포·제거<', '>알림<', '>더보기<']))
    ok("탭 연결", has(html, 'data-go="#/create"') and has(html, 'data-go="#/deploy"') and has(html, 'data-go="#/alerts"'))
    ok("배포·제거·알림 탭 배지", has(html, 'id="tbDeployBadge"') and has(html, 'id="tbAlertBadge"'))
    ok("더보기 시트(게시 상태·이력·통계·설정)", has(html, 'id="moreSheet"')
       and has(html, 'data-go="#/status"') and has(html, 'data-go="#/history"'))
    ok("탭바가 본문을 가리지 않도록 여백(--tabh)", "--tabh" in html and "padding-bottom:calc(var(--tabh)" in html)
    # 2026-11-26 사용자 지적 — 탭바 아래 흰 여백 제거(50px 강제 금지) · 탭바 바탕은 파랑 계열
    ok("탭바 아래 여백은 안전영역만(50px 강제 아님)",
       "--sab:max(6px, env(safe-area-inset-bottom, 0px))" in html and "--sab:max(50px" not in html)
    # 2026-11-26 사용자 요청 — 상단바도 하단 탭바와 같은 파랑(네이비) + 상·하단 바 높이를 절반으로
    ok("상단바 바탕이 하단 탭바와 같은 네이비 그라데이션",
       ".topbar{" in html and html.find("linear-gradient(180deg,#1c4a7c 0%,#123a63 55%,#0d2e52 100%)") >= 0
       and html.count("linear-gradient(180deg,#1c4a7c 0%,#123a63 55%,#0d2e52 100%)") >= 2)
    ok("상단바 흰색 반투명 바탕은 빠졌다", "background:rgba(255,255,255,.94)" not in html)
    ok("상단 제목은 흰색·부제는 연하늘색(어두운 파랑 위 대비)",
       "color:#fff;white-space:nowrap;}" in html and "color:#a6c9e9" in html)
    ok("상단바 위 여백은 30px 강제 아님(슬림)",
       "--sat:max(8px, calc(4px + env(safe-area-inset-top, 0px)))" in html and "--sat:max(30px" not in html)
    ok("하단 탭바 높이는 중간값(--tabh:49px · 전체 55px)",
       "--tabh:49px" in html and "--tabh:38px" not in html and "--tabh:70px" not in html)
    ok("탭바 아이콘·라벨도 중간 크기(20px·.64rem)",
       ".tb svg{width:20px;height:20px" in html and ".tb .l{font-size:.64rem" in html)
    ok("탭바 배지 15px", "min-width:15px;height:15px" in html)
    # 2026-11-26 두 번째 요청 "너무작나? 조금만 키워" — 상단바 높이 50px · 우측 버튼 32px
    ok("상단바 높이 중간값(버튼 32px · 아래 여백 10px)",
       "width:32px;height:32px" in html and "padding:var(--sat) 13px 10px;" in html)
    ok("상단바 글자·칩도 한 단 키움(제목 .95rem · 부제 .65rem)",
       ".brand .bd-t{font-size:.95rem" in html and ".brand .bd-s{font-size:.65rem" in html)
    ok("큰 글자 모드 탭바 --tabh:54px", "html.fs-lg{--tabh:54px;}" in html)
    ok("첫 화면 세로 간격 절반(섹션 8px · 카드 5px)",
       "#view > section + section{margin-top:8px;}" in html and ".ptasks{display:flex;flex-direction:column;gap:5px;}" in html)
    ok("본문 위 여백도 절반(main padding-top 7px)", "main{max-width:760px;margin:0 auto;padding:7px 15px 8px;}" in html)
    ok("탭바 바탕이 파랑 계열(네이비 그라데이션)",
       "linear-gradient(180deg,#1c4a7c 0%,#123a63 55%,#0d2e52 100%)" in html)
    # 배경 — 2026-11-26 사용자 요청: 화면 전체 기본 배경을 민트색으로
    ok("민트색 기본 배경(--bg)", "--bg:#e5f6f1" in html)
    ok("배경 워시(단지 사진 위 채색)도 민트 톤",
       "linear-gradient(180deg,#ecfaf5 0%,#e3f6ef 52%,#d9f1e8 100%)" in html)
    ok("예전 회색 바탕(#f2f5fa)이 기본 배경에서 빠졌다",
       "--bg:#f2f5fa" not in html and "linear-gradient(180deg,#f4f8fc" not in html)
    # 2026-11-27 — PWA 단독 앱 전환으로 상단 네이비 바와 theme-color 를 맞춘다
    ok("theme-color 는 상단 네이비(#0d2e52)", 'name="theme-color" content="#0d2e52"' in html)
    # 2026-11-27 — PWA 단독 앱 실행 (서비스 워커 · 매니페스트 theme_color)
    # 2026-11-28 — 워커 등록·갱신은 pwa.js 로 옮겼다(아래 pwa 블록에서 자세히)
    _pwa_src = ""
    try:
        with open(os.path.join(ROOT, "pwa.js"), encoding="utf-8") as f:
            _pwa_src = f.read()
    except Exception:
        pass
    ok("PWA 서비스 워커 등록(pwa.js)", '.serviceWorker.register("sw.js"' in _pwa_src)
    swp = os.path.join(ROOT, "sw.js")
    ok("board/sw.js 있음", os.path.exists(swp))
    sw = ""
    if os.path.exists(swp):
        with open(swp, encoding="utf-8") as f:
            sw = f.read()
    ok("sw.js — skipWaiting · clients.claim", "self.skipWaiting()" in sw and "self.clients.claim()" in sw)
    ok("sw.js — 캐시 없는 패스스루", 'cache: "no-store"' in sw and "caches.open" not in sw)
    try:
        with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
            mj = json.load(f)
    except Exception:
        mj = {}
    ok("매니페스트 theme_color 는 상단 네이비(#0d2e52)", mj.get("theme_color") == "#0d2e52", str(mj.get("theme_color")))

    # 2026-11-28 — 원터치 앱 설치 · 버전/업데이트 알림 (pwa.js)
    pjp = os.path.join(ROOT, "pwa.js")
    ok("board/pwa.js 있음", os.path.exists(pjp))
    pwa = ""
    if os.path.exists(pjp):
        with open(pjp, encoding="utf-8") as f:
            pwa = f.read()
    ok("pwa.js — index.html 에서 로드", bool(re.search(r'<script src="pwa\.js\?v=\d{8}[a-z]?"', html)))
    ok("index.html — GF_APP_VERSION 상수", 'window.GF_APP_VERSION = "' in html)
    ok("pwa.js — beforeinstallprompt 로 설치 창 잡기",
       "beforeinstallprompt" in pwa and "preventDefault" in pwa and "prompt()" in pwa)
    ok("pwa.js — [📲 앱 설치] 버튼 한 번", 'data-pwa="install"' in pwa and "📲 앱 설치" in pwa)
    ok("pwa.js — 미지원 환경 한 줄 설치 안내", "installGuide" in pwa and "홈 화면에 추가" in pwa)
    ok("pwa.js — 새 버전 배너 문구 · [지금 업데이트]",
       "🆕 새 버전이 준비됐습니다" in pwa and "지금 업데이트" in pwa and 'data-pwa="update"' in pwa)
    ok("pwa.js — SKIP_WAITING 전송", 'type: "SKIP_WAITING"' in pwa)
    ok("pwa.js — controllerchange 뒤에만 새로고침",
       "controllerchange" in pwa and "reloadArmed" in pwa)
    ok("pwa.js — 실행·복귀·주기로 새 배포 확인",
       "visibilitychange" in pwa and "reg.update()" in pwa and "setInterval" in pwa)
    ok("pwa.js — version.json 차이 확인(no-store)",
       'fetch("version.json", { cache: "no-store" })' in pwa)
    ok("pwa.js — 워커 파일 캐시 우회", 'updateViaCache: "none"' in pwa)
    ok("pwa.js — 설정 시트에 현재 버전 표시", "settingsHTML" in pwa and "pwaset" in pwa)
    ok("index.html — 배너·버전 줄 스타일", ".pwap{" in html and ".pwaset{" in html)

    # sw.js — 새 워커는 waiting 으로 남고, [지금 업데이트] 메시지에만 넘긴다
    m_inst = re.search(r'addEventListener\("install",\s*function\s*\([^)]*\)\s*\{([^}]*)\}', sw)
    ok("sw.js — install 때 skipWaiting 하지 않는다(대기)",
       bool(m_inst) and "skipWaiting" not in m_inst.group(1),
       (m_inst.group(1).strip() if m_inst else "install 핸들러 없음"))
    ok("sw.js — SKIP_WAITING 메시지로만 넘긴다",
       "addEventListener(\"message\"" in sw and "SKIP_WAITING" in sw)

    # 버전 하나로 묶기 — index.html · sw.js · version.json · ?v= · 매니페스트
    m_appv = re.search(r'window\.GF_APP_VERSION = "([^"]+)"', html)
    m_swv = re.search(r'const VERSION = "([^"]+)"', sw)
    m_jsv = re.search(r'app\.js\?v=(\d{8}[a-z]?)', html)
    try:
        with open(os.path.join(ROOT, "version.json"), encoding="utf-8") as f:
            vjson = json.load(f)
    except Exception:
        vjson = {}
    vers = [m_appv.group(1) if m_appv else "", m_swv.group(1) if m_swv else "",
            str(vjson.get("version", "")), m_jsv.group(1) if m_jsv else ""]
    ok("버전 하나로 일치 — GF_APP_VERSION · sw.js VERSION · version.json · app.js ?v=",
       len(set(vers)) == 1 and vers[0] >= "20261128k", " / ".join(vers))
    ok("version.json — 앱 버전과 같은 label",
       vjson.get("label") == ("v" + vers[0][:4] + "." + vers[0][4:6] + "." + vers[0][6:8] + vers[0][8:]) if len(vers[0]) >= 8 else False,
       str(vjson.get("label")))
    ok("매니페스트 아이콘 ?v= 도 같은 버전", bool(mj.get("icons")) and
       all(("?v=" + vers[0]) in ic.get("src", "") for ic in mj.get("icons", [])))

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

    # 카피본 전용 매니페스트 — 홈 화면에 "게시판 관리 (테스트용)" 으로 따로 잡힌다
    mf = readp("sandbox/manifest.json")
    ok("sandbox/manifest.json 있음", mf is not None)
    try:
        mj = json.loads(mf or "{}")
    except ValueError:
        mj = {}
    ok("카피본 이름은 (테스트용)", mj.get("name") == "게시판 관리 (테스트용)", str(mj.get("name")))
    ok("카피본 시작 주소는 카피본 안", mj.get("start_url") == "./" and mj.get("scope") == "./",
       str(mj.get("start_url")))
    ok("카피본 아이콘은 원본 icons/ 공용", mj.get("icons") and
       all(i.get("src", "").startswith("../icons/") for i in mj["icons"]))
    ok("카피본 매니페스트 연결", 'rel="manifest" href="sandbox/manifest.json"' in page
       and 'rel="manifest" href="manifest.json"' not in page)
    gen_mf = False
    try:
        with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
            gen_mf = make_sandbox.build_manifest(f.read()) == mf
    except Exception:  # noqa: BLE001
        gen_mf = False
    ok("카피본 매니페스트도 생성물과 동기", gen_mf, "python3 scripts/make_sandbox.py 실행 필요")

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
ctx.eval(read("pwa.js"))   # 설치·버전 알림 — __pwaTest 노출(화면 연결은 DOM 이 없어 건너뜀)
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
