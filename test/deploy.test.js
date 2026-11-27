#!/usr/bin/env node
/* 게시물 배포·제거([게시]·[제거] 체크) 검증 — 특히 외부업체 게시 줄.
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
var M = API.move;
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
function setRole(r) { API.state().SESSION.role = r; }

/* ---------- 0. 일반 화면(비관리자) — 구역 체크 잠금 ---------- */
console.log("\n[0] 일반 화면(비관리자) — 구역별 게시·제거 체크 잠금");
{
  setRole(null);
  var h = D.card(N_PENDING, "attach");
  eq("외부업체 칸은 누를 수 없다", (h.match(/data-act="chk-ext"/g) || []).length, 0);
  ok("A·B조 칸도 누를 수 없다", !has(h, 'data-act="chk"') && !has(h, 'data-act="chk-undo"'));
  eq("A·B조 + 외부업체 = 9칸 모두 잠금 안내", (h.match(/data-act="chk-lock"/g) || []).length, 9);
  ok("잠금 칸은 자물쇠 표시(class lock)", has(h, 'class="chk off lock"'));
  ok("잠금 칸 aria-label 에 관리자 전용", has(h, "관리자 전용"));
  ok("잠금 칸도 담당자 이름·상태는 그대로 보인다", has(h, "염일엽") || has(h, "-"));
  var u = D.useful();
  ok("화면 안내 — 일반 화면은 조회 전용", has(u, "조회 전용") && has(u, "관리자 인증 후 가능"));
  ok("관리자용 체크 안내 문구는 보이지 않는다", !has(u, "도면에 바로 게시"));
  ok("canCheck = false", D.canCheck() === false);
  ok("비관리자 구역 체크는 저장 전에 막힌다", D.toggle("T1", "attach", "front", "A") === false);
  ok("비관리자 외부업체 체크도 막힌다", D.toggleExt("T1", "attach", "front") === false);
  setRole("admin");
  ok("canCheck = true (관리자)", D.canCheck() === true);
}

/* ---------- 1. 게시 카드에 외부업체 줄 ---------- */
console.log("\n[1] [게시] 카드 — 외부업체 줄");
{
  setRole("admin");
  var h = D.card(N_PENDING, "attach");
  ok("A조·B조 줄은 그대로", has(h, ">A조<") && has(h, ">B조<"));
  ok("외부업체 줄이 있다", has(h, 'class="team-tag ext">외부업체<'));
  eq("구역 3곳마다 외부업체 체크 칸", (h.match(/data-act="chk-ext"/g) || []).length, 3);
  ok("담당자 없이도 누를 수 있는 버튼", has(h, 'data-act="chk-ext" data-id="T1" data-kind="attach" data-zone="front"'));
  ok("체크 안 된 칸은 빈 상자", has(h, "<span class=\"box\">☐</span>"));
}

/* ---------- 2. 제거 카드에도 외부업체 줄 ---------- */
console.log("\n[2] [제거] 카드 — 외부업체 줄");
{
  setRole("admin");
  var n = clone(N_EXT);
  n.deadline = "2026-11-24";
  O.load([n], clone(FAC));
  var h = D.card(n, "detach");
  ok("A조·B조 줄은 그대로", has(h, ">A조<") && has(h, ">B조<"));
  ok("제거 카드에도 외부업체 줄이 있다", has(h, 'class="team-tag ext">외부업체<'));
  eq("구역 3곳마다 외부업체 체크 칸", (h.match(/data-act="chk-ext"/g) || []).length, 3);
  ok("제거 카드 칸은 data-kind=\"detach\"", has(h, 'data-act="chk-ext" data-id="T3" data-kind="detach" data-zone="front"'));
  ok("A조·B조 아래, [상세]·[기한 변경] 위에 온다",
    h.indexOf(">B조<") < h.indexOf('class="team-tag ext"') && h.indexOf('class="team-tag ext"') < h.indexOf('data-act="open-notice"'));
  ok("아직 제거 체크가 없으니 빈 상자", has(h, "<span class=\"box\">☐</span>"));
  eq("제거 전에는 체크(☑)가 하나도 없다", (h.match(/☑/g) || []).length, 0);
  eq("게시도 외부업체였던 구역은 주황 점선 안내", (h.match(/chk off posted-ext/g) || []).length, 3);
  ok("안내 문구는 aria-label에 담는다", has(h, "게시도 외부업체"));
  var aCell = D.chk(n, "detach", "front", "A");
  ok("제거 전 A조 칸은 열려 있다(담당자가 뗄 수도 있으므로)", has(aCell, 'data-act="chk"'));
}

