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
  ok("표 머리 4칸 + 우측 화살표 칸", has(h, "<th>년월일</th>") && has(h, "<th>내용</th>") &&
    has(h, 'class="ac">제거건수') && has(h, 'class="ac">담당') && has(h, 'class="ac ago"'));
  ok("행 오른쪽 › 화살표", (h.match(/class="ac ago" aria-hidden="true">›/g) || []).length === 3);
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

/* ---------- 3. 날짜 행 → 별도 상세 화면 (목록을 가리고 전환) ---------- */
console.log("\n[3] 행을 누르면 별도 상세 화면");
{
  reset({});
  var list = A.screen();
  ok("목록 화면에는 상세가 함께 나오지 않는다", has(list, 'id="alertBody"') && !has(list, 'id="alertDetail"'));
  ok("목록 안내 문구도 '별도 화면'", has(list, "별도 화면"));

  var body = A.screen("2026-11-20");
  ok("날짜 상세 화면은 목록을 가린다", has(body, 'id="alertDetail"') && !has(body, 'id="alertBody"') &&
    !has(body, "<th>년월일</th>"));
  ok("상세 제목 = 날짜·담당·건수", has(body, "2026.11.20 (금)") && has(body, "B조") && has(body, "제거 대상 2건"));
  ok("맨 위 뒤로 가기(‹ 목록)", has(body, 'data-act="alert-list"') && has(body, "‹ 목록"));
  /* 2026-11-27 요청 — 상단 중복 줄 정리 + 우측 상단 [닫기] + 날짜 숫자 달력 아이콘 */
  ok("상단 중복 줄(일일 알림 / 날짜별 상세)이 사라졌다", !has(body, "날짜별 상세") && !has(body, 'class="acrumb"'));
  ok("우측 상단 [닫기]", has(body, 'class="aview-x"') && has(body, "닫기"));
  ok("고정 📅 이모지 대신 커스텀 달력 아이콘", !has(body, "📅") && has(body, 'class="calico"'));
  ok("달력 아이콘에 그날 날짜 숫자(20)", has(body, 'class="calnum" x="12" y="18.1" text-anchor="middle">20</text>'));
  ok("카드 이미지 2장", (body.match(/class="acard"/g) || []).length === 2 &&
    has(body, "templates/cards/2026-11-20_R01.jpg") && has(body, "templates/cards/2026-11-20_R15.jpg"));
  ok("안내 문구 표시", has(body, "[승강기 정기 점검] 오늘 제거 바랍니다."));
  ok("안내 문구 복사 버튼은 삭제됨", !has(body, 'data-act="alert-copy"') && !has(body, "안내 문구 복사"));
  ok("카드 저장(내려받기) 링크는 삭제됨", !has(body, 'download="2026-11-20_R01.jpg"') && !has(body, "카드 저장"));
  ok("확대 보기(zoom)", has(body, 'data-act="zoom"'));

  reset({});
  var none = A.screen("2026-11-19");
  ok("제거 없는 날 상세 — 요약 한 줄만", has(none, "제거 대상 게시물이 없습니다") && !has(none, 'class="acard"') &&
    (none.match(/제거 대상 게시물이 없/g) || []).length === 1, String((none.match(/제거 대상 게시물이 없/g) || []).length));
  ok("없는 날짜는 안내", has(A.screen("2026-12-25"), "07시 알림 기록이 없습니다"));
  eq("없는 날짜 상세는 빈 문자열", A.detail("2026-12-25"), "");
}

/* ---------- 3-0. 해시 라우트 — 행 클릭이 날짜 화면으로 전환 ---------- */
console.log("\n[3-0] 해시 라우트 #/alerts/날짜");
{
  var B = globalThis.__boardTest;
  var hv = B.hash("#/alerts/2026-11-20");
  ok("#/alerts/날짜 → 상세 화면", hv.name === "alerts" && hv.date === "2026-11-20", JSON.stringify(hv));
  var hl = B.hash("#/alerts");
  ok("#/alerts → 목록", hl.name === "alerts" && !hl.date);
  ok("날짜가 아닌 해시는 목록", !B.hash("#/alerts/xyz").date);
  ok("다른 해시는 그대로", B.hash("#/deploy").name === "deploy");
}

