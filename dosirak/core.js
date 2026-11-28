"use strict";
/* =====================================================================
   🍱 도시락 관리 — 순수 계산 (DOM·Firebase 를 쓰지 않는 부분)
   ---------------------------------------------------------------------
   달력 집계 · 월말 예상 · 정산(거래명세서/수금일/대금송금일/현금영수증)
   행 만들기처럼 숫자로 끝나는 일은 모두 여기에 모아 둔다.
   test/run_tests.py 가 이 파일만 불러 100여 개 항목을 검사한다.
   ===================================================================== */
var DS_CORE = (function () {

  var UNIT_PRICE = 8250;                 /* 1식 단가 (하솜푸드 발열도시락) */
  var PEOPLE = ["김기춘", "조명수"];
  var MEALS = ["중식", "석식"];
  var MEALS_PER_DAY = 4;                 /* 두 사람 × 중·석식 */
  var PER_PERSON_PER_DAY = 2;

  /* 공휴일 (일요일은 따로 처리). 매년 초에 갱신한다. */
  var PUBLIC_HOLIDAYS = [
    /* 2026 */
    "2026-01-01",
    "2026-02-16", "2026-02-17", "2026-02-18",
    "2026-03-01", "2026-03-02",
    "2026-05-05", "2026-05-24", "2026-05-25",
    "2026-06-03", "2026-06-06",
    "2026-08-15", "2026-08-17",
    "2026-09-24", "2026-09-25", "2026-09-26",
    "2026-10-03", "2026-10-05", "2026-10-09",
    "2026-12-25",
    /* 2027 */
    "2027-01-01",
    "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09",
    "2027-03-01",
    "2027-05-05", "2027-05-13",
    "2027-06-06", "2027-06-07",
    "2027-08-15", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16",
    "2027-10-03", "2027-10-04", "2027-10-09",
    "2027-12-25"
  ];

  function pad2(n) { n = +n; return (n < 10 ? "0" : "") + n; }

  /* ---------- 날짜 · 월 ---------- */
  function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  function ymOf(dateStr) { return String(dateStr || "").slice(0, 7); }

  function ymLabel(ym) {
    var p = String(ym || "").split("-");
    if (p.length < 2 || !p[0] || !p[1]) return String(ym || "");
    return p[0] + "년 " + (+p[1]) + "월";
  }

  /* "2026-11" + 1 → "2026-12" / -1 → "2026-10" */
  function shiftYm(ym, n) {
    var p = String(ym || "").split("-");
    var y = +p[0], m = +p[1];
    if (!y || !m) return ym;
    var total = y * 12 + (m - 1) + (+n || 0);
    return Math.floor(total / 12) + "-" + pad2((total % 12) + 1);
  }

  function validYm(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || "")); }

  function daysInMonth(ym) {
    var p = String(ym || "").split("-");
    return new Date(+p[0], +p[1], 0).getDate();
  }

  /* "2026-11-30" → { y: "2026", md: "11.30" }  (표에서 두 줄로 보여 준다) */
  function dateParts(s) {
    s = String(s || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return { y: s.slice(0, 4), md: s.slice(5, 7) + "." + s.slice(8, 10) };
  }

  /* "2026-11-30" → "2026.11.30" */
  function dotDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s).replace(/-/g, ".") : ""; }

  /* "2026.11.30" → "2026-11-30" */
  function isoDate(s) {
    s = String(s || "").trim().replace(/[./]/g, "-");
    return /^\d{4}-\d{1,2}-\d{1,2}$/.test(s)
      ? s.slice(0, 4) + "-" + pad2(s.split("-")[1]) + "-" + pad2(s.split("-")[2])
      : "";
  }

  function weekdayKo(s) {
    var p = String(s || "").split("-");
    if (p.length < 3) return "";
    return ["일", "월", "화", "수", "목", "금", "토"][new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  }

  function korDate(s) {
    var p = String(s || "").split("-");
    if (p.length < 3) return "";
    return p[0] + "년 " + (+p[1]) + "월 " + (+p[2]) + "일";
  }

  /* ---------- 돈 ---------- */
  function won(n) {
    n = Math.round(+n || 0);
    var neg = n < 0;
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + s;
  }

  /* ---------- 기록 집계 ---------- */
  function allRecords(records) { return Array.isArray(records) ? records : []; }

  function recordsOn(records, date) {
    return allRecords(records).filter(function (r) { return r && r.date === date; });
  }

  function monthRecords(records, ym) {
    var pre = String(ym || "").slice(0, 7);
    return allRecords(records).filter(function (r) { return r && ymOf(r.date) === pre; });
  }

  function sumPrice(list) {
    var s = 0;
    (list || []).forEach(function (r) { s += (+r.price || 0); });
    return s;
  }

  function personStats(list, person) {
    var mine = (list || []).filter(function (r) { return r.person === person; });
    return { meals: mine.length, amount: sumPrice(mine) };
  }

  function monthStats(records, ym) {
    var list = monthRecords(records, ym);
    var out = { ym: ym, meals: list.length, amount: sumPrice(list), byPerson: {} };
    PEOPLE.forEach(function (p) { out.byPerson[p] = personStats(list, p); });
    return out;
  }

  /* 하루 내역 — 중식·석식 몇 식인지 */
  function dayStats(records, date) {
    var list = recordsOn(records, date);
    var lunch = 0, dinner = 0;
    list.forEach(function (r) {
      if (r.mealType === "중식") lunch++;
      else if (r.mealType === "석식") dinner++;
    });
    return { meals: list.length, amount: sumPrice(list), lunch: lunch, dinner: dinner, list: list };
  }

  /* 달력 칸의 작은 메모 — 정상(중식 2·석식 2)이면 비워 두고, 아니면 그날 몇 식인지 적는다 */
  function dayNote(records, date) {
    var st = dayStats(records, date);
    if (!st.meals) return "";
    if (st.lunch === 2 && st.dinner === 2) return "";
    return "중식" + st.lunch + "·석식" + st.dinner;
  }

  /* ---------- 근무일 계산 ---------- */
  function isHoliday(dateStr) { return PUBLIC_HOLIDAYS.indexOf(dateStr) >= 0; }

  function isRestDay(dateObj) {
    if (!dateObj) return true;
    if (dateObj.getDay() === 0) return true;         /* 일요일 */
    return isHoliday(ymd(dateObj));
  }

  /* 당월 남은 짝수 근무일(일·공휴일 제외) — 마지막 기록일 다음부터 */
  function remainingWorkDays(ym, records, todayStr) {
    var p = String(ym || "").split("-");
    var y = +p[0], m = +p[1];
    if (!y || !m) return [];
    var dim = daysInMonth(ym);
    var last = 0;
    monthRecords(records, ym).forEach(function (r) {
      var d = parseInt(String(r.date).slice(8, 10), 10);
      if (!isNaN(d) && d > last) last = d;
    });
    var startAfter = last;
    if (todayStr && ymOf(todayStr) === ym) {
      var td = parseInt(String(todayStr).slice(8, 10), 10);
      if (td > startAfter) startAfter = td;
    }
    /* 지난 달 — 남은 근무일 없음 */
    if (todayStr && String(todayStr).slice(0, 7) > ym) return [];

    var days = [];
    for (var d = startAfter + 1; d <= dim; d++) {
      if (d % 2 !== 0) continue;                     /* 짝수 근무일 */
      if (isRestDay(new Date(y, m - 1, d))) continue;
      days.push(d);
    }
    return days;
  }

  /* 월말 예상 — 오늘까지 기록된 식수 + 남은 근무일 × 4식 */
  function forecast(records, ym, todayStr) {
    var st = monthStats(records, ym);
    var days = remainingWorkDays(ym, records, todayStr);
    var avg = st.meals > 0 ? Math.round(st.amount / st.meals) : UNIT_PRICE;
    var addPerPerson = days.length * PER_PERSON_PER_DAY;
    var addMeals = days.length * MEALS_PER_DAY;
    var out = {
      ym: ym, confirmed: days.length === 0,
      addedMeals: addMeals, addedDays: days, avgUnit: avg,
      kim: { meals: st.byPerson["김기춘"].meals + addPerPerson, amount: st.byPerson["김기춘"].amount + addPerPerson * avg },
      cho: { meals: st.byPerson["조명수"].meals + addPerPerson, amount: st.byPerson["조명수"].amount + addPerPerson * avg },
      now: { meals: st.meals, amount: st.amount }
    };
    out.total = { meals: out.kim.meals + out.cho.meals, amount: out.kim.amount + out.cho.amount };
    out.basis = days.length
      ? ymLabel(ym).replace("년 ", "년 ") + " " + days.join("·") + "일 근무 (짝수일, 일·공휴일 제외) · " + days.length + "일 × 4식 = +" + addMeals + "식"
      : "남은 근무일 없음 — 확정 금액";
    return out;
  }

  /* ---------- 정산(도시락 대금) ---------- */
  var DOC_KINDS = { invoice: "거래명세서", receipt: "현금영수증" };

  function docInfo(s, kind) {
    var d = (s && s[kind]) || null;
    if (!d) return { img: "", at: "", by: "" };
    if (typeof d === "string") return { img: d, at: "", by: "" };  /* 옛 형식(문자열)도 읽는다 */
    return { img: d.img || "", at: d.at || "", by: d.by || "" };
  }

  /* DB에서 온 정산 한 달치를 화면이 쓰는 모양으로 */
  function settleRow(ym, raw) {
    raw = raw || {};
    var inv = docInfo(raw, "invoice");
    var rec = docInfo(raw, "receipt");
    return {
      ym: ym,
      invoiceImg: inv.img, invoiceAt: inv.at, invoiceBy: inv.by,
      receiptImg: rec.img, receiptAt: rec.at, receiptBy: rec.by,
      collectDate: isoDate(raw.collectDate || ""),
      remitDate: isoDate(raw.remitDate || ""),
      memo: raw.memo || "",
      updatedAt: +raw.updatedAt || 0,
      hasInvoice: !!inv.img, hasReceipt: !!rec.img
    };
  }

  /* 달력 기록이 있는 달 + 정산이 있는 달 = 정산 목록에 보일 달 (최신 먼저) */
  function monthList(records, settlements) {
    var set = {};
    allRecords(records).forEach(function (r) { var k = ymOf(r.date); if (validYm(k)) set[k] = 1; });
    Object.keys(settlements || {}).forEach(function (k) { if (validYm(k)) set[k] = 1; });
    return Object.keys(set).sort().reverse();
  }

  /* 정산 상태 — 등록/진행/완료 (표에서 한눈에) */
  function settleState(row) {
    if (!row) return "none";
    if (row.hasInvoice && row.hasReceipt && row.remitDate) return "done";
    if (row.hasInvoice || row.hasReceipt || row.collectDate || row.remitDate) return "part";
    return "none";
  }
  function settleStateLabel(row) {
    var s = settleState(row);
    if (s === "done") return "정산 완료";
    if (s === "part") return "진행 중";
    return "미등록";
  }

  /* 사진(base64 data URL)의 대략 크기 */
  function dataUrlBytes(url) {
    var s = String(url || "");
    var i = s.indexOf(",");
    if (i < 0) return 0;
    var b64 = s.slice(i + 1);
    var pad = b64.slice(-2) === "==" ? 2 : (b64.slice(-1) === "=" ? 1 : 0);
    return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
  }

  /* 긴 변을 max 이하로 줄인 크기 */
  function fitSize(w, h, max) {
    w = +w || 0; h = +h || 0; max = +max || 0;
    if (!w || !h || !max) return { w: w, h: h };
    if (w <= max && h <= max) return { w: Math.round(w), h: Math.round(h) };
    var r = max / Math.max(w, h);
    return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
  }

  var API = {
    UNIT_PRICE: UNIT_PRICE, PEOPLE: PEOPLE, MEALS: MEALS,
    MEALS_PER_DAY: MEALS_PER_DAY, PER_PERSON_PER_DAY: PER_PERSON_PER_DAY,
    PUBLIC_HOLIDAYS: PUBLIC_HOLIDAYS, DOC_KINDS: DOC_KINDS,
    pad2: pad2, ymd: ymd, ymOf: ymOf, ymLabel: ymLabel, shiftYm: shiftYm, validYm: validYm,
    daysInMonth: daysInMonth, dateParts: dateParts, dotDate: dotDate, isoDate: isoDate,
    weekdayKo: weekdayKo, korDate: korDate, won: won,
    recordsOn: recordsOn, monthRecords: monthRecords, monthStats: monthStats,
    dayStats: dayStats, dayNote: dayNote, sumPrice: sumPrice, personStats: personStats,
    isHoliday: isHoliday, isRestDay: isRestDay, remainingWorkDays: remainingWorkDays,
    forecast: forecast,
    docInfo: docInfo, settleRow: settleRow, monthList: monthList,
    settleState: settleState, settleStateLabel: settleStateLabel,
    dataUrlBytes: dataUrlBytes, fitSize: fitSize
  };
  if (typeof globalThis !== "undefined") { try { globalThis.__dsCore = API; } catch (e) {} }
  return API;
})();
