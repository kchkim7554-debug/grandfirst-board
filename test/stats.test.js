#!/usr/bin/env node
/* 게시물 통계(누적조회 · 년월별) 집계 검증 — 실 DB에 쓰지 않고 순수 로직만 돌린다.
   실행: python3 test/run_quickjs.py   또는   node test/stats.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var FAC = globalThis.__BOARD_FAC || null;
var LIVE = globalThis.__BOARD_LIVE || null;
if (!FAC && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };   // start() 자동 실행 방지
  require(path.join(ROOT, "app.js"));
  FAC = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
  LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "live-snapshot.json"), "utf8"));
}
var S = globalThis.__boardTest.stats;
var O = globalThis.__boardTest.order;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
/* 한국 시간 기준 시각(ms) */
function ts(y, mo, d, h, mi) {
  return Date.UTC(y, mo - 1, d, (h || 9) - 9, mi || 0);
}

/* ---------- 작은 시설/게시물 픽스처 ---------- */
var F2 = {
  zones: [
    { id: "front", name: "정문", short: "정문", buildings: [101, 102] },
    { id: "backA", name: "후문A", short: "후문A", buildings: [109] }
  ],
  buildings: [
    { no: 101, zone: "front", cores: [] },
    { no: 102, zone: "front", cores: [] },
    { no: 109, zone: "backA", cores: [] }
  ],
  boards: { lobby: { floors: ["1층", "지하1층"] }, elevator: {} }
};
function notice(id, o) {
  var n = { id: id, title: "테스트 " + id, targets: [], attach: null, detach: null, postedAt: "", isTest: false };
  Object.keys(o || {}).forEach(function (k) { n[k] = o[k]; });
  return n;
}
var N1 = notice("N1", {
  targets: [{ board: "lobby", buildings: "all", floors: ["1층"], slot: "03", order: 1 }],
  postedAt: "2026-11-05",
  attach: {
    front: { by: "가", team: "A", at: ts(2026, 11, 16, 17, 20) },
    backA: { by: "나", team: "B", at: ts(2026, 11, 16, 17, 25) }
  },
  detach: { front: { by: "나", team: "B", at: ts(2026, 11, 20, 7, 5) } }
});
var N2 = notice("N2", {                                    // E/V · 게시일 없음 → 게시 체크 시각 사용
  targets: [{ board: "elevator", buildings: [101], elevators: "all", slot: "05", order: 1 }],
  attach: { front: { by: "가", team: "A", at: ts(2026, 11, 18, 23, 30) } }   // 한국시간 11-18 23:30
});
var N3 = notice("N3", {                                    // 테스트 건 → 집계 제외
  isTest: true,
  targets: [{ board: "lobby", buildings: "all", slot: "01", order: 1 }],
  postedAt: "2026-11-01",
  attach: { front: { team: "A", at: ts(2026, 11, 1) }, backA: { team: "B", at: ts(2026, 11, 1) } }
});
var N4 = notice("N4", {                                    // 게시판 + E/V 동시 → 합계 2건
  targets: [
    { board: "lobby", buildings: [101], floors: ["1층"], slot: "02", order: 1 },
    { board: "elevator", buildings: [101], elevators: "all", slot: "02", order: 1 }
  ],
  postedAt: "2026-10-31",
  attach: { front: { by: "가", team: "A", at: ts(2026, 11, 2) } }
});
var N5 = notice("N5", {                                    // 제거 체크 시각 없음 → 보관일 사용
  targets: [{ board: "lobby", buildings: [109], floors: ["1층"], slot: "04", order: 1 }],
  postedAt: "2026-09-10",
  attach: { backA: { by: "나", team: "B", at: ts(2026, 9, 10) } },
  detach: { backA: { by: "", team: "", at: 0 } },
  archivedAt: "2026-11-19"
});
var FIX = [N1, N2, N3, N4, N5];
var EV = S.events(clone(FIX), F2);

