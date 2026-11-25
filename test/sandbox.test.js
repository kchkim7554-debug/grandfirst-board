#!/usr/bin/env node
/* 테스트용 카피본(sandbox) 환경 검증
   - 원본 화면(app.js)은 DB_ROOT="board", SANDBOX=false 로 그대로 동작
   - 카피본은 sandbox/env.js 가 넘긴 board/sandbox · 자동 Admin · 별도 기기저장 키를 쓴다
   실행: python3 test/run_quickjs.py   또는   node test/sandbox.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var API = globalThis.__boardTest;
if (!API && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };
  global.window = global;
  eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
  API = globalThis.__boardTest;
}

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

console.log("\n[sandbox] 카피본 환경 분리");

var st = API.state();
ok("원본은 DB 경로 board", st.env.dbRoot === "board", st.env.dbRoot);
ok("원본은 SANDBOX=false", st.env.sandbox === false, String(st.env.sandbox));
ok("관리자 라벨 기본값 Admin", st.env.adminLabel === "Admin", st.env.adminLabel);
ok("기기 저장 키 기본값 gf.", st.env.lsPrefix === "gf.", st.env.lsPrefix);
var admins = (st.CFG && st.CFG.admins) ? st.CFG.admins : [];
ok("기본 관리자 명단에 개인 닉네임 없음", admins.join("|").indexOf("\uCE74\uC77C") < 0, admins.join("|"));
ok("기본 관리자 첫 이름 Admin", !admins.length || admins[0] === "Admin", admins[0]);

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
