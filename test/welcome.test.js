#!/usr/bin/env node
/* 첫 진입 팝업(동·층별 게시판 현황 → 오늘 일일 알림) · 홈 화면 정리 검증
   실 DB에 쓰지 않고 렌더 결과만 본다.
   실행: python3 test/run_quickjs.py   또는   node test/welcome.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var API = globalThis.__boardTest;
var FAC = globalThis.__BOARD_FAC || null;
if (!API && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };
  require(path.join(ROOT, "app.js"));
  FAC = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
}
var W = API.welcome;
var O = API.order;
var A = API.alerts;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function has(h, s) { return String(h).indexOf(s) >= 0; }
function count(h, re) { return (String(h).match(re) || []).length; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function att() { return { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } }; }

API.setToday("2026-11-27");

/* 115동 1층 02번·03번에 게시물을 둔 상태 */
var st = {
  N1: { id: "N1", title: "시험 게시물 하나", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 1,
    targets: [{ board: "lobby", slot: "02", order: 1, buildings: [115], floors: ["1층"], cores: ["123"] }], attach: att() },
  N2: { id: "N2", title: "시험 게시물 둘", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 2,
    targets: [{ board: "lobby", slot: "03", order: 1, buildings: [115], floors: ["1층"], cores: ["123"] }], attach: att() },
  N3: { id: "N3", title: "시험 게시물 셋", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 3,
    targets: [{ board: "lobby", slot: "03", order: 2, buildings: [115], floors: ["1층"], cores: ["123"] }], attach: att() },
  N4: { id: "N4", title: "엘리베이터 시험", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 4,
    targets: [{ board: "elevator", slot: "02", order: 1, buildings: [115], elevators: "all", cores: ["123"] }], attach: att() }
};
O.load(clone(st), FAC);

/* ---------- 1. 첫 번째 팝업 — 동·층별 게시판 현황 ---------- */
console.log("\n[1] 첫 번째 팝업 — 동·층별 게시판 현황");
{
  W.open(115);
  var h = W.board();
  ok("제목", has(h, "동·층별 게시판 현황"));
  ok("동 선택(24동)", has(h, 'id="welNo"') && count(h, /<option /g) === FAC.buildings.length);
  ok("115동이 기본 선택", has(h, '<option value="115" selected>'));
  ok("층·엘리베이터 선택", has(h, ">1층<") && has(h, ">지하1층<") && has(h, ">지하2층<") && has(h, ">엘리베이터<"));
  ok("1층 공동현관 01~12칸", count(h, /data-act="wel-slot"/g) === 12 && has(h, ">12<"));
  ok("게시물이 있는 칸은 제목", has(h, "시험 게시물 하나") && has(h, "시험 게시물 둘"));
  ok("겹친 칸은 장수 배지(2)", has(h, 'class="wslot-b">2<'));
  ok("빈 칸 표시", has(h, "빈 게시판"));
  ok("게시/제거 칸 수", has(h, "게시 3장") && has(h, "제거 0칸"));
  ok("우측 상단 [닫기]", has(h, 'class="popx"') && has(h, ">닫기<"));

  W.set({ loc: "fb1" });
  var hb = W.board();
  ok("지하1층으로 바꾸면 그 층(비어 있음)", has(hb, "공동현관 홀 · 지하1층") && has(hb, "빈 게시판"));

  W.set({ loc: "e1" });
  var he = W.board();
  ok("엘리베이터 판 01~06", has(he, "엘리베이터 1호기 내 게시판") && count(he, /data-act="wel-slot"/g) === 6);
  ok("엘리베이터 게시물 표시", has(he, "엘리베이터 시험"));
}

/* ---------- 2. 닫기 → 두 번째 팝업(오늘 일일 알림) ---------- */
console.log("\n[2] 두 번째 팝업 — 오늘 일일 알림");
{
  A.set({
    "2026-11-27": {
      date: "2026-11-27", shift: "A조", weekday: "금", summary: "오늘(11/27 금) A조 제거 대상 1건",
      events: [{ title: "소방 점검", time: "10:00~12:00", detail: "동별 순차" }],
      items: [{ title: "오늘 제거할 게시물", location: "1층 공동현관 03번 첫 번째", message: "오늘 제거 바랍니다.", cardImage: "templates/cards/x.jpg" }]
    }
  });
  A.setUi({ tab: "list", sort: "desc", from: "", to: "", shift: "all", open: "" });
  W.open(115);
  W.set({ step: 1 });
  W.next();
  ok("첫 팝업 닫기 → 두 번째 팝업", W.state().step === 2);
  var a = W.alert();
  ok("제목·날짜", has(a, "오늘의 일일 알림") && has(a, "2026년 11월 27일 (금)") && has(a, "A조"));
  ok("오늘 주의할 내용 섹션", has(a, "오늘 주의할 내용") && has(a, "소방 점검"));
  ok("오늘 제거대상 게시물 섹션", has(a, "오늘 제거대상 게시물") && has(a, "오늘 제거할 게시물"));
  ok("카드 이미지·안내 문구는 그대로", has(a, 'class="acard"') && has(a, "오늘 제거 바랍니다."));
  ok("복사·저장 버튼은 없다", !has(a, "안내 문구 복사") && !has(a, "카드 저장") && !has(a, "제거 목록 복사"));
  ok("우측 상단 [닫기]", has(a, 'data-act="wel-close"') && has(a, ">닫기<"));
  ok("일일 알림 전체 보기", has(a, 'data-act="wel-alerts"'));

  W.next();
  ok("두 번째 팝업 닫으면 끝", W.state().on === false);
}

/* ---------- 3. 홈 화면 정리 ---------- */
console.log("\n[3] 홈 화면 — 하단 Firebase 안내문 삭제");
{
  var h = API.portal.html();
  ok("Firebase 안내 문구가 없다", !has(h, "Firebase에 실시간 저장") && !has(h, "관리자 인증(PIN) 후 가능"));
  ok("빠른 메뉴는 그대로", has(h, "빠른 메뉴") && has(h, 'data-go="#/deploy"'));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
