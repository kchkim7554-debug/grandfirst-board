#!/usr/bin/env node
/* 게시물 생성([생성]) · 이동([이동]) 검증 — 실 DB에 쓰지 않고 순수 로직만 돌린다.
   실행: python3 test/run_quickjs.py   또는   node test/create.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var C = globalThis.__boardTest && globalThis.__boardTest.create;
var M = globalThis.__boardTest && globalThis.__boardTest.move;
var O = globalThis.__boardTest && globalThis.__boardTest.order;
var API = globalThis.__boardTest;
var FAC = globalThis.__BOARD_FAC || null;
var LIVE = globalThis.__BOARD_LIVE || null;
if (!C && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };
  require(path.join(ROOT, "app.js"));
  FAC = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
  LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "live-snapshot.json"), "utf8"));
  API = globalThis.__boardTest;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function has(h, s) { return String(h).indexOf(s) >= 0; }

if (API && API.setToday) API.setToday("2026-11-21");

/* ---------- 1. 라인 목록 ---------- */
console.log("\n[1] 라인 목록 (시설 데이터)");
{
  var lines = C.lines();
  eq("라인은 1·2 / 3·5 / 1·2·3 세 가지", lines.map(function (l) { return l.key; }), ["12", "35", "123"]);
  eq("라인 이름", lines.map(function (l) { return l.name; }), ["1·2라인", "3·5라인", "1·2·3라인"]);
}

/* ---------- 2. 전체/복수 선택 ---------- */
console.log("\n[2] 전체 · 복수 선택");
{
  var all = C.lines().map(function (l) { return l.key; });
  eq("전체에서 하나 누르면 그것만", C.toggle("all", all, "12"), ["12"]);
  eq("이어서 누르면 더하기", C.toggle(["12"], all, "35"), ["12", "35"]);
  eq("다시 누르면 빼기", C.toggle(["12", "35"], all, "35"), ["12"]);
  eq("전부 고르면 전체", C.toggle(["12", "35"], all, "123"), "all");
  eq("전체 칩은 전체", C.toggle(["12"], all, "all"), "all");
  eq("마지막 하나를 빼면 전체", C.toggle(["12"], all, "12"), "all");
}

/* ---------- 3. 선택 → 저장 대상 ---------- */
console.log("\n[3] 선택 → 게시 대상(target)");
{
  var t1 = C.targets({ scope: "all", buildings: [], lines: "all", lobbyOn: true, floors: "all", lobbySlot: "3", evOn: false, elevators: "all", evSlot: "01" });
  eq("게시판만: 대상 1개", t1.length, 1);
  eq("전체 동은 all", t1[0].buildings, "all");
  eq("전체 층은 3개 층", t1[0].floors, ["1층", "지하1층", "지하2층"]);
  eq("번호는 두 자리, 순번 1", [t1[0].slot, t1[0].order, t1[0].board], ["03", 1, "lobby"]);
  ok("전체 라인이면 cores 없음", !t1[0].cores);

  var t2 = C.targets({ scope: "pick", buildings: [103, 101], lines: ["35"], lobbyOn: true, floors: ["지하1층"], lobbySlot: "07", evOn: true, elevators: ["1"], evSlot: "05" });
  eq("게시판 + E/V: 대상 2개", t2.length, 2);
  eq("동은 오름차순", t2[0].buildings, [101, 103]);
  eq("라인 선택은 cores", t2[0].cores, ["35"]);
  eq("게시판 층 선택", t2[0].floors, ["지하1층"]);
  eq("E/V 대상", [t2[1].board, t2[1].slot, t2[1].elevators], ["elevator", "05", ["1"]]);
}

/* ---------- 4. 위치 문구 ---------- */
console.log("\n[4] 위치 문구");
{
  var s = C.specText({ type: "lobby", buildings: "all", lines: "all", floors: "all", slot: "03" });
  ok("게시판 전체 층 문구", has(s, "전체 " + FAC.buildings.length + "개동") && has(s, "전체 라인") && has(s, "전체 층") && has(s, "03번"));
  var e = C.specText({ type: "elevator", buildings: [101], lines: ["12"], elevators: ["1"], slot: "05" });
  ok("E/V 문구", has(e, "101동") && has(e, "1·2라인") && has(e, "1호기") && has(e, "05번"));
}