/* ---------- 2-1. 제거 카드에서 외부업체로 체크한 뒤 ---------- */
console.log("\n[2-1] 제거 카드 — 외부업체 체크 결과");
{
  setRole("admin");
  var n = clone(N_EXT);
  n.deadline = "2026-11-24";
  n.detach = { front: { by: "외부업체", team: "EXT", at: ts(2026, 11, 26, 9, 30) } };
  O.load([n], clone(FAC));
  eq("제거 기록 조는 EXT", D.team(n, "front", n.detach.front), "EXT");
  var cell = D.ext(n, "detach", "front");
  ok("외부업체 칸은 주황 켜짐 표시", has(cell, 'class="chk ext"') && has(cell, "☑") && has(cell, "외부업체"));
  var aCell = D.chk(n, "detach", "front", "A");
  var bCell = D.chk(n, "detach", "front", "B");
  ok("A조 칸은 흐린 잠금(hold)", has(aCell, "chk hold") && !has(aCell, "data-act"));
  ok("B조 칸도 흐린 잠금(hold)", has(bCell, "chk hold") && !has(bCell, "data-act"));
  ok("A·B조 칸에 체크(☑)가 켜지지 않는다", !has(aCell, "☑") && !has(bCell, "☑"));
  ok("A·B조 칸은 주황(ext) 표시가 아니다", !has(aCell, "chk ext") && !has(bCell, "chk ext"));
  var free = D.ext(n, "detach", "backA");
  ok("남은 구역은 주황 점선 안내를 유지한 채 누를 수 있다", has(free, "chk off posted-ext") && has(free, 'data-act="chk-ext"'));
  var whole = D.card(n, "detach");
  eq("카드에서 주황 체크는 외부업체 1칸뿐", (whole.match(/class="chk ext"/g) || []).length, 1);
  eq("카드 전체에서 ☑는 외부업체 1칸뿐", (whole.match(/☑/g) || []).length, 1);
}

/* ---------- 2-2. 모든 구역을 외부업체로 제거하면 보관함으로 ---------- */
console.log("\n[2-2] 외부업체로 전 구역 제거");
{
  var done = clone(N_EXT);
  done.deadline = "2026-11-24";
  done.detach = {
    front: { by: "외부업체", team: "EXT", at: ts(2026, 11, 26, 9, 0) },
    backA: { by: "외부업체", team: "EXT", at: ts(2026, 11, 26, 9, 5) },
    backB: { by: "외부업체", team: "EXT", at: ts(2026, 11, 26, 9, 10) }
  };
  var moving = clone(N_EXT);
  moving.id = "T4";
  moving.deadline = "2026-11-24";
  O.load([done, moving], clone(FAC));
  var h = D.useful();
  ok("제거 전인 외부업체 게시물은 ③ 제거 필요에 나온다", has(h, "외부업체 게시 시험"));
  ok("제거가 남은 건(T4)은 카드가 남아 있다", has(h, 'data-id="T4"'));
  var arch = clone(done);
  arch.status = "archived";
  arch.archivedAt = "2026-11-26";
  O.load([arch], clone(FAC));
  ok("전 구역 제거로 보관함에 들어간 건은 배포·제거 화면에서 사라진다", !has(D.useful(), "외부업체 게시 시험"));
}

/* ---------- 3. 외부업체로 기록된 칸 ---------- */
console.log("\n[3] 외부업체로 기록된 칸");
{
  setRole("admin");
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
  setRole("admin");
  O.load([N_GUARD], clone(FAC));
  var cell = D.ext(N_GUARD, "attach", "front");
  ok("이미 담당자가 게시한 구역은 외부업체 칸이 잠김(na)", has(cell, "chk na") && has(cell, "염일엽"));
  var free = D.ext(N_GUARD, "attach", "backA");
  ok("비어 있는 구역은 외부업체로 게시 가능", has(free, 'data-act="chk-ext"'));
  var aCell = D.chk(N_GUARD, "attach", "front", "A");
  ok("A조 칸에는 담당자 이름이 그대로", has(aCell, "chk on") && has(aCell, "염일엽"));
}

