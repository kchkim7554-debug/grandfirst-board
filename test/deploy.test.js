#!/usr/bin/env node
/* 게시물 배포([게시]·[제거] 체크) 검증 — 특히 외부업체 게시 줄.
   실 DB에 쓰지 않고 순수 렌더 결과만 본다.
   실행: python3 test/run_quickjs.py   또는   node test/deploy.test.js  (board/ 폴더에서) */
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
var D = API.deploy;
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

/* 실 시설 데이터 기준: 구역 3곳(정문·후문A·후문B), 동 24개 */
var N_PENDING = {
  id: "T1", title: "외부업체 게시 시험", status: "pending_attach", isTest: false,
  postedAt: "2026-11-25", deadline: "2026-12-05",
  targets: [{ board: "lobby", buildings: "all", floors: ["1층"], slot: "05", order: 1 }],
  attach: null, detach: null, archivedAt: null
};
var N_GUARD = clone(N_PENDING);            // 정문은 A조 담당자가 이미 게시
N_GUARD.id = "T2";
N_GUARD.attach = { front: { by: "염일엽", team: "A", at: ts(2026, 11, 25, 9, 10) } };
var N_EXT = clone(N_PENDING);               // 외부업체가 전 구역 게시
N_EXT.id = "T3";
N_EXT.attach = {
  front: { by: "외부업체", team: "EXT", at: ts(2026, 11, 25, 8, 0) },
  backA: { by: "외부업체", team: "EXT", at: ts(2026, 11, 25, 8, 5) },
  backB: { by: "외부업체", team: "EXT", at: ts(2026, 11, 25, 8, 10) }
};

O.load([N_PENDING, N_GUARD, N_EXT], clone(FAC));

/* ---------- 1. 게시 카드에 외부업체 줄 ---------- */
console.log("\n[1] [게시] 카드 — 외부업체 줄");
{
  var h = D.card(N_PENDING, "attach");
  ok("A조·B조 줄은 그대로", has(h, ">A조<") && has(h, ">B조<"));
  ok("외부업체 줄이 있다", has(h, 'class="team-tag ext">외부업체<'));
  eq("구역 3곳마다 외부업체 체크 칸", (h.match(/data-act="chk-ext"/g) || []).length, 3);
  ok("담당자 없이도 누를 수 있는 버튼", has(h, 'data-act="chk-ext" data-id="T1" data-kind="attach" data-zone="front"'));
  ok("체크 안 된 칸은 빈 상자", has(h, "<span class=\"box\">☐</span>"));
}

/* ---------- 2. 제거 카드에는 외부업체 줄이 없다 ---------- */
console.log("\n[2] [제거] 카드 — 외부업체 줄 없음");
{
  var n = clone(N_EXT);
  n.deadline = "2026-11-24";
  O.load([n], clone(FAC));
  var h = D.card(n, "detach");
  ok("제거 카드에는 외부업체 줄 없음", !has(h, "team-tag ext"));
  eq("제거 카드에 chk-ext 없음", (h.match(/data-act="chk-ext"/g) || []).length, 0);
}

/* ---------- 3. 외부업체로 기록된 칸 ---------- */
console.log("\n[3] 외부업체로 기록된 칸");
{
  O.load([N_EXT], clone(FAC));
  eq("기록 조는 EXT", D.team(N_EXT, "front", N_EXT.attach.front), "EXT");
  var cell = D.ext(N_EXT, "attach", "front");
  ok("외부업체 칸은 주황 켜짐 표시", has(cell, 'class="chk ext"') && has(cell, "☑") && has(cell, "외부업체"));
  var aCell = D.chk(N_EXT, "attach", "front", "A");
  var bCell = D.chk(N_EXT, "attach", "front", "B");
  ok("A조 칸은 외부업체 기록을 자기가 한 것처럼 보이지 않는다", !has(aCell, " on") && has(aCell, "외부업체"));
  ok("B조 칸도 마찬가지", !has(bCell, " on") && has(bCell, "외부업체"));
  ok("A조 칸에 체크(☑)가 켜지지 않는다", !has(aCell, "☑"));
  ok("B조 칸에도 체크(☑)가 켜지지 않는다", !has(bCell, "☑"));
  ok("A·B조 칸은 주황(ext) 표시가 아니다", !has(aCell, "chk ext") && !has(bCell, "chk ext"));
  ok("A·B조 칸은 흐린 잠금(hold) 표시", has(aCell, "chk hold") && has(bCell, "chk hold"));
  ok("A·B조 칸은 누를 수 있는 버튼이 아니다", !has(aCell, "data-act") && !has(bCell, "data-act"));
  ok("외부업체 칸만 주황 체크로 켜진다", has(cell, "☑") && !has(aCell, "☑") && !has(bCell, "☑"));
  var whole = D.card(N_EXT, "attach");
  eq("카드에서 주황 체크는 외부업체 줄 3칸뿐", (whole.match(/class="chk ext"/g) || []).length, 3);
  eq("카드 전체에서 ☑ 는 외부업체 3칸뿐", (whole.match(/☑/g) || []).length, 3);
}

/* ---------- 4. 담당자가 먼저 게시한 구역은 외부업체로 덮지 않는다 ---------- */
console.log("\n[4] 담당자 게시가 있는 구역");
{
  O.load([N_GUARD], clone(FAC));
  var cell = D.ext(N_GUARD, "attach", "front");
  ok("이미 담당자가 게시한 구역은 외부업체 칸이 잠김(na)", has(cell, "chk na") && has(cell, "염일엽"));
  var free = D.ext(N_GUARD, "attach", "backA");
  ok("비어 있는 구역은 외부업체로 게시 가능", has(free, 'data-act="chk-ext"'));
  var aCell = D.chk(N_GUARD, "attach", "front", "A");
  ok("A조 칸에는 담당자 이름이 그대로", has(aCell, "chk on") && has(aCell, "염일엽"));
}

/* ---------- 5. 배포 화면 전체 ---------- */
console.log("\n[5] 배포 화면");
{
  O.load([N_PENDING], clone(FAC));
  var h = D.useful();
  ok("게시 필요 목록에 카드", has(h, "게시 필요") && has(h, "외부업체 게시 시험"));
  ok("외부업체 줄이 화면에 나온다", has(h, "team-tag ext"));
  ok("게시·제거 용어 유지", has(h, "게시") && has(h, "제거") && !has(h, "부착") && !has(h, "탈착"));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