/* ---------- 3-2. 상세 화면 순서 — ① 오늘 일어날 일 → ② 오늘 제거 대상 ---------- */
console.log("\n[3-2] 상세 화면 순서 — 게시물 주요 일정이 먼저");
{
  reset({});
  var d = A.screen("2026-11-20");
  ok("'주의할 내용' 섹션이 제거대상 게시물 섹션보다 위", d.indexOf("주의할 내용") > 0 && d.indexOf("제거대상 게시물") > 0 &&
    d.indexOf("주의할 내용") < d.indexOf("제거대상 게시물"),
    "일정 " + d.indexOf("주의할 내용") + " / 제거 " + d.indexOf("제거대상 게시물"));
  ok("섹션 제목 — 오늘 주의할 내용 (기존 오늘 일어날 일)", has(d, "그날 주의할 내용") && has(d, "(게시물 주요 일정)") &&
    !has(d, "일어날 일"));
  ok("주의 아이콘(SVG)", has(d, 'class="warnico"'));
  ok("섹션 제목 — 그날 제거대상 게시물", has(d, "그날 제거대상 게시물") && !has(d, "제거 대상</span>"));
  ok("events 없으면 빈 상태", has(d, "등록된 주요 일정 없음"));

  var withEv = clone(FIX);
  withEv["2026-11-20"].events = [
    { title: "승강기 정기 점검", time: "10:00~16:00", detail: "동별 순차 점검(101~121동)", noticeId: "R01" },
    "입주민 의견서 마감 18시"
  ];
  A.set(withEv); A.setUi({ tab: "list", sort: "desc", from: "", to: "", shift: "all", open: "" });
  var de = A.screen("2026-11-20");
  ok("일정 카드 2장", (de.match(/class="ev"/g) || []).length === 2, String((de.match(/class="ev"/g) || []).length));
  ok("일정 시간·제목·내용", has(de, "10:00~16:00") && has(de, "승강기 정기 점검") && has(de, "동별 순차 점검"));
  ok("문자열 일정도 표시", has(de, "입주민 의견서 마감 18시"));
  eq("start/end → 시간", A.events({ events: [{ title: "대표회의", start: "19:00", end: "20:30" }] })[0].time, "19:00~20:30");

  var pushEv = clone(withEv);
  pushEv["2026-11-21"].events = { "-N1": { title: "소방 점검", time: "09:00" }, "-N2": { title: "단지 대표회의" } };
  A.set(pushEv); A.setUi({ shift: "all", open: "" });
  eq("Firebase 객체 events 도 2건", A.events(A.byDate("2026-11-21")).length, 2);
  ok("객체 events 화면 표시", has(A.screen("2026-11-21"), "소방 점검"));
  eq("events 없는 날은 빈 배열", A.events(A.byDate("2026-11-19")).length, 0);
}

/* ---------- 3-3. 상세 화면 [제거 목록 복사] ---------- */
console.log("\n[3-3] 상세 화면 — 제거 목록 복사");
{
  reset({});
  var d = A.screen("2026-11-20");
  ok("제거 목록 복사 버튼 3개는 삭제됨", !has(d, 'data-act="alert-copy-day"') && !has(d, "제거 목록 복사") &&
    !has(d, "카드 저장") && !has(d, "안내 문구 복사"));

  B.setToday("2026-11-20");
  ok("오늘 날짜 상세 — 오늘 제목", has(A.screen("2026-11-20"), "오늘 제거대상 게시물"));
  var t = A.dayCopy("2026-11-20");
  ok("복사 문구 — 날짜·담당·건수",
    t.indexOf("[제일풍경채 그랑퍼스트 1단지] 2026년 11월 20일 (금) B조 제거 대상 2건") === 0, t.split("\n")[0]);
  ok("복사 문구 — 안내 2건", t.indexOf("1. ") > 0 && t.indexOf("2. ") > t.indexOf("1. "));
  ok("복사 문구 — 게시판 바로가기", t.indexOf("👉 제거 체크하기: https://kchkim7554-debug.github.io/grandfirst-board/#/deploy") > 0);
  eq("없는 날짜 복사 문구는 빈 문자열", A.dayCopy("2026-12-25"), "");
  B.setToday("");
}

/* ---------- 3-1. [안내 문구 복사] — 게시판 바로가기 링크 포함 ---------- */
console.log("\n[3-1] 안내 문구 복사 — 바로가기 링크");
{
  var API = globalThis.__boardTest;
  reset({ open: "2026-11-20" });
  var msg = FIX["2026-11-20"].items[0].message;
  var t = API.alertCopyText("2026-11-20", 0);
  ok("복사 문구는 안내 문구 그대로 시작", t.indexOf(msg) === 0, t.slice(0, 60));
  ok("한 줄 띄우고 바로가기 링크", t.indexOf(msg + "\n\n👉 제거 체크하기: ") === 0 && t.length > msg.length + 2, t);
  ok("원본 게시판 주소(#/deploy)",
    t.indexOf("https://kchkim7554-debug.github.io/grandfirst-board/#/deploy") > 0, t);
  eq("boardUrl() 기본 = 저장소 주소", API.boardUrl(), "https://kchkim7554-debug.github.io/grandfirst-board/");
  eq("boardUrl(hash)", API.boardUrl("#/deploy"), "https://kchkim7554-debug.github.io/grandfirst-board/#/deploy");
  eq("없는 날짜는 빈 문자열", API.alertCopyText("2026-12-25", 0), "");
  eq("없는 항목은 빈 문자열", API.alertCopyText("2026-11-20", 9), "");
  var today = API.copyText("today");
  ok("[오늘 제거 목록 복사]에도 링크", today.indexOf("👉 제거 체크하기: https://kchkim7554-debug.github.io/grandfirst-board/#/deploy") > 0, today.slice(-120));
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
