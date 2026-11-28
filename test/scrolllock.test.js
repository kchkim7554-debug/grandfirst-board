#!/usr/bin/env node
/* 모달 스크롤 잠금 검증 (2026-11-28)
   "팝업이 열린 채로 앞 화면을 밀면 뒤 화면이 따라 움직인다" 는 제보로 넣은 잠금 로직.
   · 열린 모달 판별(lock.shown) — 바텀시트·첫 진입 팝업·라이트박스·복사창·더보기/설정 시트
   · 잠금/해제가 app.js 의 열기·닫기 지점과 시작 지점에 모두 걸려 있는지(소스 검사)
   실행: python3 test/run_quickjs.py   또는   node test/scrolllock.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var API = globalThis.__boardTest;
if (!API && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };
  require(path.join(ROOT, "app.js"));
  API = globalThis.__boardTest;
}
var L = API.lock;
var SRC = globalThis.__APP_SRC || "";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function has(s, sub) { return String(s).indexOf(sub) >= 0; }
function count(h, re) { return (String(h).match(re) || []).length; }

/* 열린 모달이 있는/없는 가짜 document — querySelector 만 있으면 된다 */
function fakeDoc(found) {
  var rec = { sel: null };
  rec.querySelector = function (s) { rec.sel = s; return found ? { ok: 1 } : null; };
  return rec;
}

/* ---------- 1. 열린 모달 판별 ---------- */
console.log("\n[1] 열린 모달 판별");
{
  ok("lock API 노출", L && typeof L.shown === "function" && typeof L.sel === "string");
  ok("모달이 있으면 잠금 대상", L.shown(fakeDoc(true)) === true);
  ok("모달이 없으면 잠금 아님", L.shown(fakeDoc(false)) === false);
  ok("document 가 없으면 잠금 아님", L.shown(null) === false);
  ok("querySelector 가 없는 document 도 안전", L.shown({}) === false);

  var d = fakeDoc(true);
  L.shown(d);
  var sel = L.sel;
  ok("바텀시트(#overlayRoot .sheet) 포함", has(sel, "#overlayRoot .sheet"));
  ok("시트 배경(#overlayRoot .backdrop) 포함", has(sel, "#overlayRoot .backdrop"));
  ok("첫 진입 팝업(.popwrap) 포함", has(sel, ".popwrap"));
  ok("라이트박스(.lightbox) 포함", has(sel, ".lightbox"));
  ok("복사창(.copyfallback) 포함", has(sel, ".copyfallback"));
  ok("더보기·설정 시트(.moreWrap) 포함", has(sel, ".moreWrap:not([hidden])"));
  ok("숨긴 더보기 시트는 잠그지 않는다(:not([hidden]))", has(sel, ".moreWrap:not([hidden])"));
  ok("판별은 한 번의 querySelector 로", d.sel === sel);
}

/* ---------- 2. 잠금·해제가 붙어 있는지 (소스) ---------- */
console.log("\n[2] 잠금·해제 연결 (app.js)");
{
  ok("상태 변수 SLOCK", has(SRC, "var SLOCK = { on: false, y: 0, raf: 0 };"));
  ok("잠금 적용 함수", has(SRC, "function applyScrollLock()"));
  ok("한 프레임에 한 번만 반영", has(SRC, "function syncScrollLock()") && has(SRC, "SLOCK.raf"));
  ok("body 를 고정하고 scrollY 를 top 에 보존", has(SRC, 'body.style.top = (-SLOCK.y) + "px"'));
  ok("닫을 때 원래 위치로 복귀", has(SRC, "window.scrollTo(0, SLOCK.y)"));
  ok("html·body 에 lock 클래스", has(SRC, 'html.classList.add("lock")') && has(SRC, 'body.classList.add("lock")'));
  ok("DOM 변화를 지켜본다(MutationObserver)", has(SRC, "new MutationObserver(syncScrollLock)"));
  ok("start() 에서 감시 시작", has(SRC, "bind();\n      watchModals();"));
  ok("바텀시트 열 때", count(SRC, /syncScrollLock\(\);/g) >= 8, String(count(SRC, /syncScrollLock\(\);/g)));
  ok("새 화면으로 갈 때 옛 위치로 되돌리지 않는다", has(SRC, "if (SLOCK.on) SLOCK.y = 0;"));
  ok("예전 방식(body.no-scroll 직접 조작)은 쓰지 않는다", !has(SRC, 'classList.add("no-scroll")'));
  ok("openSheet/closeSheet 안에서 호출", has(SRC, "if (opts.onMount) opts.onMount(sh);\n    syncScrollLock();"));
  ok("알림 표는 가로 스크롤 상자(.tscroll) 안에 있다 — 이 상자가 세로 밀기를 먹던 곳",
     has(SRC, '<div class="statcard" style="padding:2px 2px 4px"><div class="tscroll">'));
}