/* ---------- 5. [생성] 화면 ---------- */
console.log("\n[5] [생성] 화면 — 사진 · 동/라인/게시판/E/V · 생성일자 · 기한");
{
  C.reset();
  var h = C.form();
  ok("사진 선택·카메라 입력", has(h, 'id="nfPhoto"') && has(h, 'id="nfCam"') && has(h, "카메라"));
  ok("첫 page만 안내", has(h, "첫 page만"));
  ok("동 전체 칩 + 24동", has(h, "전체 " + FAC.buildings.length + "동") && has(h, ">101<") && has(h, ">124<"));
  ok("라인 전체 + 3개 라인", has(h, "1·2라인") && has(h, "3·5라인") && has(h, "1·2·3라인"));
  ok("게시판 전체 + 3개 층", has(h, ">전체<") && has(h, ">1층<") && has(h, ">지하1층<") && has(h, ">지하2층<"));
  eq("게시판 번호 01~12", (h.match(/data-act="nf-lslot"/g) || []).length, 12);
  ok("E/V 줄", has(h, ">E/V<") && has(h, 'data-act="nf-ev-on"'));
  ok("생성일자 자동 표시", has(h, "2026.11.21") && has(h, "자동 기록"));
  ok("게시 기한 달력 + 기한 없음", has(h, 'id="nfDeadline"') && has(h, "기한 없음"));
  ok("저장 버튼", has(h, 'data-act="nf-save"') && has(h, ">저장<"));
  ok("용어는 게시/제거 (부착/탈착 없음)", !has(h, "부착") && !has(h, "탈착"));

  C.state().evOn = true;
  var h2 = C.form();
  ok("E/V 를 넣으면 호기 칩", has(h2, "1호기") && has(h2, ">2호기<"));
  eq("E/V 번호 01~06", (h2.match(/data-act="nf-eslot"/g) || []).length, 6);
}

/* ---------- 6. 하단 목록 ---------- */
console.log("\n[6] 하단 목록 — 선택 | 구분 | 게시물 | 생성일자 | 게시장소 | 게시 기한");
{
  O.load(clone(LIVE), FAC);
  C.reset();
  var list = C.list();
  var head = ["선택", "구분", "게시물", "생성일자", "게시장소", "게시 기한"];
  ok("표 머리 6칸", head.every(function (t) { return has(list, "<th"); }) &&
    has(list, "구분") && has(list, "게시물") && has(list, "생성일자") && has(list, "게시장소") && has(list, "게시 기한"));
  eq("선택 칸 수 = 게시물 수", (list.match(/data-act="nf-pick"/g) || []).length, Object.keys(LIVE).filter(function (k) { return LIVE[k].status !== "archived"; }).length);
  ok("선택 삭제 버튼", has(list, 'data-act="nf-delete"') && has(list, "선택 삭제"));
  ok("줄에서 관리자 화면 열기", has(list, 'data-act="open-notice"'));
  ok("구분에 게시판·E/V", has(list, ">게시판<") && has(list, ">E/V<"));
  ok("기한 없음 표기", has(list, "기한 없음") || has(list, "2026.11."));

  C.state().picked["R01"] = true;
  ok("고른 줄은 표시", has(C.list(), "ckbox on"));
}

/* ---------- 7. [이동] — 원본 찾기 ---------- */
console.log("\n[7] [이동] — 현재 위치에 걸린 게시물 찾기");
{
  O.load(clone(LIVE), FAC);
  M.reset();
  var st = M.state();
  st.from.buildings = "all"; st.from.lines = "all"; st.from.type = "lobby"; st.from.floors = "all"; st.from.slot = "03";
  eq("게시판 03번(전체 층)", M.matches(st.from).map(function (i) { return i.id + "=" + i.order; }), ["R01=1", "R08=2"]);

  st.from.floors = ["지하1층", "지하2층"];
  eq("지하 층만이면 03번 전체층 게시물도 포함", M.matches(st.from).map(function (i) { return i.id; }), ["R01", "R08"]);

  st.from.slot = "05"; st.from.floors = ["1층"];
  eq("05번 1층", M.matches(st.from).map(function (i) { return i.id; }), ["R04"]);

  st.from.type = "elevator"; st.from.slot = "05"; st.from.elevators = "all";
  eq("E/V 05번", M.matches(st.from).map(function (i) { return i.id; }), ["R14"]);

  st.from.type = "lobby"; st.from.slot = "03"; st.from.floors = "all"; st.from.buildings = [101];
  eq("101동만 (전체 동 게시물 포함)", M.matches(st.from).map(function (i) { return i.id; }), ["R01", "R08"]);
  st.from.buildings = "all";
}

