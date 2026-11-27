#!/usr/bin/env node
/* 관리자 암호·권한 검증 — 2026-11-28 사용자 요청
   ① 관리자 암호를 4자리 PIN 에서 문자·기호가 섞인 암호로 바꿨다 (해시만 저장)
   ② C.R.U.D·관리 기능(등록·수정·기한 변경·삭제·이동 확정·설정)은 관리자 전용
   ③ 경비원은 조회와 구역별 게시·제거 체크를 그대로 쓸 수 있다
   실행: python3 test/run_quickjs.py   (board/ 폴더에서)

   ※ 암호 평문은 소스에도 테스트에도 남기지 않는다 (공개 저장소). 해시로만 확인한다. */
"use strict";
(function () {
var API = globalThis.__boardTest;
var FAC = globalThis.__BOARD_FAC || null;
var A = API.auth;
var O = API.order;
var SES = API.state().SESSION;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function has(h, s) { return String(h).indexOf(s) >= 0; }
function count(h, re) { return (String(h).match(re) || []).length; }

/* ---------- 1. 관리자 암호 (해시) ---------- */
console.log("\n[1] 관리자 암호 — 4자리 PIN → 암호");
{
  var OLD_PIN_HASH = "280e9599e805b04e6990ecd8a70563e485534485b97cbc93835be8a4bce7965f"; // 예전 7554
  ok("해시는 SHA-256 64자리 16진수", /^[0-9a-f]{64}$/.test(A.defaultHash), A.defaultHash);
  ok("예전 4자리 PIN(7554) 해시와 다르다", A.defaultHash !== OLD_PIN_HASH);
  ok("암호 해시 계산에 쓰는 salt 는 그대로", A.salt === "grandfirst-board|", A.salt);
  ok("해시 계산 함수가 있다", typeof A.hash === "function");
}

/* ---------- 2. 로그인 화면 ---------- */
console.log("\n[2] 관리자 인증 화면 — 암호 입력");
{
  var h = A.loginHtml();
  ok("암호 입력칸(비밀번호형)", has(h, 'type="password"') && has(h, 'id="pwView"'));
  ok("4자리 숫자 키패드는 없어졌다", !has(h, 'data-act="pin-key"') && !has(h, 'maxlength="4"'));
  ok("확인 버튼", has(h, 'data-act="pw-submit"') && has(h, "확인"));
  ok("안내는 '관리자 암호'", has(h, "관리자 암호") && !has(h, "PIN"));
}

/* ---------- 3. 게시물 상세 모달 — 관리 버튼 노출 ---------- */
console.log("\n[3] 게시물 상세 — 관리 기능은 관리자만");
{
  var N = {
    id: "AD1", title: "권한 시험 게시물", status: "posted", postedAt: "2026-11-20", deadline: "2026-12-01",
    targets: [{ board: "lobby", buildings: "all", floors: ["1층"], slot: "02", order: 1 }],
    attach: { front: { by: "담당", team: "A", at: 1 }, backA: { by: "담당", team: "A", at: 1 }, backB: { by: "담당", team: "A", at: 1 } },
    detach: null, archivedAt: null
  };
  O.load([N], FAC.clone ? FAC.clone() : JSON.parse(JSON.stringify(FAC)));

  SES.role = null;
  var g = API.detail("AD1");
  ok("비관리자: [기한 변경] 없음", !has(g, 'data-act="dl-open"'));
  ok("비관리자: [수정] 없음", !has(g, 'data-act="edit-notice"'));
  ok("비관리자: [제거 완료 처리] 없음", !has(g, 'data-act="force-archive"'));
  ok("비관리자: [삭제] 없음", !has(g, 'data-act="del-notice"'));
  ok("비관리자: 관리자 인증 안내·버튼", has(g, "관리자 인증") && has(g, 'data-act="admin-login"'));
  ok("비관리자도 내용·구역별 기록은 본다", has(g, "권한 시험 게시물") && has(g, "구역별 기록"));

  SES.role = "admin";
  var a = API.detail("AD1");
  ok("관리자: 네 버튼 모두 보인다", has(a, 'data-act="dl-open"') && has(a, 'data-act="edit-notice"') &&
    has(a, 'data-act="force-archive"') && has(a, 'data-act="del-notice"'));
  SES.role = null;
}

/* ---------- 4. 배포·제거 카드 — 구역 체크는 경비원 권한 ---------- */
console.log("\n[4] 배포·제거 카드 — 구역 체크는 그대로, 기한 변경은 관리자만");
{
  var N2 = {
    id: "AD2", title: "체크 시험", status: "pending_attach", postedAt: "2026-11-20", deadline: "2026-12-01",
    targets: [{ board: "lobby", buildings: "all", floors: ["1층"], slot: "04", order: 1 }],
    attach: null, detach: null, archivedAt: null
  };
  O.load([N2], JSON.parse(JSON.stringify(FAC)));

  SES.role = null;
  var card = API.deploy.card(O.load([N2], JSON.parse(JSON.stringify(FAC)))[0] || N2, "attach");
  ok("비관리자 카드: [기한 변경] 없음", !has(card, 'data-act="dl-open"'));
  ok("비관리자 카드: [상세]는 있다", has(card, 'data-act="open-notice"'));
  ok("경비원 구역 체크(A·B조)는 그대로", count(card, /data-act="chk"/g) + count(card, /data-act="chk-undo"/g) >= 3);
  ok("외부업체 체크 칸도 그대로", has(card, 'data-act="chk-ext"'));

  SES.role = "admin";
  var card2 = API.deploy.card(O.load([N2], JSON.parse(JSON.stringify(FAC)))[0] || N2, "attach");
  ok("관리자 카드: [기한 변경] 있다", has(card2, 'data-act="dl-open"'));
  SES.role = null;
}

/* ---------- 5. 저장 직전 차단(adminOnly) ---------- */
console.log("\n[5] 저장 직전 차단 — 비관리자는 실행되지 않는다");
{
  SES.role = null;
  ok("비관리자 adminOnly = false", A.adminOnly("게시물 등록") === false);
  ok("isAdmin() = false", A.isAdmin() === false);
  SES.role = "admin";
  ok("관리자 adminOnly = true", A.adminOnly("게시물 등록") === true);
  ok("isAdmin() = true", A.isAdmin() === true);
  SES.role = null;
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
