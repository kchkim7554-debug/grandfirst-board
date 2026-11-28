/* =====================================================================
   pwa.js — 원터치 앱 설치 + 버전·업데이트 알림 (도시락 관리 2026-11-28)
   ---------------------------------------------------------------------
   ① 앱 설치 — 크롬의 beforeinstallprompt 를 잡아 두었다가 [📲 앱 설치]
      버튼 한 번으로 설치 창을 띄운다. (크롬 ⋮ 메뉴를 찾아 들어갈 필요 없음)
      · 아이폰 사파리·카톡 인앱브라우저처럼 설치 창을 띄울 수 없는 환경에서는
        설정 시트에 한 줄 안내를 보여 준다.
   ② 버전 관리 — index.html 의 window.DS_APP_VERSION 이 그 화면의 버전이다.
      새 배포를 감지하면(서비스 워커 waiting 또는 version.json 차이) 자동으로
      새로고침하지 않고 [🆕 새 버전이 준비됐습니다 · 지금 업데이트] 배너를 띄운다.
      누르면 reg.waiting.postMessage({type:"SKIP_WAITING"}) → controllerchange
      → location.reload() 로 그때 최신 버전을 적용한다.
   ③ 감지 시점 — 앱 실행 시 · 화면으로 돌아올 때(visibilitychange) ·
      5분마다 reg.update() + version.json(no-store) 확인.
   ---------------------------------------------------------------------
   테스트: 이 파일 아래쪽 순수 함수는 globalThis.__pwaTest 로 노출되어
   test/pwa.test.js (python3 test/run_quickjs.py) 가 검사한다.
   ===================================================================== */
