#!/usr/bin/env node
/* 게시물 생성 — 사진 제목 1차 OCR 검증 (Tesseract.js 결과를 제목 후보로 다듬는 순수 로직).
   실제 OCR(네트워크·wasm)은 돌리지 않고, OCR이 준 줄 구조를 넣어 결과만 본다.
   실행: python3 test/run_quickjs.py   또는   node test/ocr.test.js  (board/ 폴더에서) */
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
var X = API.ocr;
var C = API.create;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function has(h, s) { return String(h).indexOf(s) >= 0; }
function L(text, h, top, c) { return { text: text, height: h, top: top, confidence: c == null ? 90 : c }; }

/* 실제 안내문 사진(r01 승강기 정기 점검)에서 흔히 나오는 줄 구조 */
var PAGE_H = 1600;

/* ---------- 1. 「제 목 :」 라벨이 있는 안내문 ---------- */
console.log("\n[1] 「제 목 :」 라벨 우선");
{
  var cand = X.title({
    height: PAGE_H,
    lines: [
      L("안 내 문", 42, 210),
      L("제 목 : 승강기 정기 점검", 34, 310),
      L("승강기 정기 점검을 아래와 같이 진행할 예정이며", 20, 450),
      L("운영 제일풍경채 그랑퍼스트 APT 관리사무소", 24, 1450)
    ]
  });
  eq("라벨 뒤 제목만 뽑는다", cand, "승강기 정기 점검");
}
{
  var cand2 = X.title({
    height: PAGE_H,
    lines: [L("제 목", 36, 300), L("소방 안전 자체점검 안내", 30, 360), L("본문 ...", 18, 450)]
  });
  eq("라벨만 있고 다음 줄이 제목이면 다음 줄", cand2, "소방 안전 자체점검 안내");
}

/* ---------- 2. 라벨이 없으면 가장 큰 글씨(상단) ---------- */
console.log("\n[2] 라벨 없음 — 큰 글씨 제목");
{
  var cand = X.title({
    height: PAGE_H,
    lines: [
      L("안 내 문", 40, 180),
      L("입대의 정기회의 공고", 28, 380),
      L("2026. 11. 20.(금) 19:00", 16, 520),
      L("관리사무소", 22, 1480)
    ]
  });
  eq("큰 제목 줄을 고른다(안내문·날짜·하단 제외)", cand, "입대의 정기회의 공고");
}
{
  var cand = X.title({
    height: PAGE_H,
    lines: [L("2026.11.06", 30, 90), L("주차 질서 안내", 22, 300)]
  });
  eq("날짜만 있는 줄은 제목이 아니다", cand, "주차 질서 안내");
}

/* ---------- 3. 두 줄 제목 ---------- */
console.log("\n[3] 두 줄 제목");
{
  var cand = X.title({
    height: PAGE_H,
    lines: [L("겨울철 수도관", 30, 200), L("동파 예방 안내", 30, 245), L("본문 내용", 17, 400)]
  });
  eq("같은 크기로 이어진 두 줄을 붙인다", cand, "겨울철 수도관 동파 예방 안내");
}

/* ---------- 4. 읽을 것이 없거나 실패한 경우 ---------- */
console.log("\n[4] 후보 없음");
{
  eq("줄이 없으면 빈 문자열", X.title({ lines: [] }), "");
  eq("안내문 글자뿐이면 빈 문자열", X.title({ height: PAGE_H, lines: [L("안 내 문", 40, 100), L("공 고", 38, 180)] }), "");
  eq("payload 없음", X.title(null), "");
  eq("숫자만", X.title({ lines: [L("26.11.16", 20, 100), L("10:00", 20, 130)] }), "");
}

/* ---------- 5. 텍스트만 있을 때(줄 구조 없음) ---------- */
console.log("\n[5] 텍스트 폴백");
{
  var cand = X.title({ text: "안 내 문\n제 목 : 소방 안전 점검\n아래와 같이 실시합니다.\n관리사무소" });
  eq("줄 구조가 없어도 텍스트에서 라벨을 찾는다", cand, "소방 안전 점검");
}

/* ---------- 6. 길이·정리 ---------- */
console.log("\n[6] 길이·정리");
{
  var long = "가".repeat(120);
  var cand = X.title({ lines: [L(long, 30, 100)] });
  ok("60자 넘지 않게 자른다", cand.length <= 60, "길이 " + cand.length);
  eq("앞뒤 기호·공백 정리", X.title({ lines: [L("  ::: 승강기 점검 ㅡ ", 30, 100)] }), "승강기 점검");
}