/* ---------- 5. 배포·제거 화면 전체 ---------- */
console.log("\n[5] 배포·제거 화면");
{
  setRole(null);
  O.load([N_PENDING], clone(FAC));
  var h = D.useful();
  ok("화면 제목은 '게시물 배포·제거'", has(h, "<h2>게시물 배포·제거</h2>"));
  ok("게시 필요 목록에 카드", has(h, "게시 필요") && has(h, "외부업체 게시 시험"));
  ok("외부업체 줄이 화면에 나온다", has(h, "team-tag ext"));
  ok("게시·제거 용어 유지", has(h, "게시") && has(h, "제거") && !has(h, "부착") && !has(h, "탈착"));
}

/* ---------- 6. 게시 중 (제거 예정) — [전체 복사] → [전체보기] ---------- */
console.log("\n[6] 게시 중 전체보기");
{
  API.setToday("2026-11-27");
  var st = {};
  for (var i = 1; i <= 8; i++) {
    st["P" + i] = {
      id: "P" + i, title: "게시 중 시험 " + i, status: "posted", postedAt: "2026-11-10",
      deadline: "2026-12-" + (10 + i), createdAt: i,
      targets: [{ board: "lobby", slot: "0" + i, order: 1, buildings: "all", floors: ["1층"] }],
      attach: { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } }
    };
  }
  st.PERM = { id: "PERM", title: "상시 게시물", status: "posted", postedAt: "2026-11-01", permanent: true, createdAt: 9,
    targets: [{ board: "lobby", slot: "12", order: 1, buildings: "all", floors: ["1층"] }],
    attach: { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } } };
  O.load(clone(st), clone(FAC));
  var h = D.useful();
  ok("[전체보기] 버튼", has(h, 'data-act="deploy-all"') && has(h, "전체보기"));
  ok("[전체 복사] 버튼은 사라졌다", !has(h, 'data-act="copy" data-kind="all"') && !has(h, "전체 복사"));
  ok("게시 중 건수는 전체(9건)", has(h, "게시 중 (제거 예정)") && has(h, "<span class=\"count\">9건</span>"));
  ok("목록은 앞 6건만", (h.match(/class="row" data-act="open-notice"/g) || []).length === 6);

  var sheet = M.deploy();
  ok("전체보기 팝업 — 전부 9건", (sheet.match(/class="dall-row"/g) || []).length === 9);
  ok("전체보기 팝업 — 상시 게시물 포함", has(sheet, "상시 게시물") && has(sheet, "상시"));
  ok("전체보기 팝업 — 줄을 누르면 상세", has(sheet, 'data-act="open-notice"'));
  ok("전체보기 팝업 — 건수 머리", has(sheet, "게시 중 게시물 <b>9</b>건"));
}

/* ---------- 7. 이동 대기 — 배포·제거에서 확정 ---------- */
console.log("\n[7] 이동 대기 확정");
{
  API.setToday("2026-11-27");
  var st2 = {
    M1: { id: "M1", title: "이동 대기 시험", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-10", createdAt: 1,
      targets: [{ board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층"] }],
      attach: { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } } }
  };
  O.load(clone(st2), clone(FAC));
  M.setPending({
    m1: { id: "m1", at: 1795000000000, date: "2026-11-27", by: "Admin", noticeId: "M1", title: "이동 대기 시험",
      src: { board: "lobby", slot: "03", order: 1, buildings: "all", floors: ["1층"] },
      dst: { board: "lobby", slot: "05", order: 1, buildings: "all", floors: ["1층"] },
      fromText: "전체 24개동 · 공동현관 1층 03번", toText: "전체 24개동 · 공동현관 1층 05번", status: "pending" }
  });
  /* 2026-11-28 — 이동 확정·취소는 관리자 전용이므로 관리자 세션에서 확인하고, 비관리자는 막힌 문구만 */
  var SES = API.state().SESSION;
  var h2 = D.useful();
  ok("배포·제거 탭에 이동 대기 카드", has(h2, "이동 대기") && has(h2, "이동 대기 시험"));
  ok("비관리자에게는 [이동 확정] 버튼이 없다", !has(h2, 'data-act="mv-pending-apply"') && has(h2, "관리자 인증 후 가능"));
  SES.role = "admin";
  h2 = D.useful();
  ok("[이동 확정] 버튼 (관리자)", has(h2, 'data-act="mv-pending-apply"') && has(h2, "이동 확정"));
  ok("[취소] 버튼 (관리자)", has(h2, 'data-act="mv-pending-cancel"'));
  ok("이동전 → 이동후 표시", has(h2, "공동현관 1층 03번") && has(h2, "공동현관 1층 05번"));
  M.setPending({});
  ok("대기 0건이면 카드 없음", !has(D.useful(), 'data-act="mv-pending-apply"'));
  SES.role = null;
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