/* ---------- 1. 게시·제거 이벤트 계산 ---------- */
console.log("\n[1] 게시·제거 이벤트 계산");
{
  var posts = EV.filter(function (e) { return e.type === "post"; });
  var removes = EV.filter(function (e) { return e.type === "remove"; });
  eq("게시 이벤트 6건 (N1 2 + N2 1 + N4 2 + N5 1 · 테스트 N3 제외)", posts.length, 6);
  eq("제거 이벤트 2건 (N1 1 + N5 1)", removes.length, 2);
  ok("테스트 게시물(N3) 은 이벤트에 없음", posts.every(function (e) { return e.noticeId !== "N3"; }));

  var n1 = posts.filter(function (e) { return e.noticeId === "N1"; });
  eq("N1 은 구역 2곳 → 게시 2건", n1.length, 2);
  ok("N1 게시일은 postedAt(2026-11-05) 우선", n1.every(function (e) { return e.date === "2026-11-05"; }),
    JSON.stringify(n1.map(function (e) { return e.date; })));
  eq("N1 조는 체크 기록의 team", n1.map(function (e) { return e.team; }).sort(), ["A", "B"]);

  var n2 = posts.filter(function (e) { return e.noticeId === "N2"; })[0];
  eq("N2 게시일은 게시 체크 시각(한국시간 2026-11-18)", n2.date, "2026-11-18");
  eq("N2 는 E/V 1건", n2.kind, "elevator");

  var n4 = posts.filter(function (e) { return e.noticeId === "N4"; });
  eq("N4 는 게시판 1 + E/V 1", n4.map(function (e) { return e.kind; }).sort(), ["elevator", "lobby"]);

  var n5r = removes.filter(function (e) { return e.noticeId === "N5"; })[0];
  eq("N5 제거일은 보관일(archivedAt)", n5r.date, "2026-11-19");
  eq("N5 조 기록이 없으면 미지정('')", n5r.team, "");

  var n1r = removes.filter(function (e) { return e.noticeId === "N1"; })[0];
  eq("N1 제거는 제거 체크 구역(정문) 1건 · B조", [n1r.zone, n1r.team, n1r.date], ["front", "B", "2026-11-20"]);
}

/* ---------- 2. 기간(년월) 집계 ---------- */
console.log("\n[2] 누적조회 — 기간 집계");
{
  var all = S.aggregate(EV, "", "");
  eq("전체 게시 합계 (N1 2 + N2 1 + N4 2 + N5 1)", all.post.total, 6);
  eq("전체 게시 = 게시판 + E/V", all.post.lobby + all.post.elevator, all.post.total);
  eq("전체 제거 합계", all.remove.total, 2);
  eq("게시 A조 4건 (N1 정문 + N2 + N4 2건)", all.post.teams.A.total, 4);
  eq("게시 B조 2건 (N1 후문A + N5 후문A)", all.post.teams.B.total, 2);

  var oct = S.aggregate(EV, "2026-10", "2026-10");
  eq("2026-10 게시 2건 (N4 게시판·E/V, postedAt 10-31)", [oct.post.total, oct.post.lobby, oct.post.elevator], [2, 1, 1]);
  eq("2026-10 제거 0건", oct.remove.total, 0);

  var nov = S.aggregate(EV, "2026-11", "2026-11");
  eq("2026-11 게시 3건 (N1 2 + N2 1)", nov.post.total, 3);
  eq("2026-11 제거 2건 (N1 + N5 보관일)", nov.remove.total, 2);

  var wide = S.aggregate(EV, "2026-09", "2026-11");
  eq("2026-09 ~ 2026-11 은 전체와 같음(양끝 포함)", [wide.post.total, wide.remove.total], [6, 2]);

  var none = S.aggregate(EV, "2025-01", "2025-12");
  eq("기간 밖은 0건", [none.post.total, none.remove.total], [0, 0]);

  var bad = S.aggregate(EV, "2026-12", "2026-01");
  eq("from > to 여도 계산은 유지(빈 결과)", bad.post.total, 0);

  /* 조별 합 = 전체 합 */
  ["post", "remove"].forEach(function (k) {
    var b = all[k];
    var t = b.teams.A.total + b.teams.B.total + b.teams[""].total;
    eq(k + ": A + B + 미지정 = 합계", t, b.total);
    eq(k + ": A조 항목 = 게시판 + E/V",
      b.teams.A.lobby + b.teams.A.elevator, b.teams.A.total);
  });
}

/* ---------- 3. 년월별 (날짜별) 집계 ---------- */
console.log("\n[3] 년월별 — 날짜별 집계");
{
  var m11 = S.byDay(EV, "2026-11");
  eq("2026-11-05 게시 2건 (N1 정문·후문A)", m11.days["2026-11-05"].post, 2);
  eq("2026-11-18 게시 1건 (N2 E/V)", m11.days["2026-11-18"].post, 1);
  eq("2026-11-20 제거 1건", m11.days["2026-11-20"].remove, 1);
  eq("2026-11-19 제거 1건 (N5 보관일)", m11.days["2026-11-19"].remove, 1);
  ok("2026-11-06 은 기록 없음", !m11.days["2026-11-06"]);
  eq("월 합계 = 날짜별 합", m11.sum.post.total, 3);
  eq("날짜별 items 합 = 월 합계",
    Object.keys(m11.days).reduce(function (a, d) { return a + m11.days[d].items.length; }, 0),
    m11.sum.post.total + m11.sum.remove.total);
  eq("다른 달(2026-10)에는 10-31 게시 2건", S.byDay(EV, "2026-10").sum.post.total, 2);
  eq("다른 달(2026-09)에는 N5 게시 1건", S.byDay(EV, "2026-09").sum.post.total, 1);

  /* 월 이동 */
  eq("전월: 2026-01 → 2025-12", S.shiftMonth("2026-01", -1), "2025-12");
  eq("차월: 2026-12 → 2027-01", S.shiftMonth("2026-12", 1), "2027-01");
  eq("월 표기", S.monthLabel("2026-11"), "2026년 11월");
}

