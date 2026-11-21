#!/usr/bin/env node
/* 게시물 제거 대상 일일 알림([알림] · [선택조회]) 검증 — 실 DB에 쓰지 않고 순수 로직만 돌린다.
   실행: python3 test/run_quickjs.py   또는   node test/alerts.test.js  (board/ 폴더에서)
   픽스처는 2026-11-19 ~ 11-21 실 DB(board/daily_alerts) 응답 모양 그대로다. */
"use strict";
(function () {
var A = globalThis.__boardTest && globalThis.__boardTest.alerts;
if (!A && typeof require === "function") {
  var path = require("path");
  global.document = { getElementById: function () { return null; } };   // start() 자동 실행 방지
  require(path.join(__dirname, "..", "app.js"));
  A = globalThis.__boardTest.alerts;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "기대 " + JSON.stringify(b) + " / 실제 " + JSON.stringify(a)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function has(h, s) { return h.indexOf(s) >= 0; }

/* ---------- 실 DB 모양 픽스처 ---------- */
var FIX = {
  "2026-11-19": {
    createdAt: "2026-11-19T07:00:00+09:00", date: "2026-11-19", hasTargets: false, shift: "A조",
    source: "07:00 게시판 제거 알림", summary: "오늘 제거 대상 게시물이 없습니다.", weekday: "목"
  },
  "2026-11-20": {
    createdAt: "2026-11-20T07:00:00+09:00", date: "2026-11-20", hasTargets: true, shift: "B조",
    source: "07:00 게시판 제거 알림", weekday: "금", summary: "오늘(11/20 금) B조 제거 대상 2건",
    items: [
      {
        cardImage: "templates/cards/2026-11-20_R01.jpg", id: "R01", noticeId: "R01",
        location: "전층(1층·지하1층·지하2층) 공동현관 03번 첫 번째",
        memo: "승강기 정기 점검 안내문 · 게시 11.06~11.20",
        message: "전층(1층·지하1층·지하2층) 공동현관 03번 첫 번째 게시물 [승강기 정기 점검] 오늘 제거 바랍니다.",
        title: "승강기 정기 점검"
      },
      {
        cardImage: "templates/cards/2026-11-20_R15.jpg", id: "R15", noticeId: "R15",
        location: "1층 공동현관 12번 첫 번째",
        memo: "입주민 의견서 마감 18시 참고",
        message: "1층 공동현관 12번 첫 번째 게시물 [기존사업자 사업수행실적 평가표(안)] 오늘 제거 바랍니다.",
        title: "기존사업자 사수행실적 평가표(안)"
      }
    ]
  },
  "2026-11-21": {
    createdAt: "2026-11-21T07:01:00+09:00", date: "2026-11-21", hasTargets: false, shift: "A조",
    source: "07:00 게시판 제거 알림", summary: "오늘 제거 대상 게시물이 없습니다.", weekday: "토"
  }
};

function reset(ui) {
  A.set(clone(FIX));
  A.setUi({ tab: "list", sort: "desc", from: "", to: "", shift: "all", open: "" });
  A.setUi(ui || {});
  return A.rows();
}

/* ---------- 1. 표 정렬 (최신순 / 역순) ---------- */
console.log("\n[1] [알림] 표 — 최신순·역순 정렬");
{
  var rows = reset();
  eq("기본은 최신순", rows.map(function (a) { return a.date; }), ["2026-11-21", "2026-11-20", "2026-11-19"]);
  rows = reset({ sort: "asc" });
  eq("역순(오래된순)", rows.map(function (a) { return a.date; }), ["2026-11-19", "2026-11-20", "2026-11-21"]);
}

/* ---------- 2. 표 머리·행 내용 ---------- */
console.log("\n[2] 표 — 년월일 | 내용 | 제거건수 | 담당");
{
  reset();
  var h = A.table(A.rows());
  ok("표 머리 4칸", has(h, "<th>년월일</th>") && has(h, "<th>내용</th>") &&
    has(h, 'class="ac">제거건수') && has(h, 'class="ac">담당'));
  ok("행마다 누를 수 있는 data-act=alert-open", (h.match(/data-act="alert-open"/g) || []).length === 3);
  ok("년월일은 점 표기 + 요일", has(h, "2026.11.20") && has(h, "(금)"));
  ok("제거건수 2건", has(h, ">2건<"));
  ok("제거 없는 날은 -", has(h, 'class="ac z">-<'));
  ok("담당 B조·A조", has(h, ">B조<") && has(h, ">A조<"));
  ok("내용은 게시물 이름", has(h, "승강기 정기 점검") && has(h, "기존사업자"));
  var three = clone(FIX);
  three["2026-11-20"].items.push({ title: "세 번째 게시물", message: "m", cardImage: "templates/cards/x.jpg" });
  A.set(three); A.setUi({ sort: "desc", from: "", to: "", shift: "all", open: "" });
  ok("3건이면 두 건 + 외 1건", has(A.table(A.rows()), "외 1건"));
  ok("내용 없는 날은 기록 문구", has(h, "제거 대상 게시물이 없습니다"));
  ok("용어는 게시/제거 (부착/탈착 없음)", !has(h, "부착") && !has(h, "탈착"));
}

/* ---------- 3. 행을 누르면 상세 (카드 이미지 · 안내 문구 · 내려받기) ---------- */
console.log("\n[3] 상세 — 카드 이미지 · 안내 문구 · 저장");
{
  reset({ open: "2026-11-20" });
  var body = A.body();
  ok("상세 패널 열림", has(body, 'id="alertDetail"'));
  ok("상세 날짜·담당", has(body, "2026년 11월 20일") && has(body, "B조"));
  ok("카드 이미지 2장", (body.match(/class="acard"/g) || []).length === 2 &&
    has(body, "templates/cards/2026-11-20_R01.jpg") && has(body, "templates/cards/2026-11-20_R15.jpg"));
  ok("안내 문구 표시", has(body, "[승강기 정기 점검] 오늘 제거 바랍니다."));
  ok("안내 문구 복사 버튼", has(body, 'data-act="alert-copy"'));
  ok("카드 저장(내려받기) 링크", has(body, 'download="2026-11-20_R01.jpg"'));
  ok("확대 보기(zoom)", has(body, 'data-act="zoom"'));

  reset({ open: "2026-11-19" });
  var none = A.body();
  ok("제거 없는 날 상세", has(none, "제거 대상 게시물이 없었습니다") && !has(none, 'class="acard"'));
  eq("없는 날짜 상세는 빈 문자열", A.detail("2026-12-25"), "");
}

/* ---------- 4. [선택조회] — 기간(년월) + 담당 + 조회 ---------- */
console.log("\n[4] [선택조회] — 기간·담당 필터");
{
  var rows = reset({ tab: "query" });
  var q = A.screen();
  ok("조회 탭: from ~ to 년월 입력 2개", (q.match(/type="month"/g) || []).length === 2);
  ok("조회 탭: 담당 전체/A조/B조", has(q, ">전체<") && has(q, ">A조<") && has(q, ">B조<"));
  ok("조회 탭: [조회] 버튼", has(q, 'data-act="alert-query"') && has(q, ">조회<"));
  eq("기본 기간은 기록 전체", A.ui().from + "~" + A.ui().to, "2026-11~2026-11");

  reset({ tab: "query", shift: "B" });
  eq("담당 B조만", A.rows().map(function (a) { return a.date; }), ["2026-11-20"]);
  reset({ tab: "query", shift: "A" });
  eq("담당 A조만", A.rows().map(function (a) { return a.date; }), ["2026-11-21", "2026-11-19"]);

  reset({ tab: "query", from: "2026-11", to: "2026-11" });
  eq("2026-11 기간", A.rows().length, 3);
  reset({ tab: "query", from: "2026-12", to: "2026-12" });
  eq("기록 없는 기간", A.rows().length, 0);
  ok("결과 없음 안내", has(A.table(A.rows()), "조건에 맞는 알림이 없습니다"));

  reset({ tab: "query" });
  eq("요약 문구 (일수·건수)", A.body().match(/([0-9]+일<\/b> · <b>[0-9]+건)/) ? true : false, true);
}

/* ---------- 5. Firebase 응답 모양 호환 ---------- */
console.log("\n[5] Firebase 응답 모양 호환");
{
  var asObj = clone(FIX);
  asObj["2026-11-20"].items = { 0: asObj["2026-11-20"].items[0], 1: asObj["2026-11-20"].items[1] };
  A.set(asObj);
  A.setUi({ tab: "list", sort: "desc", from: "", to: "", shift: "all", open: "" });
  eq("items 가 객체(0,1 키)여도 2건", (A.detail("2026-11-20").match(/class="acard"/g) || []).length, 2);
  var sparse = clone(FIX);
  sparse["2026-11-20"].shift = "B";              // 조 없이 저장된 기록
  A.set(sparse);
  A.setUi({ shift: "B" });
  ok("shift 가 'B' 여도 B조로 인식", A.rows().length === 1 && A.rows()[0].date === "2026-11-20");
  A.set({});
  A.setUi({ shift: "all", open: "" });
  ok("기록이 없을 때 안내", has(A.table(A.rows()), "아직 07시 알림 기록이 없습니다"));
}

console.log("\n" + (fail ? "✗ 실패 " + fail + "건" : "✓ 전부 통과") + " (" + pass + "개 확인)\n");
globalThis.__BOARD_TEST_FAIL = (globalThis.__BOARD_TEST_FAIL || 0) + fail;
})();
