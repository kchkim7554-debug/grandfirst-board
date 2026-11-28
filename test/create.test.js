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
  ok("사진이 없을 때는 사진 없음 안내", has(h, "사진<br>없음"));
  C.state().photo = "data:image/jpeg;base64,AAAA";
  var hp = C.form();
  ok("올린 사진을 누르면 확대(라이트박스 zoom)", has(hp, 'data-act="zoom"') && has(hp, 'data-src="data:image/jpeg;base64,AAAA"') && has(hp, "확대"));
  ok("확대 안내 문구", has(hp, "누르면 크게 보기"));
  C.state().photo = null;
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

/* ---------- 7. [이동] — 이동대상은 현재 게시된 게시물 ---------- */
console.log("\n[7] [이동] — 이동대상 찾기 (게시된 게시물만)");
{
  var API7 = globalThis.__boardTest;
  API7.setToday("2026-11-27");
  var att = { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } };
  var st = {
    M1: { id: "M1", title: "이동 시험 1", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 1,
      targets: [{ board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층", "지하1층"] }], attach: att },
    M2: { id: "M2", title: "이동 시험 2", status: "posted", postedAt: "2026-11-21", deadline: "2026-12-10", createdAt: 2,
      targets: [{ board: "elevator", slot: "05", order: 1, buildings: "all", elevators: "all" }], attach: att },
    M3: { id: "M3", title: "게시 대기", status: "pending_attach", postedAt: "2026-11-22", deadline: "2026-12-10", createdAt: 3,
      targets: [{ board: "lobby", slot: "07", order: 1, buildings: "all", floors: ["1층"] }], attach: null }
  };
  O.load(clone(st), FAC);
  var posted = M.posted().map(function (n) { return n.id; });
  eq("게시 완료된 게시물만 이동대상", posted, ["M1", "M2"]);
  ok("게시 대기 게시물은 제외", posted.indexOf("M3") < 0);

  M.reset();
  M.pick("M1");
  eq("고른 게시물의 게시장소가 자동 기록", M.state().noticeId, "M1");
  ok("게시판 종류도 게시물에 맞춰진다", M.state().board === "lobby");
  var h7 = M.screen();
  ok("이동전 게시장소에 현재 위치 표시", has(h7, "공동현관 1층·지하1층 03번"));
}

/* ---------- 8. [이동] — 정합성 확인과 이동목록 등록 ---------- */
console.log("\n[8] [이동] — 이동전/이동후 개수 확인 · 이동목록 등록");
{
  var API8 = globalThis.__boardTest;
  API8.setToday("2026-11-27");
  var att8 = { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } };
  var st8 = {
    M1: { id: "M1", title: "이동 시험 1", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 1,
      targets: [{ board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층", "지하1층"] }], attach: att8 }
  };
  O.load(clone(st8), FAC);
  M.reset();
  var c0 = M.check();
  ok("이동대상이 없으면 실행 불가", c0.ok === false && has(c0.msg, "이동대상"));

  M.pick("M1");
  var c1 = M.check();
  ok("이동후 번호를 고르기 전에는 개수 불일치", c1.ok === false && has(c1.msg, "이동후 0곳") && has(c1.msg, "개수가 달라"), c1.msg);

  M.state().slot = "05";
  M.state().floors = "all";
  var c2 = M.check();
  ok("이동전 1곳 = 이동후 1곳이면 실행 가능", c2.ok === true && has(c2.msg, "일치"), c2.msg);

  M.state().slot = "03";
  M.state().floors = ["1층", "지하1층"];
  var c3 = M.check();
  ok("같은 자리(03번·같은 층)는 실행 불가", c3.ok === false && has(c3.msg, "같은 자리"), c3.msg);
  M.state().slot = "05";
  M.state().floors = "all";

  var e = M.entry();
  ok("이동목록 등록 내용", e && e.noticeId === "M1" && e.dst.slot === "05" && e.status === "pending" &&
    has(e.fromText, "03번") && has(e.toText, "05번"), JSON.stringify(e && { f: e.fromText, t: e.toText }));
  var res = M.applyPending(e);
  eq("이동 확정 → 실제 게시 위치가 05번", res.updates["board/notices/M1/targets"][0].slot, "05");
  eq("이동 확정 → 이동목록에서 제거", res.updates["board/moves/" + e.id], null);
  ok("이동 확정 → 게시물 갱신 시각 기록", typeof res.updates["board/notices/M1/updatedAt"] === "number");
  eq("이동전/이동후 표시 문구", [res.dest.slot, res.from.slot], ["05", "03"]);

  var stale = M.applyPending({ id: "x", noticeId: "M1", src: { board: "lobby", slot: "09", order: 1, buildings: "all", floors: ["1층"] }, dst: { board: "lobby", slot: "10", order: 1, buildings: "all", floors: ["1층"] }, fromText: "", toText: "" });
  ok("이미 바뀐 위치를 확정하면 안내하고 중단", !!stale.error && has(stale.error, "바뀌었습니다"));
}

/* ---------- 9. [이동] 화면 — 3단 구성 · 확인 팝업 · 이동목록 ---------- */
console.log("\n[9] [이동] 화면 — ① 대상 ② 이동전 ③ 이동후 · 확인 팝업 · 이동목록");
{
  var API9 = globalThis.__boardTest;
  API9.setToday("2026-11-27");
  var att9 = { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } };
  var st9 = {
    M1: { id: "M1", title: "이동 시험 1", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 1,
      targets: [{ board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층", "지하1층"] }], attach: att9 },
    M2: { id: "M2", title: "이동 시험 2", status: "posted", postedAt: "2026-11-21", deadline: "2026-12-10", createdAt: 2,
      targets: [{ board: "lobby", slot: "01", order: 1, buildings: "all", floors: ["1층", "지하1층", "지하2층"] }], attach: att9 }
  };
  O.load(clone(st9), FAC);
  M.reset();
  M.pick("M1");
  var h = M.screen();
  ok("① 이동대상 ② 이동전 게시장소 ③ 이동후 게시장소", has(h, "이동대상") && has(h, "이동전 게시장소") && has(h, "이동후 게시장소"));
  ok("이동대상 목록", has(h, 'data-act="mv-target"') && has(h, "이동 시험 1") && has(h, "이동 시험 2"));
  ok("이동전은 자동 기록(읽기 전용 박스)", has(h, 'class="mvfrom"') && has(h, "공동현관"));
  ok("이동후 게시판/층/번호 선택", has(h, 'data-act="mv-dest-board"') && has(h, 'data-act="mv-dest-floor"') &&
    (h.match(/data-act="mv-dest-slot"/g) || []).length === 12);
  ok("정합성 안내 문구", has(h, "이동후 0곳") && has(h, "개수가 달라 실행할 수 없습니다"));
  ok("[이동실행] 버튼(불일치면 비활성)", has(h, 'data-act="mv-run"') && has(h, "이동실행") && has(h, "disabled"));
  ok("최근 이동기록은 사라졌다", !has(h, "최근 이동 기록") && !has(h, "좌우 패널"));

  var cf = M.confirm();
  ok("확인 팝업 — 다시 한번 확인 바랍니다", has(cf, "다시 한번 확인 바랍니다") && has(cf, "<th>대상</th>") &&
    has(cf, "<th>이동전</th>") && has(cf, "<th>이동후</th>") && has(cf, "취소") && has(cf, "이동실행"));

  M.state().slot = "05";
  M.setPending({
    "m1": { id: "m1", at: 1795000000000, date: "2026-11-27", by: "Admin", noticeId: "M1", title: "이동 시험 1",
      src: { board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층", "지하1층"] },
      dst: { board: "lobby", slot: "05", order: 1, buildings: "all", floors: ["전체"] },
      fromText: "전체 24개동 · 공동현관 1층·지하1층 03번", toText: "전체 24개동 · 공동현관 전체층 05번", status: "pending" },
    "m2": { id: "m2", at: 1795000001000, date: "2026-11-27", by: "Admin", noticeId: "M2", title: "이동 시험 2",
      src: { board: "lobby", slot: "01", order: 1, buildings: "all", floors: ["1층"] },
      dst: { board: "lobby", slot: "06", order: 1, buildings: "all", floors: ["1층"] },
      fromText: "전체 24개동 · 공동현관 1층 01번", toText: "전체 24개동 · 공동현관 1층 06번", status: "pending" }
  });
  var h2 = M.screen();
  ok("이동목록에 대기 2건", (h2.match(/data-act="mv-pick"/g) || []).length === 2 && has(h2, "전체 선택"));
  ok("이동목록 표 머리 5칸", has(h2, "<th class=\"ck\">선택</th>") && has(h2, "<th>변경일</th>") && has(h2, "<th>이동대상</th>") &&
    has(h2, "<th>이동전 게시장소</th>") && has(h2, "<th>이동후 게시장소</th>"));
  ok("선택 후 이동 취소", has(h2, 'data-act="mv-pending-cancel-picked"') && has(h2, "선택 후 이동 취소"));
  ok("이동목록 행에 이동전·이동후", has(h2, "공동현관 전체층 05번") && has(h2, "1층 06번"));
  ok("배포에서 확정 안내", has(h2, "배포") && has(h2, "이동 확정"));

  var dep = M.pendingSection();
  ok("배포 탭 이동 대기 카드", has(dep, "이동 대기"));
  ok("비관리자에게는 [이동 확정] 버튼이 없다", !has(dep, 'data-act="mv-pending-apply"') && has(dep, "관리자 인증 후 가능"));
  API.state().SESSION.role = "admin";
  var dep2 = M.pendingSection();
  ok("관리자: 배포 탭 카드에 [이동 확정]", has(dep2, "이동 대기") && has(dep2, 'data-act="mv-pending-apply"'));
  API.state().SESSION.role = null;
}

/* ---------- 10. 느린 회선: 시설 데이터보다 게시물이 먼저 와도 멈추지 않는다 ---------- */
console.log("\n[10] 시설 데이터보다 게시물이 먼저 도착");
{
  var threw = false;
  try { O.load(clone(LIVE), null); } catch (e) { threw = true; }
  ok("시설 데이터 없이 게시물이 와도 예외 없음", !threw);
  O.load(clone(LIVE), FAC);
}

/* ---------- 11. 회귀(2026-11-28): 칩·선택이 조용히 멈추던 문제 ---------- */
console.log("\n[11] 회귀 — 칩을 눌렀을 때 도는 화면 갱신 함수가 실제로 있다");
{
  ok("refreshCreate 정의됨", typeof C.refresh === "function");
  ok("refreshCreateList 정의됨", typeof C.refreshList === "function");
  var threw = false, r1, r2;
  try { r1 = C.refresh(); r2 = C.refreshList(); } catch (e) { threw = true; }
  ok("DOM 이 없어도 예외 없이 끝난다(render 로 대체)", !threw);
  ok("저장 오류 안내 함수도 정의됨", typeof C.error === "function");
  var threw2 = false;
  try { C.error("게시 기한을 고르거나 '기한 없음'을 선택하세요", "nfDeadline"); C.error(""); } catch (e) { threw2 = true; }
  ok("오류 안내도 DOM 없이 예외 없음", !threw2);

  /* 소스 검사 — 정의 없는 refresh*() 호출이 다시 생기지 않게 한다
     (20261127a 개편에서 refreshCreate 정의가 빠져 칩·선택이 ReferenceError 로 멈췄다) */
  var src = globalThis.__APP_SRC || "";
  ok("app.js 소스를 읽었다", src.length > 1000);
  var used = {}, m;
  var re = /(?:^|[^\w$.])(refresh[A-Za-z0-9_]*)\s*\(/g;
  while ((m = re.exec(src))) used[m[1]] = true;
  var missing = Object.keys(used).filter(function (n) {
    return !(new RegExp("function\\s+" + n + "\\s*\\(")).test(src) &&
      !(new RegExp("var\\s+" + n + "\\s*=")).test(src);
  });
  eq("정의 없이 부르는 refresh*() 가 없다", missing, []);
  ok("칩 처리부가 refreshCreate 를 부른다(되돌림 방지)", /data-act="nf-bld"/.test(src) &&
    /nf-bld[\s\S]{0,400}refreshCreate\(\)/.test(src));
}

/* ---------- 12. 저장이 막힌 이유를 폼 안에 보여 준다 ---------- */
console.log("\n[12] 저장 안내 — 기한 필수 표시 · 오류 상자 · 안내 문구");
{
  C.reset();
  var h = C.form();
  ok("오류 상자(nfErr)가 저장 버튼 위에 있다", has(h, 'id="nfErr"') &&
    h.indexOf('id="nfErr"') < h.indexOf('data-act="nf-save"'));
  ok("게시 기한은 필수(*)", has(h, '게시 기한 <span class="req">*</span>'));
  ok("기한 없음 안내(둘 중 하나 필요)", has(h, "기한 없음") && has(h, "둘 중 하나는 꼭 필요합니다"));
  ok("② 게시장소 카드에 id(nfPlace)", has(h, 'id="nfPlace"'));
  C.state().noDeadline = true;
  ok("기한 없음이면 달력은 잠김", has(C.form(), 'id="nfDeadline" value="" disabled'));
  C.state().noDeadline = false;
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
