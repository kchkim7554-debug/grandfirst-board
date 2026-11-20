#!/usr/bin/env node
/* 겹침 순번(order) 자동 밀림 검증 — 실 DB에 쓰지 않고 순수 로직만 돌린다.
   실행: python3 test/run_quickjs.py   또는   node test/order.test.js  (board/ 폴더에서) */
"use strict";
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
var O = globalThis.__boardTest.order;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }

/* 경로 문자열(Firebase update 키)을 로컬 사본에 적용 */
function applyUpdate(store, updates) {
  Object.keys(updates).forEach((p) => {
    const parts = p.split("/");                 // board / notices / {id} / targets / {i} / order
    if (parts[0] !== "board" || parts[1] !== "notices") throw new Error("unexpected path " + p);
    const id = parts[2];
    const val = updates[p];
    if (parts.length === 3) {
      if (val === null) delete store[id];
      else store[id] = JSON.parse(JSON.stringify(val));
      return;
    }
    const node = store[id];
    if (!node) throw new Error("missing notice " + id + " for " + p);
    if (parts[3] === "targets") node.targets[Number(parts[4])].order = val;
    else node[parts[3]] = val;
  });
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function tgt(board, slot, floors, elevators, buildings) {
  const t = { board, slot, buildings: buildings || "all" };
  if (board === "lobby") t.floors = floors || FAC.boards.lobby.floors;
  else t.elevators = elevators || "all";
  return t;
}
function orders(store) {
  const out = {};
  Object.keys(store).sort().forEach((id) => {
    if (store[id].status === "archived" || store[id].archivedAt) return;
    out[id] = store[id].targets.map((t) => (t.board || "lobby") + t.slot + ":" + t.order).join(",");
  });
  return out;
}
function loadLive() {
  const st = clone(LIVE);
  O.load(clone(LIVE), FAC);
  return st;
}

/* ---------- 1. 같은 자리 판정 ---------- */
console.log("\n[1] 같은 자리(겹침) 판정");
{
  const live = loadLive();
  const r01 = live.R01.targets[0];      // lobby 03 전체층
  const r04 = live.R04.targets[0];      // lobby 05 1층
  const r07 = live.R07.targets[0];      // lobby 05 지하1·2층
  ok("같은 게시판·번호·층이 겹치면 겹침", O.overlaps(r01, tgt("lobby", "03")));
  ok("층이 하나도 안 겹치면 다른 자리(5번 1층 vs 지하)", !O.overlaps(r04, r07));
  ok("번호가 다르면 다른 자리", !O.overlaps(tgt("lobby", "03", ["1층"]), tgt("lobby", "04", ["1층"])));
  ok("게시판 종류가 다르면 다른 자리", !O.overlaps(tgt("lobby", "03"), tgt("elevator", "03")));
  ok("엘리베이터 같은 번호면 겹침", O.overlaps(tgt("elevator", "05"), live.R14.targets[0]));
  ok("엘리베이터 번호가 다르면 다른 자리", !O.overlaps(tgt("elevator", "05"), live.R17.targets[0]));
  ok("겹치는 층이 하나라도 있으면 겹침(전체층 vs 1층)", O.overlaps(r01, tgt("lobby", "03", ["1층"])));
  ok("동이 겹치지 않으면 밀지 않음", !O.overlaps(tgt("lobby", "03", null, null, [101]), tgt("lobby", "03", null, null, [102])));
  ok("동이 하나라도 겹치면 밀림", O.overlaps(tgt("lobby", "03", null, null, [101, 102]), tgt("lobby", "03", null, null, [102, 103])));
  ok("호기 지정이 겹치면 겹침(1호기 vs 1·2호기)", O.overlaps(tgt("elevator", "05", null, ["1"]), tgt("elevator", "05", null, "all")));
  ok("호기가 다르면 다른 자리(1호기 vs 2호기)", !O.overlaps(tgt("elevator", "05", null, ["1"]), tgt("elevator", "05", null, ["2"])));
}

/* ---------- 2. 신규 등록 시 기존 게시물이 뒤로 밀린다 ---------- */
console.log("\n[2] 신규 등록 → 기존 게시물 한 칸씩 뒤로");
{
  const live = loadLive();
  // 3번: R01(1번째), R08(2번째) 이 붙어 있다
  const nt = tgt("lobby", "03");
  const r = O.push([nt], "NEW01");
  eq("밀린 게시물 수", r.pushed.map((p) => p.id + ":" + p.from + ">" + p.to).sort(), ["R01:1>2", "R08:2>3"]);
  eq("update 경로 2개", Object.keys(r.updates).sort(), [
    "board/notices/R01/targets/0/order", "board/notices/R08/targets/0/order"
  ]);
  const after = clone(live);
  applyUpdate(after, r.updates);
  after.NEW01 = { id: "NEW01", status: "pending_attach", targets: [Object.assign({}, nt, { order: 1 })], createdAt: 9 };
  eq("3번 순서(신규가 맨 앞)", [after.NEW01.targets[0].order, after.R01.targets[0].order, after.R08.targets[0].order], [1, 2, 3]);
  eq("다른 번호는 그대로", [after.R13.targets[0].order, after.R02.targets[0].order, after.R11.targets[0].order], [1, 2, 2]);
  eq("층이 다른 5번은 그대로", [after.R04.targets[0].order, after.R07.targets[0].order], [1, 1]);

  // 한 번 더 들어오면 셋째까지 밀린다 (카일 님 표현: "또 신규가 들어오면 세번째")
  O.load(clone(after), FAC);
  const r2 = O.push([tgt("lobby", "03")], "NEW02");
  eq("두 번째 신규 → 기존 3건이 밀림", r2.pushed.length, 3);
  const after2 = clone(after);
  applyUpdate(after2, r2.updates);
  eq("3번 최종 순서", [after2.R01.targets[0].order, after2.R08.targets[0].order, after2.NEW01.targets[0].order], [3, 4, 2]);
}

/* ---------- 3. 아카이브(제거)되면 남은 순번이 1,2,3… 으로 이어진다 ---------- */
console.log("\n[3] 제거 완료 → 남은 게시물 순번 이어 붙이기");
{
  const live = loadLive();
  ok("3번 제거 전 순서", live.R01.targets[0].order === 1 && live.R08.targets[0].order === 2);
  const c = O.compact(live.R01.targets, ["R01"]);
  eq("R08 이 1번째로 당겨짐", c.changed.map((x) => x.id + ":" + x.from + ">" + x.to), ["R08:2>1"]);
  const after = clone(live);
  after.R01.status = "archived"; after.R01.archivedAt = "2026-11-18";
  applyUpdate(after, c.updates);
  eq("3번 남은 순서", after.R08.targets[0].order, 1);

  // 3장 겹침 상태에서 가운데가 빠지면 뒤엣것이 당겨진다
  const st = {
    A: { id: "A", title: "A", createdAt: 1, status: "posted", targets: [Object.assign(tgt("lobby", "02"), { order: 1 })] },
    B: { id: "B", title: "B", createdAt: 2, status: "posted", targets: [Object.assign(tgt("lobby", "02"), { order: 2 })] },
    C: { id: "C", title: "C", createdAt: 3, status: "posted", targets: [Object.assign(tgt("lobby", "02"), { order: 3 })] }
  };
  O.load(clone(st), FAC);
  const c2 = O.compact(st.B.targets, ["B"]);
  eq("가운데 제거 → C 가 2번째로", c2.changed.map((x) => x.id + ":" + x.to), ["C:2"]);
}

/* ---------- 4. 삭제도 같은 방식으로 메운다 ---------- */
console.log("\n[4] 삭제 시 순번 메우기");
{
  const st = {
    A: { id: "A", title: "A", createdAt: 1, status: "posted", targets: [Object.assign(tgt("elevator", "01"), { order: 1 })] },
    B: { id: "B", title: "B", createdAt: 2, status: "posted", targets: [Object.assign(tgt("elevator", "01"), { order: 2 })] },
    D: { id: "D", title: "D", createdAt: 3, status: "posted", targets: [Object.assign(tgt("elevator", "01"), { order: 3 })] }
  };
  O.load(clone(st), FAC);
  const c = O.compact(st.A.targets, ["A"]);
  eq("A 삭제 → B=1, D=2", c.changed.map((x) => x.id + ":" + x.from + ">" + x.to), ["B:2>1", "D:3>2"]);
}

/* ---------- 5. 이미 1,2,3 이면 아무것도 쓰지 않는다 ---------- */
console.log("\n[5] 이미 정리된 자리는 건드리지 않음");
{
  loadLive();
  const c = O.compact([tgt("lobby", "09")], []);   // R13(1), R02(2)
  eq("변경 없음", Object.keys(c.updates).length, 0);
}

/* ---------- 6. 아카이브된 게시물은 밀지 않는다 ---------- */
console.log("\n[6] 보관함 게시물은 대상에서 제외");
{
  const st = clone(LIVE);
  st.R08.status = "archived"; st.R08.archivedAt = "2026-11-17";
  O.load(clone(st), FAC);
  const r = O.push([tgt("lobby", "03")], "NEW01");
  eq("3번에서 살아있는 R01 만 밀림", r.pushed.map((p) => p.id), ["R01"]);
}

/* ---------- 7. 엘리베이터 자리 ---------- */
console.log("\n[7] 엘리베이터 게시판");
{
  const live = loadLive();
  const r = O.push([tgt("elevator", "05")], "NEW03");
  eq("5번(방문차량 R14)만 밀림", r.pushed.map((p) => p.id + ":" + p.to), ["R14:2"]);
  const r2 = O.push([tgt("elevator", "02")], "NEW04");
  eq("2번(동파 R17)만 밀림", r2.pushed.map((p) => p.id + ":" + p.to), ["R17:2"]);
}

/* ---------- 7b. 저장할 update 맵 ---------- */
console.log("\n[7b] 저장 update 맵 (신규 = 게시물 + 밀림, 수정 = 게시물만)");
{
  const live = loadLive();
  const target = tgt("lobby", "03");
  target.order = 1;
  const payload = { id: "NEW9", title: "새 게시물", status: "pending_attach", targets: [target] };
  const b = O.build("NEW9", payload, target, null);
  eq("신규 저장 경로", Object.keys(b.updates).sort(), [
    "board/notices/NEW9", "board/notices/R01/targets/0/order", "board/notices/R08/targets/0/order"
  ]);
  eq("신규 본문은 1번째", b.updates["board/notices/NEW9"].targets[0].order, 1);
  eq("밀린 건수", b.pushed.length, 2);
  const e = O.build("R01", { title: "x", targets: [live.R01.targets[0]] }, live.R01.targets[0], live.R01);
  eq("수정은 게시물 하나만 저장", Object.keys(e.updates), ["board/notices/R01"]);
  eq("수정은 밀지 않음", e.pushed.length, 0);
}

/* ---------- 8. 실제 데이터가 규칙과 맞는지 ---------- */
console.log("\n[8] 현재 데이터 정합성(같은 자리 안에서 1..n 이 중복·누락 없이)");
{
  const live = loadLive();
  const groups = [];
  Object.keys(live).forEach((id) => {
    if (live[id].status === "archived") return;
    live[id].targets.forEach((t) => {
      const g = groups.find((x) => O.overlaps(x.t, t));
      if (g) g.items.push({ id, order: t.order });
      else groups.push({ t, items: [{ id, order: t.order }] });
    });
  });
  const bad = groups.filter((g) => {
    const os = g.items.map((i) => i.order).sort((a, b) => a - b);
    return os.some((v, i) => v !== i + 1);
  });
  ok("모든 자리가 1..n 연속", bad.length === 0,
    bad.map((g) => g.t.board + g.t.slot + " " + JSON.stringify(g.items)).join(" | "));
  console.log("    겹침 그룹: " + groups.filter((g) => g.items.length > 1)
    .map((g) => g.t.board + g.t.slot + "[" + g.items.map((i) => i.id + "=" + i.order).join(",") + "]").join(" "));
}

/* ---------- 9. 이동(게시판 위치·번호·순번 변경) ---------- */
console.log("\n[9] 이동 — 같은 자리 재배열 / 다른 자리로 옮기기");
{
  const live = loadLive();
  const r01 = live.R01;

  // (a) 같은 자리(lobby 03) 안에서 1번째 → 2번째
  const t2 = tgt("lobby", "03");
  t2.order = 2;
  const a = O.move("R01", r01, r01.targets, t2);
  ok("같은 자리 순번 변경: 변경 있음", a.changed);
  eq("R01 은 2번째로 저장", a.updates["board/notices/R01/targets"][0].order, 2);
  eq("R08 이 1번째로 올라옴", a.updates["board/notices/R08/targets/0/order"], 1);

  // (b) 같은 자리·같은 순번 → 저장 안 함
  const t1 = tgt("lobby", "03");
  t1.order = 1;
  const b = O.move("R01", r01, r01.targets, t1);
  ok("위치·순번이 그대로면 변경 없음", !b.changed && Object.keys(b.updates).length === 0);

  // (c) 빈 자리(lobby 02)로 이동 → 원래 자리(lobby 03)는 1..n 으로 압축
  const t3 = tgt("lobby", "02");
  t3.order = 1;
  const c = O.move("R01", r01, r01.targets, t3);
  eq("R01 은 02번 1번째", [c.updates["board/notices/R01/targets"][0].slot, c.updates["board/notices/R01/targets"][0].order], ["02", 1]);
  eq("원래 자리 R08 은 1번째로 압축", c.updates["board/notices/R08/targets/0/order"], 1);
  ok("새 자리가 빈 곳이면 순번만 넣음", Object.keys(c.updates).sort().join(","),
    "board/notices/R01/targets,board/notices/R01/updatedAt,board/notices/R08/targets/0/order");

  // (d) 이미 2장이 겹침 자리(lobby 09: R13=1, R02=2)로 1번째에 넣기 → 기존은 +1
  const t4 = tgt("lobby", "09");
  t4.order = 1;
  const d = O.move("R01", r01, r01.targets, t4);
  eq("R13 은 2번째로 밀림", d.updates["board/notices/R13/targets/0/order"], 2);
  eq("R02 는 3번째로 밀림", d.updates["board/notices/R02/targets/0/order"], 3);
  eq("R01 은 09번 1번째", d.updates["board/notices/R01/targets"][0].order, 1);

  // (e) 다른 구역으로 옮기면 그 구역은 게시 체크가 필요하다
  const t5 = { board: "lobby", slot: "02", order: 1, buildings: [101] };
  const e = O.move("R01", r01, r01.targets, t5);
  ok("동을 좁힌 이동도 저장", e.changed && e.updates["board/notices/R01/targets"][0].buildings.length === 1);
  ok("같은 자리 판정: 순번이 다르면 다른 자리", !O.same(tgt("lobby", "03"), Object.assign(tgt("lobby", "03"), { order: 2 })));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = fail;