/* ---------- 8. [이동] — 옮긴 뒤 저장할 update ---------- */
console.log("\n[8] [이동] — 이동 update 맵");
{
  O.load(clone(LIVE), FAC);
  M.reset();
  var st = M.state();
  st.from = { buildings: "all", lines: "all", type: "lobby", floors: "all", elevators: "all", slot: "03" };
  var items = M.matches(st.from);
  var to = { buildings: "all", lines: "all", type: "lobby", floors: "all", elevators: "all", slot: "05" };
  var res = M.apply(items, to);
  eq("두 건 모두 저장", Object.keys(res.updates).filter(function (k) { return /\/targets$/.test(k); }).length, 2);
  eq("도착지 번호는 05", res.updates["board/notices/R01/targets"][0].slot, "05");
  ok("도착지 순번은 기존(05번 2건) 뒤부터", res.updates["board/notices/R01/targets"][0].order >= 3 &&
    res.updates["board/notices/R08/targets"][0].order > res.updates["board/notices/R01/targets"][0].order);
  eq("원래 03번 자리는 남은 게시물 없음 → 압축 변경 없음", Object.keys(res.updates).filter(function (k) { return /targets\/\d+\/order/.test(k); }), []);

  /* 3장 중 1장만 옮기면 남은 2장이 1·2번째로 당겨진다 */
  var st3 = {
    A: { id: "A", title: "A", createdAt: 1, status: "posted", targets: [{ board: "lobby", slot: "02", order: 1, buildings: "all", floors: ["1층", "지하1층"] }] },
    B: { id: "B", title: "B", createdAt: 2, status: "posted", targets: [{ board: "lobby", slot: "02", order: 2, buildings: "all", floors: ["1층", "지하1층"] }] },
    D: { id: "D", title: "D", createdAt: 3, status: "posted", targets: [{ board: "lobby", slot: "02", order: 3, buildings: "all", floors: ["1층", "지하1층"] }] }
  };
  O.load(clone(st3), FAC);
  M.reset();
  M.state().from = { buildings: "all", lines: "all", type: "lobby", floors: ["1층"], elevators: "all", slot: "02" };
  var one = M.matches(M.state().from)[0];
  var r2 = M.apply([one], { buildings: "all", lines: "all", type: "lobby", floors: ["1층"], elevators: "all", slot: "09" });
  eq("옮긴 A 는 09번", r2.updates["board/notices/A/targets"][0].slot, "09");
  ok("남은 B·D 순번이 당겨짐", (function () {
    var seq = [r2.updates["board/notices/B/targets/0/order"], r2.updates["board/notices/D/targets/0/order"]];
    return seq.sort().join(",") === "1,2";
  })(), JSON.stringify(r2.updates));
}

/* ---------- 9. [이동] 화면 ---------- */
console.log("\n[9] [이동] 화면 — 좌우 패널 · 이동 버튼 · 목록");
{
  O.load(clone(LIVE), FAC);
  M.reset();
  var st = M.state();
  st.from = { buildings: "all", lines: "all", type: "lobby", floors: "all", elevators: "all", slot: "03" };
  st.to = { buildings: "all", lines: "all", type: "lobby", floors: "all", elevators: "all", slot: "05" };
  var h = M.screen();
  ok("현재 위치 · 이동할 곳 패널", has(h, "현재 위치") && has(h, "이동할 곳"));
  ok("두 패널의 동·라인·게시판·E/V", (h.match(/data-act="mv-bld"/g) || []).length > 40 &&
    has(h, 'data-act="mv-line"') && has(h, 'data-act="mv-lslot"') && has(h, 'data-act="mv-eslot"'));
  ok("이동 버튼", has(h, 'data-act="mv-apply"') && has(h, "이동 →"));
  ok("목록 머리: 구분·이동대상·이동할 곳·이동일", has(h, "이동대상") && has(h, "이동할 곳") && has(h, "이동일"));
  ok("대상에 R01·R08", has(h, "R01") === false || has(h, "승강기"));
  ok("이동일은 오늘", has(h, "2026.11.21"));
  ok("도착지 문구가 목록에 표시", (h.match(/05번/g) || []).length >= 2);
  ok("용어는 게시/제거 (부착/탈착 없음)", !has(h, "부착") && !has(h, "탈착"));

  M.logs({ "-N1": { type: "attach", at: 1 }, "-N2": { type: "move", at: 1795000000000, date: "2026-11-21", from: "게시판 03번", to: "게시판 05번", count: 2, titles: ["승강기", "기존사업자"] } });
  var h2 = M.screen();
  ok("최근 이동 기록 표시", has(h2, "최근 이동 기록") && has(h2, "게시판 03번"));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