/* ---------- 7. 이미 적어 둔 제목은 덮지 않는다 ---------- */
console.log("\n[7] 제목칸 반영 판단");
{
  var a = X.decision("", "승강기 정기 점검");
  eq("빈 칸이면 채운다", a, { fill: true, state: "done" });
  var b = X.decision("내가 쓴 제목", "승강기 정기 점검");
  eq("이미 쓴 제목이 있으면 그대로 둔다", b, { fill: false, state: "done" });
  var c = X.decision("내가 쓴 제목", "");
  eq("후보가 없으면 빈 상태", c, { fill: false, state: "empty" });
}

/* ---------- 8. Tesseract 결과 → 줄 목록 ---------- */
console.log("\n[8] OCR 결과 변환");
{
  var lines = X.lines({
    blocks: [{
      bbox: { x0: 0, y0: 0, x1: 900, y1: 1200 },
      paragraphs: [{
        lines: [
          { text: "  승강기  점검 ", confidence: 88, bbox: { x0: 10, y0: 100, x1: 600, y1: 140 } },
          { text: "   ", confidence: 90, bbox: { x0: 0, y0: 150, x1: 10, y1: 160 } }
        ]
      }]
    }]
  });
  eq("빈 줄은 버리고 높이·위치를 남긴다", lines, [{ text: "승강기 점검", height: 40, top: 100, confidence: 88 }]);
}

/* ---------- 9. 생성 화면 안내 문구 ---------- */
console.log("\n[9] 생성 화면 안내");
{
  C.reset();
  C.ensure();
  var st = C.state();
  eq("처음에는 OCR 대기", st.ocrState, "idle");
  var idle = C.form();
  ok("사진이 없을 때는 안내를 숨긴다", has(idle, 'id="nfNote"') && has(idle, "display:none"));

  st.ocrState = "done"; st.ocrTitle = "승강기 정기 점검"; st.ocrApplied = true; st.title = "승강기 정기 점검";
  var done = X.note();
  ok("자동으로 채웠으면 「맞으면 그대로 저장, 틀리면 고친 뒤 저장」 안내", has(done, "맞으면 그대로 저장") && has(done, "승강기 정기 점검"));
  ok("채운 뒤에는 「이 제목 넣기」가 없다", !has(done, "nf-ocr-use") && has(done, "nf-ocr-retry"));

  st.ocrApplied = false; st.title = "내가 쓴 제목";
  var kept = X.note();
  ok("직접 쓴 제목이 있으면 「이 제목 넣기」 버튼을 준다", has(kept, "nf-ocr-use") && has(kept, "이미 적어 둔 제목"));

  st.ocrState = "reading"; st.ocrPct = 42;
  ok("읽는 중 표시", has(X.note(), "사진에서 제목 읽는 중"));

  st.ocrState = "fail";
  var bad = X.note();
  ok("실패해도 직접 입력으로 안내(에러로 막지 않음)", has(bad, "직접 입력") && has(bad, "nf-ocr-retry"));

  st.ocrState = "empty";
  ok("못 찾았을 때도 직접 입력으로 안내", has(X.note(), "찾지 못했습니다"));
}

/* ---------- 10. 사진을 지우면 OCR 상태도 초기화 ---------- */
console.log("\n[10] 사진 지우기");
{
  C.reset();
  C.ensure();
  var st = C.state();
  st.photo = "data:image/jpeg;base64,AAAA";
  st.ocrState = "done"; st.ocrTitle = "옛 제목"; st.ocrApplied = true;
  C.reset();
  var st2 = C.state();
  eq("새 작성 상태는 OCR 대기", [st2.ocrState, st2.ocrTitle, st2.ocrApplied], ["idle", "", false]);
}

/* ---------- 11. 저장 버튼은 OCR과 무관하게 그대로 동작 ---------- */
console.log("\n[11] OCR 실패와 저장");
{
  C.reset();
  C.ensure();
  C.state().ocrState = "fail";
  var h = C.form();
  ok("실패 상태에서도 제목칸·저장 버튼은 그대로", has(h, 'id="nfTitle"') && has(h, 'data-act="nf-save"'));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