/* ---------- 3. 앱 상태 ---------- */
console.log("\n[3] 상태");
{
  var st = L.state();
  ok("처음에는 잠금 아님", st.on === false);
  ok("보존 위치 기본값 0", st.y === 0);
}

/* ---------- 4. 잠금 적용·해제 — 팝업이 닫혀 있으면 아무것도 잠그지 않는다 ----------
   (2026-11-28 사용자 제보 "알림 탭 밀기 끌기 안됨" 회귀)
   열린 모달 판별이 틀리거나 해제가 빠지면 html·body 에 .lock 이 남아
   모든 탭에서 화면이 밀리지 않는다. 가짜 document 로 실제 적용·해제를 돌려 본다. */
console.log("\n[4] 잠금 적용·해제");
{
  function cls() {
    var on = {};
    return {
      add: function (c) { on[c] = 1; }, remove: function (c) { delete on[c]; },
      has: function (c) { return !!on[c]; }
    };
  }
  function mkDoc(found) {
    return {
      querySelector: function () { return found ? { ok: 1 } : null; },
      body: { classList: cls(), style: {} },
      documentElement: { classList: cls(), scrollTop: 0 }
    };
  }
  var scrolled = [];
  var realDoc = globalThis.document;
  if (typeof window === "undefined") globalThis.window = globalThis;   // node 로 돌릴 때
  globalThis.scrollTo = function (x, y) { scrolled.push([x, y]); };

  /* 팝업이 모두 닫힌 화면 */
  var d1 = mkDoc(false);
  globalThis.document = d1;
  globalThis.pageYOffset = 120;
  L.apply();
  ok("팝업이 닫혀 있으면 html.lock 을 붙이지 않는다", !d1.documentElement.classList.has("lock"));
  ok("팝업이 닫혀 있으면 body.lock 을 붙이지 않는다", !d1.body.classList.has("lock"));
  ok("팝업이 닫혀 있으면 body 를 고정하지 않는다(top 비어 있음)", !d1.body.style.top, d1.body.style.top);
  ok("팝업이 닫혀 있으면 잠금 상태 false", L.state().on === false);

  /* 팝업이 열린 화면 — 뒤 화면은 잠긴다 */
  var d2 = mkDoc(true);
  globalThis.document = d2;
  globalThis.pageYOffset = 120;
  L.apply();
  ok("팝업이 열리면 html·body 에 lock", d2.documentElement.classList.has("lock") && d2.body.classList.has("lock"));
  ok("팝업이 열리면 현재 위치를 top 에 보존", d2.body.style.top === "-120px", d2.body.style.top);
  ok("잠금 상태 true · 위치 보존", L.state().on === true && L.state().y === 120, JSON.stringify(L.state()));

  /* 다시 닫힌 화면 — 잠금이 풀리고 원래 자리로 */
  var d3 = mkDoc(false);
  globalThis.document = d3;
  L.apply();
  ok("팝업을 닫으면 html·body 의 lock 을 푼다",
     !d3.documentElement.classList.has("lock") && !d3.body.classList.has("lock"));
  ok("닫으면 body top 을 지운다", !d3.body.style.top, d3.body.style.top);
  ok("닫으면 원래 위치로 되돌린다", scrolled.length === 1 && scrolled[0][1] === 120, JSON.stringify(scrolled));
  ok("닫은 뒤 잠금 상태 false", L.state().on === false);

  /* 닫힌 화면에서 한 번 더 불러도 잠기지 않는다(감시자가 반복 호출) */
  L.apply(); L.apply();
  ok("닫힌 채 여러 번 불러도 잠기지 않는다", L.state().on === false && !d3.documentElement.classList.has("lock"));

  globalThis.document = realDoc;
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
