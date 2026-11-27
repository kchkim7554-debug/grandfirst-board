#!/usr/bin/env node
/* 앱 설치 · 버전/업데이트 알림 검증 — pwa.js 의 순수 함수와 껍데기 문자열.
   실 브라우저 없이 QuickJS 로 돈다.
   실행: python3 test/run_quickjs.py   또는   node test/pwa.test.js  (board/ 폴더에서) */
"use strict";
(function () {
var P = globalThis.__pwaTest;
if (!P && typeof require === "function") {
  var fs = require("fs"), path = require("path");
  var ROOT = path.join(__dirname, "..");
  global.document = { getElementById: function () { return null; } };
  require(path.join(ROOT, "pwa.js"));
  P = globalThis.__pwaTest;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function has(s, sub) { return String(s).indexOf(sub) >= 0; }

console.log("\n[1] 버전 표기");
{
  eq("20261128k → v2026.11.28k", P.versionLabel("20261128k"), "v2026.11.28k");
  eq("20261128j → v2026.11.28j", P.versionLabel("20261128j"), "v2026.11.28j");
  eq("숫자만(20261128) → v2026.11.28", P.versionLabel("20261128"), "v2026.11.28");
  eq("빈 값 → 빈 문자열", P.versionLabel(""), "");
  eq("알 수 없는 형식은 v 붙여 그대로", P.versionLabel("beta-1"), "vbeta-1");
}

console.log("\n[2] 새 버전 판정");
{
  ok("다른 버전이면 새 버전", P.isDifferent("20261128k", "20261128j") === true);
  ok("같으면 새 버전 아님", P.isDifferent("20261128k", "20261128k") === false);
  ok("서버 값이 없으면 새 버전 아님(오프라인 오탐 방지)", P.isDifferent("", "20261128k") === false);
  ok("공백은 무시", P.isDifferent(" 20261128k ", "20261128k") === false);
}

console.log("\n[3] 설치 환경 판별");
{
  eq("카톡 인앱브라우저", P.platformOf("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 KAKAOTALK 10.4.5"), "inapp");
  eq("네이버 인앱", P.platformOf("Mozilla/5.0 (Linux; Android 13) NAVER(13.3.1)"), "inapp");
  eq("아이폰 사파리", P.platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) Version/17.1 Mobile/15E148 Safari/604.1"), "ios");
  eq("안드로이드 크롬", P.platformOf("Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"), "android");
  eq("데스크톱", P.platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"), "other");

  eq("설치 창 가능 = ready", P.installMode({ standalone: false, canPrompt: true }), "ready");
  eq("이미 앱 실행 중 = installed", P.installMode({ standalone: true, canPrompt: true }), "installed");
  eq("설치 창 없음 = guide", P.installMode({ standalone: false, canPrompt: false }), "guide");

  ok("아이폰 안내는 홈 화면에 추가", has(P.installGuide("ios", false), "홈 화면에 추가") && has(P.installGuide("ios", false), "Safari"));
  ok("카톡 안내는 브라우저로 열기", has(P.installGuide("inapp", false), "다른 브라우저로 열기"));
  ok("안드로이드 안내는 크롬 메뉴", has(P.installGuide("android", false), "앱 설치"));
  ok("앱 실행 중 안내", has(P.installGuide("android", true), "앱으로 실행 중"));
  ok("안내는 한 줄(줄바꿈 없음)", [P.installGuide("ios", false), P.installGuide("inapp", false), P.installGuide("android", false)]
    .every(function (t) { return t.indexOf("\n") < 0; }));
}

console.log("\n[4] 배너 문구");
{
  var up = P.bannerHTML("update", { version: "20261128k" });
  ok("새 버전 배너 제목", has(up, "🆕 새 버전이 준비됐습니다"));
  ok("[지금 업데이트] 버튼", has(up, "지금 업데이트") && has(up, 'data-pwa="update"'));
  ok("새 버전 번호 표시", has(up, "v2026.11.28k"));
  ok("닫기 버튼", has(up, 'data-pwa="dismiss"'));

  var ins = P.bannerHTML("install", {});
  ok("[📲 앱 설치] 버튼", has(ins, "📲 앱 설치") && has(ins, 'data-pwa="install"'));
  ok("설치 배너 설명", has(ins, "주소창 없이"));

  eq("모드가 없으면 배너 없음", P.bannerHTML("", {}), "");
}

console.log("\n[5] 설정 시트 — 현재 버전 · 설치 · 업데이트");
{
  var s = P.settingsHTML({ version: "20261128k", platform: "android", canPrompt: true });
  ok("현재 버전 표시", has(s, "현재 <b>v2026.11.28k</b>"));
  ok("최신 표시", has(s, 'class="ok">최신'));
  ok("설치 버튼", has(s, 'data-pwa="install"'));
  ok("업데이트 확인 버튼", has(s, 'data-pwa="check"'));

  var s2 = P.settingsHTML({ version: "20261128k", serverVersion: "20261128m", update: true, platform: "android", canPrompt: true });
  ok("새 버전이 있으면 배지", has(s2, 'class="new">새 버전 v2026.11.28m'));
  ok("배지가 '최신'으로 남지 않는다", !has(s2, 'class="ok">최신'));

  var s3 = P.settingsHTML({ version: "20261128k", standalone: true, platform: "android" });
  ok("앱으로 실행 중이면 설치 버튼 대신 안내", has(s3, "앱으로 실행 중") && !has(s3, 'data-pwa="install"'));

  var s4 = P.settingsHTML({ version: "20261128k", platform: "ios", canPrompt: false });
  ok("설치 창이 없으면 한 줄 설치 안내", has(s4, "pwaset-guide") && has(s4, "홈 화면에 추가"));

  var s5 = P.settingsHTML({ version: "20261128k", platform: "other", canPrompt: true, sandbox: true });
  ok("카피본에서는 앱 설치 줄 없음", !has(s5, 'data-pwa="install"') && !has(s5, "pwaset-guide"));
  ok("카피본에서도 버전·업데이트 확인은 보인다", has(s5, "v2026.11.28k") && has(s5, 'data-pwa="check"'));

  var s6 = P.settingsHTML({ version: "20261128k", platform: "android", msg: "최신 버전입니다 (v2026.11.28k)." });
  ok("확인 결과 메시지", has(s6, 'id="pwaSetMsg"') && has(s6, "최신 버전입니다"));
  ok("개인 이름이 들어가지 않는다", s.indexOf("카일") < 0 && s6.indexOf("카일") < 0);
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
