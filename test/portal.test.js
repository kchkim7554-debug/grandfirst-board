#!/usr/bin/env node
/* 첫 화면(시안 A) 검증 — 오늘 요약 배너 · 빠른 메뉴(핵심 5 + 글자 크게) · 지금 처리할 일.
   실 DB에 쓰지 않고 렌더 결과만 본다.
   실행: python3 test/run_quickjs.py   또는   node test/portal.test.js  (board/ 폴더에서) */
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
var P = API.portal;
var O = API.order;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function has(h, s) { return String(h).indexOf(s) >= 0; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, (h || 9) - 9, mi || 0); }
function count(h, re) { return (String(h).match(re) || []).length; }

/* 테스트 기준일 고정 (이 파일은 마지막에 실행된다) */
API.setToday("2026-11-26");

var ZONES = FAC.zones.map(function (z) { return z.id; });

function notice(id, extra) {
  var n = {
    id: id, title: "시험 게시물 " + id, status: "pending_attach", isTest: false,
    postedAt: "2026-11-19", deadline: "2026-11-26",
    targets: [{ board: "lobby", buildings: "all", floors: ["1층"], slot: "02", order: 1 }],
    attach: null, detach: null, archivedAt: null
  };
  Object.keys(extra || {}).forEach(function (k) { n[k] = extra[k]; });
  return n;
}
function allZones(by, team) {
  var o = {};
  ZONES.forEach(function (z) { o[z] = { by: by, team: team, at: ts(2026, 11, 19, 9, 0) }; });
  return o;
}

/* ---------- 1. 오늘 요약 배너 ---------- */
console.log("\n[1] 오늘 요약 배너");
{
  var detach = notice("P1", { attach: allZones("담당", "A"), detach: { front: { by: "염일엽", team: "A", at: ts(2026, 11, 26, 9, 12) } } });
  var posted = notice("P2", { attach: allZones("담당", "A"), deadline: "2026-12-20" });
  var soon = notice("P3", { attach: allZones("담당", "A"), deadline: "2026-11-30" });
  var perm = notice("P4", { attach: allZones("담당", "A"), permanent: true, deadline: null });
  O.load([detach, posted, soon, perm], clone(FAC));
  var h = P.html();
  ok("밝은 톤 오늘 요약 카드", has(h, 'class="daysum"'));
  ok("오늘 제거 건수를 크게 보여 준다", has(h, "오늘 제거할 게시물 <b>1</b>건"));
  eq("요약 숫자 3개(오늘 제거·게시 중·만료 임박)", count(h, /class="t-stat(?=[ "])/g), 3);
  ok("게시 중은 게시물 건수로 센다(게시판 장수 아님)", has(h, '<span class="n">3</span><span class="l">게시 중</span>'));
  ok("만료 임박(7일 이내 + 오늘)은 2건", has(h, '<span class="n">2</span><span class="l">만료 임박</span>'));
  ok("주 버튼은 배포 화면으로 간다", has(h, 'class="t-cta" data-act="go" data-go="#/deploy"'));
  ok("주 버튼에 건수 배지", has(h, '<span class="k">1건</span> 제거 체크 하러 가기'));
  var st = P.stats();
  eq("집계값", [st.removeToday, st.posted, st.soon], [1, 3, 2]);
}

/* ---------- 2. 빠른 메뉴 ---------- */
console.log("\n[2] 빠른 메뉴 — 3열 × 2줄(6칸)");
{
  var h = P.html();
  eq("칸은 6개", count(h, /class="q /g), 6);
  ok("게시물 생성", has(h, 'data-go="#/create"') && has(h, "게시물 생성"));
  ok("게시물 배포", has(h, 'data-go="#/deploy"') && has(h, "게시물 배포"));
  ok("게시 상태", has(h, 'data-go="#/status"') && has(h, "게시 상태"));
  ok("이력·통계", has(h, 'data-go="#/history"') && has(h, "이력·통계"));
  ok("일일 알림", has(h, 'data-go="#/alerts"') && has(h, "일일 알림"));
  ok("글자 크게(가+)", has(h, "data-act=\"font\"") && has(h, "글자 크게"));
  ok("권한 관리는 홈 메뉴에서 빠졌다(⚙ 설정으로 이동)", !has(h, 'data-go="#/admin"'));
  ok("단지 정보도 홈 메뉴에서 빠졌다", !has(h, 'data-go="#/info"'));
  ok("배포 칸 배지 자리", has(h, 'id="menuDeployBadge"'));
  ok("오늘 알림이 없으면 알림 칸 배지는 숨김", !has(h, 'id="menuAlertBadge"'));
}

/* ---------- 3. 지금 처리할 일 — 구역별 완료 상태 ---------- */
console.log("\n[3] 지금 처리할 일 카드");
{
  var byA = notice("D1", { attach: allZones("담당", "A"), detach: { front: { by: "염일엽", team: "A", at: ts(2026, 11, 26, 9, 12) } } });
  var byExt = notice("D2", { attach: allZones("담당", "A"), detach: { front: { by: "외부업체", team: "EXT", at: ts(2026, 11, 26, 8, 0) } } });
  var attachPending = notice("D3", { attach: null });
  var attachPart = notice("D4", { attach: { front: { by: "황보선희", team: "B", at: ts(2026, 11, 26, 7, 40) } } });
  O.load([byA, byExt, attachPending, attachPart], clone(FAC));

  eq("A조 완료 표시", P.zone(byA, "detach", "front").txt, "완료 (A조)");
  eq("A조 완료 색", P.zone(byA, "detach", "front").cls, "done");
  eq("아직 안 한 구역은 미완료", P.zone(byA, "detach", "backA").txt, "미완료");
  eq("외부업체가 한 구역", P.zone(byExt, "detach", "front").txt, "외부업체");
  eq("외부업체 색", P.zone(byExt, "detach", "front").cls, "ext");
  eq("게시 카드의 안 한 구역은 대기", P.zone(attachPending, "attach", "front").txt, "대기");
  eq("B조 완료 표시", P.zone(attachPart, "attach", "front").txt, "완료 (B조)");
  eq("대상이 아닌 구역은 표시 없음", P.zone({ targets: [{ board: "lobby", buildings: [101], floors: ["1층"], slot: "02", order: 1 }] }, "attach", "backB"), null);

  var h = P.html();
  ok("분수(N/3) 대신 완료 상태를 쓴다", !/[0-9]\/3/.test(h), (h.match(/[0-9]\/3/g) || []).join(","));
  ok("완료 (A조)가 카드에 나온다", has(h, "완료 (A조)"));
  ok("외부업체가 카드에 나온다", has(h, ">외부업체<"));
  ok("안내 문구도 한 번 체크로 완료임을 알린다", has(h, "한 곳만 체크하면 그 구역은 완료"));
  ok("카드를 누르면 배포 화면으로 간다", has(h, 'class="ptask" data-act="go" data-go="#/deploy"'));
  eq("처리할 일 4건", P.tasks().length, 4);
  ok("목록 제목", has(h, "지금 처리할 일"));
}

/* ---------- 4. 처리할 일이 없을 때 ---------- */
console.log("\n[4] 처리할 일 없음");
{
  var done = notice("E1", { attach: allZones("담당", "A"), deadline: "2026-12-20" });
  O.load([done], clone(FAC));
  var h = P.html();
  ok("빈 상태 안내", has(h, "지금 처리할 게시물이 없습니다"));
  ok("없을 때도 오늘 요약은 나온다", has(h, "오늘 제거할 게시물 없음"));
  ok("없을 때 주 버튼 문구", has(h, "게시·제거 체크 하러 가기"));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