(function () {
  "use strict";

  var W = (typeof window !== "undefined") ? window : globalThis;
  var FALLBACK_VERSION = "20261128c";

  /* ------------------------------------------------------------------
     순수 함수 — DOM 없이도 검사할 수 있는 부분
     ------------------------------------------------------------------ */

  /* "20261128m" → "v2026.11.28l" */
  function versionLabel(v) {
    v = String(v == null ? "" : v).trim();
    if (!v) return "";
    var m = /^(\d{4})(\d{2})(\d{2})([a-z]*)$/i.exec(v);
    if (!m) return "v" + v;
    return "v" + m[1] + "." + m[2] + "." + m[3] + m[4];
  }

  /* 서버(version.json)와 이 화면의 버전이 다른가 */
  function isDifferent(serverVersion, pageVersion) {
    var a = String(serverVersion == null ? "" : serverVersion).trim();
    var b = String(pageVersion == null ? "" : pageVersion).trim();
    return !!a && !!b && a !== b;
  }

  /* 설치 창(prompt)을 띄울 수 있는 환경인지 — 안내 문구를 고르는 기준 */
  function platformOf(ua) {
    ua = String(ua || "");
    if (/KAKAOTALK|NAVER\(|DaumApps|Instagram|FBAN|FBAV|Line\/|; wv\)|Whale/i.test(ua)) return "inapp";
    if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "other";
  }

  function installGuide(platform, standalone) {
    if (standalone) return "✅ 지금 앱으로 실행 중입니다 — 주소창 없는 전체화면.";
    if (platform === "ios") return "아이폰·아이패드는 Safari 하단 공유 → ‘홈 화면에 추가’를 누르면 설치됩니다.";
    if (platform === "inapp") return "카톡·네이버 같은 앱 안에서는 설치가 안 됩니다. 오른쪽 위 ⋮ → ‘다른 브라우저로 열기’ 후 [📲 앱 설치]를 누르세요.";
    if (platform === "android") return "안드로이드는 크롬 오른쪽 위 ⋮ → ‘앱 설치’(또는 ‘홈 화면에 추가’)를 누르면 됩니다.";
    return "브라우저 메뉴에서 ‘홈 화면에 추가’를 고르면 앱처럼 설치됩니다.";
  }

  /* 설치 시트에 보여 줄 단계별 안내 */
  function installSteps(platform, standalone) {
    if (standalone) return [];
    if (platform === "ios") return ["Safari 하단 가운데 공유 버튼(□↑)을 누릅니다",
      "목록에서 ‘홈 화면에 추가’를 고릅니다", "오른쪽 위 ‘추가’를 누르면 홈 화면에 생깁니다"];
    if (platform === "inapp") return ["오른쪽 위 ⋮ → ‘다른 브라우저로 열기’", "크롬에서 이 주소를 다시 엽니다",
      "크롬 오른쪽 위 ⋮ → ‘앱 설치’"];
    if (platform === "android") return ["크롬 오른쪽 위 ⋮ 를 누릅니다", "‘앱 설치’(없으면 ‘홈 화면에 추가’)를 고릅니다",
      "이름이 ‘도시락 관리’인지 확인하고 설치합니다"];
    return ["브라우저 메뉴를 엽니다", "‘앱 설치’ 또는 ‘홈 화면에 추가’를 고릅니다"];
  }

  /* 게시판 앱과 주소가 겹칠 때의 안내 — 설치 창이 안 뜨는 실제 이유 */
  function overlapNote(platform, standalone) {
    if (standalone) return "";
    if (platform === "ios") return "";
    return "이미 설치된 ‘게시판 관리’ 앱과 주소가 겹치면 크롬이 설치 창을 띄우지 않을 수 있습니다. " +
      "‘앱 설치’ 대신 ‘게시판 관리에서 열기’만 보이면 그 경우입니다 — 스마트에게 " +
      "‘도시락 앱 따로 설치되게 해줘’라고 말해 주세요.";
  }

  /* 설치 상태: installed(이미 앱으로 실행 중) · ready(버튼 한 번) · guide(안내만) */
  function installMode(opt) {
    opt = opt || {};
    if (opt.standalone) return "installed";
    if (opt.canPrompt) return "ready";
    return "guide";
  }

  /* 하단에 뜨는 배너 — update(새 버전) / install(앱 설치) */
  function bannerHTML(mode, opt) {
    opt = opt || {};
    if (mode === "update") {
      var ver = versionLabel(opt.version || "");
      return '<div class="pwap-txt"><b>🆕 새 버전이 준비됐습니다</b>' +
        '<span>' + (ver ? ver + ' · ' : '') + '눌러서 지금 적용</span></div>' +
        '<button class="pwap-btn" data-pwa="update">지금 업데이트</button>' +
        '<button class="pwap-x" data-pwa="dismiss" aria-label="닫기">✕</button>';
    }
    if (mode === "install") {
      return '<div class="pwap-txt"><b>📲 앱으로 설치</b>' +
        '<span>홈 화면에 두고 주소창 없이 전체화면으로</span></div>' +
        '<button class="pwap-btn" data-pwa="install">📲 앱 설치</button>' +
        '<button class="pwap-x" data-pwa="dismiss" aria-label="닫기">✕</button>';
    }
    return "";
  }

  /* 설정 시트 맨 아래 — 현재 버전 · 설치 · 업데이트 확인 */
  function settingsHTML(opt) {
    opt = opt || {};
    var ver = versionLabel(opt.version || "");
    var mode = installMode(opt);
    var newVer = versionLabel(opt.serverVersion || "");
    var badge = opt.update
      ? '<i class="new">새 버전' + (newVer ? " " + newVer : "") + '</i>'
      : '<i class="ok">최신</i>';

    var rows = "";
    if (!opt.sandbox) {
      if (mode === "installed") {
        rows += '<div class="msrow done"><span class="si">✅</span>앱으로 실행 중입니다</div>';
      } else {
        rows += '<button class="msrow" data-pwa="install"><span class="si">📲</span>앱 설치' +
          '<span class="ch">›</span></button>';
      }
    }
    rows += '<button class="msrow" data-pwa="check"><span class="si">🔄</span>업데이트 확인' +
      '<span class="ch">›</span></button>';

    var guide = opt.sandbox ? "" : installGuide(opt.platform, opt.standalone);
    return '<div class="pwaset-h">앱 · 버전</div>' +
      '<div class="pwaset-ver">현재 <b>' + ver + '</b>' + badge + '</div>' +
      rows +
      (guide ? '<div class="pwaset-guide">' + guide + '</div>' : '') +
      '<div class="pwaset-msg" id="pwaSetMsg">' + (opt.msg || '') + '</div>';
  }

  var API = {
    FALLBACK_VERSION: FALLBACK_VERSION,
    versionLabel: versionLabel,
    isDifferent: isDifferent,
    platformOf: platformOf,
    installGuide: installGuide,
    installSteps: installSteps,
    overlapNote: overlapNote,
    installMode: installMode,
    bannerHTML: bannerHTML,
    settingsHTML: settingsHTML
  };
  try { W.__pwaTest = API; } catch (e) {}

  /* ------------------------------------------------------------------
     실제 화면 연결 (브라우저에서만)
     ------------------------------------------------------------------ */
  var doc = W.document;
  if (!doc || !doc.addEventListener || !doc.getElementById || !doc.createElement) return;

  var VERSION = String((W.DS_APP_VERSION || FALLBACK_VERSION));
  var SANDBOX = !!(W.DS_ENV && W.DS_ENV.sandbox);
  var LS_PREFIX = (W.DS_ENV && W.DS_ENV.lsPrefix) || "ds.";
  var nav = W.navigator || {};

  var reg = null;              /* ServiceWorkerRegistration */
  var reloadArmed = false;     /* [지금 업데이트] 를 누른 뒤에만 새로고침 */
  var lastCheck = 0;           /* reg.update() 스로틀(1분) */
  var workerVersion = "";      /* 대기 중인 워커가 알려 준 버전 */
  var msgTimer = null;

  var state = {
    standalone: false,
    platform: "other",
    canPrompt: false,
    deferred: null,            /* beforeinstallprompt 이벤트 */
    waitingWorker: null,
    update: false,             /* 새 버전 준비됨 */
    serverVersion: "",
    msg: "",
    dismissed: false,
    installedNow: false,       /* 방금 설치를 마쳤다 — 설치 칩을 감춘다 */
    sandbox: SANDBOX
  };

  function isStandalone() {
    try {
      var mq = W.matchMedia;
      if (mq && (mq("(display-mode: standalone)").matches ||
                 mq("(display-mode: fullscreen)").matches ||
                 mq("(display-mode: minimal-ui)").matches)) return true;
    } catch (e) {}
    return nav.standalone === true;
  }

  function readFlag(k) {
    try { return W.localStorage.getItem(LS_PREFIX + k) === "1"; } catch (e) { return false; }
  }
  function writeFlag(k, on) {
    try {
      if (on) W.localStorage.setItem(LS_PREFIX + k, "1");
      else W.localStorage.removeItem(LS_PREFIX + k);
    } catch (e) {}
  }

  function setMsg(text) {
    state.msg = text || "";
    renderSettings();
    renderInstallSheet();
    clearTimeout(msgTimer);
    if (state.msg) msgTimer = setTimeout(function () { state.msg = ""; renderSettings(); }, 8000);
  }

  /* 새 배포를 이미 받아 화면이 최신인지 — 서버·대기 워커 모두 이 화면과 같은 버전이면 그렇다 */
  function screenIsCurrent() {
    return !isDifferent(workerVersion, VERSION) && !isDifferent(state.serverVersion, VERSION);
  }

  /* ---------- 배너 ---------- */
  function renderBanner() {
    var host = doc.getElementById("pwaPrompt");
    var html = "";
    if (!state.dismissed) {
      if (state.update) html = bannerHTML("update", { version: state.serverVersion || workerVersion || VERSION });
      else if (!state.standalone && !SANDBOX && state.canPrompt && !readFlag("installed")) html = bannerHTML("install", {});
    }
    if (!html) {
      if (doc.body && doc.body.classList) doc.body.classList.remove("pwa-bar");
      if (host && host.parentNode) host.parentNode.removeChild(host);
      return;
    }
    if (!host) {
      host = doc.createElement("div");
      host.id = "pwaPrompt";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      doc.body.appendChild(host);
    }
    host.className = "pwap" + (state.update ? " upd" : "");
    /* 배너가 본문 마지막 요소(저장 버튼 등)를 가리지 않도록 body 에 여백 클래스를 준다 */
    if (doc.body && doc.body.classList && !doc.body.classList.contains("pwa-bar")) doc.body.classList.add("pwa-bar");
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  /* ---------- 설정 시트 맨 아래 블록 ---------- */
  function renderSettings() {
    var sheet = doc.getElementById("setSheet");
    if (!sheet) return;
    var box = doc.getElementById("pwaSet");
    if (!box) {
      box = doc.createElement("div");
      box.id = "pwaSet";
      box.className = "pwaset";
      var target = sheet.querySelector ? (sheet.querySelector(".moreSheet") || sheet) : sheet;
      target.appendChild(box);
    }
    var html = settingsHTML({
      version: VERSION,
      serverVersion: state.serverVersion,
      update: state.update,
      standalone: state.standalone,
      platform: state.platform,
      canPrompt: state.canPrompt,
      sandbox: SANDBOX,
      msg: state.msg
    });
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  function render() { renderBanner(); renderSettings(); renderInstallChip(); renderInstallSheet(); }

  /* ---------- 상단 헤더의 상시 [📲 설치] 칩 ----------
     beforeinstallprompt 가 아직/영영 오지 않아도 설치 안내를 바로 열 수 있게 한다.
     앱으로 설치돼 standalone 으로 도는 중에는 절대 보이지 않는다. */
  function renderInstallChip() {
    var chip = doc.getElementById("instChip");
    if (!chip) return;
    var show = !state.standalone && !state.installedNow;
    chip.hidden = !show;
    chip.className = "instchip" + (state.canPrompt ? " ready" : "");
  }

  /* ---------- 앱 설치 시트 ---------- */
  function renderInstallSheet() {
    var box = doc.getElementById("ovInstall");
    if (!box) return;
    var mode = installMode({ standalone: state.standalone, canPrompt: state.canPrompt });
    var st = doc.getElementById("instState");
    if (st) {
      st.textContent = mode === "installed" ? "지금 앱으로 실행 중입니다"
        : mode === "ready" ? "한 번 누르면 설치 창이 뜹니다"
        : state.platform === "inapp" ? "이 브라우저(앱 안)에서는 설치 창을 띄울 수 없습니다"
        : "브라우저 메뉴에서 설치해 주세요";
    }
    var go = doc.getElementById("instGo");
    if (go) go.hidden = mode !== "ready";
    var g = doc.getElementById("instGuide");
    if (g) g.textContent = installGuide(state.platform, state.standalone);
    var ol = doc.getElementById("instSteps");
    if (ol) {
      var steps = installSteps(state.platform, state.standalone);
      var h = "";
      for (var i = 0; i < steps.length; i++) h += "<li>" + steps[i] + "</li>";
      if (ol.innerHTML !== h) ol.innerHTML = h;
      ol.hidden = !steps.length;
    }
    var note = doc.getElementById("instNote");
    if (note) {
      var t = overlapNote(state.platform, state.standalone);
      if (note.textContent !== t) note.textContent = t;
      note.hidden = !t;
    }
    var done = doc.getElementById("instDone");
    if (done) { done.hidden = !state.msg; done.textContent = state.msg; }
  }

  /* 앱(app.js)의 시트 열기·닫기(뒤 화면 스크롤 잠금 포함)를 그대로 쓴다 — 없으면 단순 대체 */
  function uiOpen(id) {
    var ui = W.DS_UI;
    if (ui && typeof ui.openOv === "function") { ui.openOv(id); return; }
    var el = doc.getElementById(id);
    if (!el) return;
    el.hidden = false;
    if (doc.documentElement.classList) doc.documentElement.classList.add("lock");
    if (doc.body.classList) doc.body.classList.add("lock");
  }
  function uiClose(id) {
    var ui = W.DS_UI;
    if (ui && typeof ui.closeOv === "function") { ui.closeOv(id); return; }
    var el = doc.getElementById(id);
    if (!el) return;
    el.hidden = true;
    if (doc.documentElement.classList) doc.documentElement.classList.remove("lock");
    if (doc.body.classList) doc.body.classList.remove("lock");
  }

  function openInstallSheet() {
    state.dismissed = false;
    renderInstallSheet();
    if (state.standalone || state.installedNow) {
      setMsg(installGuide(state.platform, true));
      return;
    }
    uiOpen("ovInstall");
  }

  /* ---------- 설치 ---------- */
  function doInstall() {
    var d = state.deferred;
    if (!d || typeof d.prompt !== "function") {
      setMsg(installGuide(state.platform, state.standalone));
      return;
    }
    try { d.prompt(); } catch (e) { setMsg(installGuide(state.platform, state.standalone)); return; }
    state.deferred = null;
    state.canPrompt = false;
    var choice = d.userChoice || Promise.resolve({});
    choice.then(function (res) {
      if (res && res.outcome === "accepted") {
        writeFlag("installed", true);
        setMsg("설치를 시작했습니다 — 홈 화면의 ‘도시락 관리’ 아이콘으로 열어 주세요.");
      } else {
        setMsg("설치를 취소했습니다. 나중에 설정 → [📲 앱 설치]로 다시 할 수 있습니다.");
      }
      renderBanner();
      renderInstallSheet();
    }).catch(function () { renderBanner(); });
  }

  /* ---------- 새 버전 확인 ---------- */
  function fetchVersion() {
    if (typeof W.fetch !== "function") return Promise.resolve("");
    return W.fetch("version.json", { cache: "no-store" }).then(function (r) {
      return (r && r.ok) ? r.json() : null;
    }).then(function (j) {
      var v = (j && j.version) ? String(j.version).trim() : "";
      state.serverVersion = v;
      if (isDifferent(v, VERSION)) {
        state.update = true;
        state.dismissed = false;
      }
      render();
      return v;
    }).catch(function () { return ""; });
  }

  function markWaiting(worker) {
    state.waitingWorker = worker || null;
    workerVersion = "";
    state.update = true;
    state.dismissed = false;
    render();
    /* 대기 워커가 알려 주는 버전으로 진짜 새 버전인지 가린다(화면이 이미 새 파일로 뜬 경우 안내를 내린다) */
    if (worker && typeof worker.postMessage === "function") {
      try { worker.postMessage({ type: "GET_VERSION" }); } catch (e) {}
    }
  }

  function doUpdate() {
    var w = state.waitingWorker || (reg && reg.waiting);
    reloadArmed = true;
    if (w && typeof w.postMessage === "function") {
      try { w.postMessage({ type: "SKIP_WAITING" }); } catch (e) {}
      /* 워커가 응답하지 않는 경우를 대비한 안전장치 — 그래도 최신 파일로 다시 받는다 */
      setTimeout(function () {
        if (reloadArmed) { reloadArmed = false; W.location.reload(); }
      }, 3000);
    } else {
      /* 대기 워커 없이 version.json 만 새 버전인 경우(설치 전 브라우저 등) — 바로 새로고침 */
      try { W.location.reload(); } catch (e) {}
    }
  }

  function doCheck() {
    setMsg("확인 중…");
    /* 워커 갱신 → version.json 확인 → 결과 안내 (Promise 사슬을 피해 단순하게) */
    var afterFetch = function (v) {
      setTimeout(function () {
        if (state.update) {
          setMsg("새 버전" + (v ? " " + versionLabel(v) : "") + "이 준비됐습니다 — [지금 업데이트]를 누르세요.");
        } else if (!v) {
          setMsg("버전을 확인하지 못했습니다 — 연결을 확인해 주세요.");
        } else {
          setMsg("최신 버전입니다 (" + versionLabel(VERSION) + ").");
        }
      }, 600);
    };
    var afterUpdate = function () {
      var p;
      try { p = fetchVersion(); } catch (e) { p = null; }
      if (p && typeof p.then === "function") p.then(afterFetch, function () { afterFetch(""); });
      else afterFetch("");
    };
    if (!reg) { afterUpdate(); return; }
    var u = null;
    try { u = reg.update(); } catch (e) {}
    if (u && typeof u.then === "function") u.then(afterUpdate, afterUpdate);
    else afterUpdate();
  }

  /* ---------- 서비스 워커 ---------- */
  function startSW() {
    if (!("serviceWorker" in nav) || !nav.serviceWorker || typeof nav.serviceWorker.register !== "function") return;

    /* 도시락 폴더(/grandfirst-board/dosirak/) 안으로만 스코프를 좁힌다.
       게시판 워커는 /grandfirst-board/ 전체를 덮으므로, 같은 출처의 두 앱이
       서로의 요청을 가로채지 않도록 등록 스코프를 명시한다(로컬 미리보기에서도 동작). */
    var scope = "./";
    var swUrl = "sw.js";
    try {
      var here = new URL("./", W.location.href);
      scope = here.pathname;                 /* 예: /grandfirst-board/dosirak/ */
      swUrl = scope + "sw.js";
    } catch (e) {}

    function onReg(r) {
      reg = r;
      if (r.waiting) markWaiting(r.waiting);
      if (r.addEventListener) {
        r.addEventListener("updatefound", function () {
          var nw = r.installing;
          if (!nw || !nw.addEventListener) return;
          nw.addEventListener("statechange", function () {
            /* 새 워커가 설치를 마치고 대기(waiting)로 들어온 순간 — 자동 새로고침하지 않는다 */
            if (nw.state === "installed" && nav.serviceWorker.controller) markWaiting(r.waiting || nw);
          });
        });
      }
      try { r.update(); } catch (e) {}
      fetchVersion();
    }

    try {
      nav.serviceWorker.register(swUrl, { scope: scope, updateViaCache: "none" }).then(onReg).catch(function () {
        /* 스코프를 명시한 등록이 거부되는 환경 — 페이지 기준 상대 등록으로 한 번 더 */
        try {
          nav.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).then(onReg).catch(function () {});
        } catch (e) {}
      });
    } catch (e) {}

    /* [지금 업데이트] 로만 도는 새로고침 — 첫 설치(claim) 때는 새로고침하지 않는다 */
    nav.serviceWorker.addEventListener("controllerchange", function () {
      if (!reloadArmed) return;
      reloadArmed = false;
      try { W.location.reload(); } catch (e) {}
    });
  }

  /* 앱 실행 · 화면 복귀 · 5분마다 새 배포 확인 */
  function refresh(force) {
    if (doc.visibilityState && doc.visibilityState !== "visible") return;
    var now = Date.now();
    if (!force && now - lastCheck < 60000) return;
    lastCheck = now;
    if (reg) { try { reg.update(); } catch (e) {} }
    fetchVersion();
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    W.addEventListener("beforeinstallprompt", function (e) {
      /* 브라우저 기본 미니 배너 대신 앱 안의 [📲 앱 설치] 버튼으로 띄운다 */
      try { e.preventDefault(); } catch (err) {}
      state.deferred = e;
      state.canPrompt = true;
      state.dismissed = false;
      writeFlag("installed", false);
      render();
    });

    W.addEventListener("appinstalled", function () {
      state.canPrompt = false;
      state.deferred = null;
      state.installedNow = true;
      writeFlag("installed", true);
      setMsg("설치했습니다 — 홈 화면의 ‘도시락 관리’ 아이콘으로 열면 주소창 없이 뜹니다.");
      render();
    });

    /* 상단 헤더의 [📲 설치] 칩 — 언제든 설치 안내를 연다 */
    var chip = doc.getElementById("instChip");
    if (chip && chip.addEventListener) {
      chip.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        openInstallSheet();
      });
    }

    doc.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-pwa]") : null;
      if (!el) return;
      var act = el.getAttribute("data-pwa");
      if (act === "install") { e.preventDefault(); doInstall(); }
      else if (act === "update") { e.preventDefault(); doUpdate(); }
      else if (act === "check") { e.preventDefault(); doCheck(); }
      else if (act === "dismiss") {
        e.preventDefault();
        state.dismissed = true;
        renderBanner();
      }
    });

    doc.addEventListener("visibilitychange", function () { refresh(false); });
    W.setInterval(function () { refresh(false); }, 5 * 60 * 1000);
    W.addEventListener("online", function () { refresh(true); });

    /* 대기 워커가 알려 준 버전 — 이 화면과 같으면 '새 버전' 안내를 내린다 */
    if (nav.serviceWorker && nav.serviceWorker.addEventListener) {
      nav.serviceWorker.addEventListener("message", function (ev) {
        var d = (ev && ev.data) || {};
        if (d.type !== "VERSION") return;
        workerVersion = String(d.version || "");
        if (screenIsCurrent()) state.update = false;
        render();
      });
    }
  }

  function init() {
    state.standalone = isStandalone();
    state.platform = platformOf(nav.userAgent);
    if (doc.body && state.standalone) doc.body.classList.add("pwa-standalone");
    bind();
    /* index.html <head> 가 먼저 잡아 둔 beforeinstallprompt (이 스크립트보다 먼저 와도 놓치지 않는다) */
    if (W.__DS_BIP__) {
      state.deferred = W.__DS_BIP__;
      state.canPrompt = true;
    }
    startSW();
    render();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})();