/* ---------- 4. 실 DB 스냅샷(2026-11-18) 집계 ---------- */
console.log("\n[4] 실 DB 스냅샷 집계");
{
  O.load(clone(LIVE), FAC);                     // FAC 를 실제 시설 데이터로
  var liveNotices = Object.keys(LIVE).map(function (k) { return LIVE[k]; });
  var liveEv = S.events(liveNotices, FAC);
  var attached = liveNotices.filter(function (n) { return n.attach && Object.keys(n.attach).length; });
  var lobbyN = attached.filter(function (n) { return (n.targets[0].board || "lobby") === "lobby"; }).length;
  var elevN = attached.length - lobbyN;
  var agg = S.aggregate(liveEv, "", "");
  eq("게시 건수 = 게시된 게시물 × 구역 3곳", agg.post.total, attached.length * 3);
  eq("게시판 건수 = 공동현관 게시물 × 3", agg.post.lobby, lobbyN * 3);
  eq("E/V 건수 = 엘리베이터 게시물 × 3", agg.post.elevator, elevN * 3);
  eq("스냅샷에는 제거 기록이 없음", agg.remove.total, 0);
  ok("모든 이벤트에 날짜가 있음", liveEv.every(function (e) { return /^\d{4}-\d{2}-\d{2}$/.test(e.date); }));
  ok("모든 이벤트에 구역·분류가 있음", liveEv.every(function (e) {
    return (e.kind === "lobby" || e.kind === "elevator") && ["front", "backA", "backB"].indexOf(e.zone) >= 0;
  }));
  var byTeam = {};
  liveEv.forEach(function (e) { if (e.type === "post") byTeam[e.team || "?"] = (byTeam[e.team || "?"] || 0) + 1; });
  console.log("    실 스냅샷 게시: 합계 " + agg.post.total + " (게시판 " + agg.post.lobby + " / E/V " + agg.post.elevator +
    ") · A조 " + (byTeam.A || 0) + " · B조 " + (byTeam.B || 0));
}

/* ---------- 5. 화면 렌더 (탭·달력·요약) ---------- */
console.log("\n[5] 화면 렌더");
{
  S.setHist({ tab: "cum", from: "2026-01", to: "2026-11", month: "2026-11", day: "" });
  var cum = S.html();
  ok("누적조회 탭: 탭 3개", ["누적조회", "년월별", "처리 이력"].every(function (t) { return cum.indexOf(t) >= 0; }));
  ok("누적조회 탭: 표 머리 구분/합계/게시판/E-V", ["<th>구분</th>", "합계", "게시판", "E/V"].every(function (t) { return cum.indexOf(t) >= 0; }));
  ok("누적조회 탭: 게시·제거 행과 조별 행", cum.indexOf("(A조)") >= 0 && cum.indexOf("(B조)") >= 0 && cum.indexOf(">게시<") >= 0);
  ok("누적조회 탭: 년월 입력 2개", (cum.match(/type="month"/g) || []).length === 2);
  ok("용어는 게시/제거 (부착/탈착 없음)", cum.indexOf("부착") < 0 && cum.indexOf("탈착") < 0);

  S.setHist({ tab: "month", month: "2026-11", day: "" });
  var mon = S.html();
  ok("년월별 탭: 월 표기와 이동 버튼", mon.indexOf("2026년 11월") >= 0 && mon.indexOf("hist-prev") >= 0 && mon.indexOf("hist-next") >= 0);
  ok("년월별 탭: 요일 머리", ["일", "월", "화", "수", "목", "금", "토"].every(function (w) { return mon.indexOf(">" + w + "<") >= 0; }));
  eq("년월별 탭: 날짜 셀 30개", (mon.match(/data-act="hist-day"/g) || []).length, 30);
  ok("년월별 탭: 파란 게시 · 붉은 제거 표기", mon.indexOf("cal-p") >= 0 && mon.indexOf("cal-r") >= 0);
  ok("년월별 탭: 하단 요약(게시 · A조/B조)", /게시 [0-9,]+건/.test(mon) && /A조 [0-9,]+건/.test(mon) && /B조 [0-9,]+건/.test(mon));

  S.setHist({ day: "2026-11-05" });
  var dayHtml = S.html();
  ok("날짜 선택 시 그날 상세 표시", dayHtml.indexOf("2026년 11월 5일") >= 0 && dayHtml.indexOf("ev-row") >= 0);
  S.setHist({ day: "" });
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
