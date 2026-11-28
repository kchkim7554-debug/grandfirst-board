"use strict";
/* =====================================================================
   🍱 도시락 관리 — 화면 · Firebase 실시간 동기화 · 관리자 권한
   ---------------------------------------------------------------------
   저장 위치(Firebase RTDB, grandfirst-board 와 같은 프로젝트):
     /board/dosirak/records/{id}       {date, person, mealType, price, at, by}
     /board/dosirak/settlements/{ym}   {collectDate, remitDate, memo, invoice:{img,at,by}, receipt:{…}}
     /board/dosirak/config             {pinHash}
   · 일반(조회) 사용자: 달력 · 리스트 · 월말 예상 · 정산 표 · 사진 팝업만
   · 관리자(암호): 식수 추가/삭제 + 정산 등록·수정 까지
   · 주소에 ?sandbox=1 을 붙이면 /board/dosirak/sandbox 로 따로 저장하고 관리자로 열린다
     (배포 전 점검·시연용 — 실제 데이터와 섞이지 않는다)
   ===================================================================== */
var App = (function () {
  var C = window.DS_CORE;
  var ENV = window.DS_ENV || {};
  var LS = ENV.lsPrefix || "ds.";
  var ROOT = ENV.dbRoot || "board/dosirak";
  var ADMIN_PW_SALT = "dosirak-board|";
  /* 관리자 암호의 SHA-256 — 평문은 소스에도 DB에도 두지 않는다.
     (게시판 관리와 같은 암호를 쓰되 salt 는 이 앱 전용으로 다르게) */
  var DEFAULT_PW_HASH = "c13528da9c0b89b84b80d4c81537b0e3e18b7d187e92567b706f33f5227f5ed4";

  var FB_CONFIG = {
    apiKey: "AIzaSyDl9QEY_NSwR4CB4ln71m9vfbF9pbbN7uI",
    authDomain: "grandfirst-board.firebaseapp.com",
    databaseURL: "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "grandfirst-board",
    storageBucket: "grandfirst-board.firebasestorage.app",
    messagingSenderId: "411291957122",
    appId: "1:411291957122:web:7d1f75d58719c447aa019b"
  };

  var S = {
    ym: "", view: "main", records: [], settles: {}, config: {},
    admin: false, connected: false, loaded: false, sandbox: false, db: null,
    edit: null, pending: null, demo: false
  };
  var DAY_NOTES_LEGACY = {};   /* 옛 dosirak.html 의 수기 메모(있으면 함께 보여 준다) */

  /* ---------- 작은 도구 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function todayStr() { return C.ymd(new Date()); }
  function nowIso() { return new Date().toISOString(); }
  function curYm() { return todayStr().slice(0, 7); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- 시트 · 스크롤 잠금 ---------- */
  function openOv(id) {
    var el = $(id);
    if (!el) return;
    el.hidden = false;
    syncLock();
  }
  function closeOv(id) {
    var el = $(id);
    if (!el) return;
    el.hidden = true;
    syncLock();
  }
  var LOCK = { on: false, y: 0 };
  function syncLock() {
    var open = false;
    ["ovList", "ovMeal", "ovSettle", "ovAdmin", "setSheet", "lightbox"].forEach(function (id) {
      var el = $(id);
      if (el && !el.hidden) open = true;
    });
    if (open === LOCK.on) return;
    if (open) {
      LOCK.y = window.pageYOffset || 0;
      document.documentElement.classList.add("lock");
      document.body.classList.add("lock");
      document.body.style.top = (-LOCK.y) + "px";
      LOCK.on = true;
    } else {
      document.documentElement.classList.remove("lock");
      document.body.classList.remove("lock");
      document.body.style.top = "";
      LOCK.on = false;
      window.scrollTo(0, LOCK.y || 0);
    }
  }

  /* ---------- 관리자 ---------- */
  async function hashPw(pw) {
    if (!window.crypto || !crypto.subtle) return null;
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ADMIN_PW_SALT + pw));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    } catch (e) { return null; }
  }
  function expectedHash() { return (S.config && S.config.pinHash) || DEFAULT_PW_HASH; }

  function loadSession() {
    try { S.admin = localStorage.getItem(LS + "admin") === "1"; } catch (e) { S.admin = false; }
    if (S.sandbox) S.admin = true;
  }
  function saveSession() {
    try {
      if (S.admin) localStorage.setItem(LS + "admin", "1");
      else localStorage.removeItem(LS + "admin");
    } catch (e) {}
  }
  function renderChip() {
    var chip = $("admChip");
    if (!chip) return;
    chip.classList.toggle("on", !!S.admin);
    $("admChipText").textContent = S.admin ? "Admin" : "조회";
    chip.querySelector("use").setAttribute("href", S.admin ? "#i-unlock" : "#i-lock");
    var btn = $("setAdminBtn");
    if (btn) btn.textContent = S.admin ? "관리자 로그아웃" : "관리자 인증";
    var fab = $("fabAdd");
    if (fab) fab.hidden = !S.admin || S.view !== "main";
    var add = $("addMonth");
    if (add) add.hidden = !S.admin;
  }
  function openAdminSheet(pending) {
    S.pending = pending || null;
    var el = $("pwInput");
    if (el) el.value = "";
    openOv("ovAdmin");
    setTimeout(function () { if (el) el.focus(); }, 200);
  }
  function withAdmin(fn) {
    if (S.admin) { fn(); return; }
    openAdminSheet(fn);
  }

  async function submitPw() {
    var pw = String(($("pwInput") || {}).value || "");
    if (!pw) { toast("관리자 암호를 입력하세요"); return; }
    var h = await hashPw(pw);
    if (!h) { toast("이 브라우저에서는 인증할 수 없습니다 — https 주소로 열어 주세요"); return; }
    if (h !== expectedHash()) {
      $("pwInput").value = "";
      $("pwInput").focus();
      toast("암호가 맞지 않습니다");
      return;
    }
    S.admin = true;
    saveSession();
    closeOv("ovAdmin");
    renderChip();
    toast("관리자로 인증되었습니다");
    var p = S.pending; S.pending = null;
    if (p) setTimeout(p, 80);
    else render();
  }

  /* ---------- Firebase ---------- */
  function toRecordArray(val) {
    if (!val) return [];
    var out = [];
    Object.keys(val).forEach(function (k) {
      var r = val[k];
      if (!r || typeof r !== "object") return;
      out.push({
        id: k, date: String(r.date || ""), person: r.person || "",
        mealType: r.mealType || "", price: +r.price || 0,
        at: +r.at || 0, by: r.by || ""
      });
    });
    out.sort(function (a, b) { return (a.date + a.mealType).localeCompare(b.date + b.mealType); });
    return out;
  }

  function startFirebase() {
    if (typeof firebase === "undefined" || !firebase || !firebase.initializeApp) { startDemo("오프라인"); return; }
    try {
      firebase.initializeApp(FB_CONFIG);
      S.db = firebase.database();
    } catch (e) { startDemo("연결 실패"); return; }

    S.db.ref(".info/connected").on("value", function (s) {
      S.connected = !!s.val();
      setInfo();
    });
    S.db.ref(ROOT + "/config").on("value", function (s) { S.config = s.val() || {}; });
    S.db.ref(ROOT + "/records").on("value", function (s) {
      S.records = toRecordArray(s.val());
      S.loaded = true;
      render();
    }, function (e) {
      startDemo("읽기 실패");
    });
    S.db.ref(ROOT + "/settlements").on("value", function (s) {
      S.settles = s.val() || {};
      render();
    });
    setTimeout(function () { if (!S.loaded && !S.demo) startDemo("응답 없음"); }, 8000);
  }

  /* Firebase 를 못 쓰는 환경(파일로 열기·비행기 모드)에서도 보기용으로 뜨게 */
  function startDemo(reason) {
    if (S.demo) return;
    S.demo = true;
    S.db = null;
    try {
      var saved = localStorage.getItem(LS + "demoRecords");
      S.records = saved ? JSON.parse(saved) : [];
    } catch (e) { S.records = []; }
    S.settles = {};
    S.loaded = true;
    setInfo(reason);
    render();
  }
  function setInfo(reason) {
    var el = $("setInfo");
    if (!el) return;
    var txt = S.demo
      ? "오프라인 보기 모드 (" + (reason || "연결 안 됨") + ") — 기록은 이 기기에만 저장됩니다"
      : (S.connected ? "실시간 연결됨 — 같은 링크를 연 사람과 바로 공유됩니다" : "연결 중…");
    el.textContent = txt;
  }

  function fbSet(path, val) {
    if (!S.db) { saveDemo(); return Promise.resolve(true); }
    return S.db.ref(path).set(val).then(function () { return true; })
      .catch(function (e) { toast("저장 실패: " + ((e && e.message) || e)); return false; });
  }
  function fbRemove(path) {
    if (!S.db) { saveDemo(); return Promise.resolve(true); }
    return S.db.ref(path).remove().then(function () { return true; })
      .catch(function (e) { toast("삭제 실패: " + ((e && e.message) || e)); return false; });
  }
  function saveDemo() {
    try { localStorage.setItem(LS + "demoRecords", JSON.stringify(S.records)); } catch (e) {}
    render();
  }

  /* ---------- 렌더 ---------- */
  function render() {
    renderHeader();
    renderSummary();
    renderCalendar();
    renderSettle();
    renderChip();
    setInfo();
  }

  function renderHeader() {
    if (S.view === "settle") {
      $("ttlSub").textContent = "도시락 관리";
      $("ttlMain").textContent = "도시락 대금 정산";
      $("navNext").hidden = true;
      $("navPrev").setAttribute("aria-label", "달력으로");
    } else {
      $("ttlSub").textContent = S.sandbox ? "도시락 관리 · 테스트" : "도시락 관리";
      $("ttlMain").textContent = C.ymLabel(S.ym);
      $("navNext").hidden = false;
      $("navPrev").setAttribute("aria-label", "이전 달");
    }
  }

  function renderSummary() {
    var st = C.monthStats(S.records, S.ym);
    var fx = C.forecast(S.records, S.ym, todayStr());
    $("sumMeals").textContent = st.meals;
    $("sumAmount").textContent = C.won(st.amount);
    $("kimMeals").textContent = st.byPerson["김기춘"].meals;
    $("kimAmount").textContent = C.won(st.byPerson["김기춘"].amount);
    $("choMeals").textContent = st.byPerson["조명수"].meals;
    $("choAmount").textContent = C.won(st.byPerson["조명수"].amount);

    $("fxKimMeals").textContent = fx.kim.meals;
    $("fxKimAmount").textContent = C.won(fx.kim.amount);
    $("fxChoMeals").textContent = fx.cho.meals;
    $("fxChoAmount").textContent = C.won(fx.cho.amount);
    $("fxTotalMeals").textContent = fx.total.meals;
    $("fxTotalAmount").textContent = C.won(fx.total.amount);
    $("fxLabel").textContent = (+S.ym.slice(5, 7)) + "월 말";
    $("fxBadge").textContent = fx.addedMeals > 0 ? "+" + fx.addedMeals + "식" : "확정";
    $("fxBasis").textContent = "기준: " + fx.basis;
  }

  function renderCalendar() {
    var grid = $("calGrid");
    if (!grid) return;
    var y = +S.ym.slice(0, 4), m = +S.ym.slice(5, 7);
    var firstDay = new Date(y, m - 1, 1).getDay();
    var dim = C.daysInMonth(S.ym);
    var today = todayStr();
    var html = "";
    var i;
    for (i = 0; i < firstDay; i++) html += '<div class="day empty"></div>';
    for (var d = 1; d <= dim; d++) {
      var dateStr = S.ym + "-" + C.pad2(d);
      var dow = (firstDay + d - 1) % 7;
      var cls = dow === 0 ? " sun" : (dow === 6 ? " sat" : "");
      var st = C.dayStats(S.records, dateStr);
      var note = C.dayNote(S.records, dateStr) || (DAY_NOTES_LEGACY[dateStr] || []).join("·");
      var num = d === +today.slice(8, 10) && S.ym === today.slice(0, 7)
        ? '<span class="daytoday">' + d + "</span>"
        : "<span>" + d + "</span>";
      html += '<button class="day" data-act="day" data-date="' + dateStr + '">' +
        '<span class="daynum' + cls + '">' + num + "</span>" +
        (note ? '<span class="note">' + esc(note) + "</span>" : "") +
        (st.amount > 0 ? '<span class="cost">' + C.won(st.amount) + "</span>" : "") +
        "</button>";
    }
    var total = firstDay + dim;
    var rest = (7 - (total % 7)) % 7;
    for (i = 0; i < rest; i++) html += '<div class="day empty"></div>';
    grid.innerHTML = html;
  }

  /* ---------- 리스트 시트 ---------- */
  function openList(mode, dateStr) {
    var list;
    var title = "", sub = "";
    if (dateStr) {
      list = C.recordsOn(S.records, dateStr);
      title = C.korDate(dateStr) + " 내역";
    } else if (mode === "kim" || mode === "cho") {
      var person = mode === "kim" ? "김기춘" : "조명수";
      list = C.monthRecords(S.records, S.ym).filter(function (r) { return r.person === person; });
      title = person + " " + (+S.ym.slice(5, 7)) + "월 리스트";
    } else {
      list = C.monthRecords(S.records, S.ym);
      title = (+S.ym.slice(5, 7)) + "월 전체 리스트";
    }
    list = list.slice().sort(function (a, b) {
      return (a.date + (a.person === "김기춘" ? "0" : "1") + a.mealType)
        .localeCompare(b.date + (b.person === "김기춘" ? "0" : "1") + b.mealType);
    });
    var meals = list.length, amount = C.sumPrice(list);
    sub = "총 " + meals + "식 / " + C.won(amount) + "원 · " + (S.admin ? "관리자" : "조회 전용");

    $("listTitle").textContent = title;
    $("listSub").textContent = sub;
    document.querySelector("#ovList .sh-b").innerHTML = '<div class="sumline">총 ' + meals + "식 / " + C.won(amount) + "원</div>" +
      bodyRows(list);
    openOv("ovList");
  }

  function bodyRows(list) {
    if (!list.length) return '<div class="empty-note">등록된 내역이 없습니다.</div>';
    return list.map(function (r) {
      var p = C.dateParts(r.date) || { md: r.date };
      return '<div class="mrow">' +
        '<span><b>' + esc(r.person) + "</b> " + p.md + " <span style=\"color:#64748b\">(" + esc(r.mealType) + ")</span></span>" +
        '<span style="display:flex;align-items:center;gap:6px"><span class="p">' + C.won(r.price) + "원</span>" +
        (S.admin ? '<button class="x" data-act="del-meal" data-id="' + esc(r.id) + '"><svg class="ic"><use href="#i-x"/></svg></button>' : "") +
        "</span></div>";
    }).join("");
  }

  /* ---------- 식수 추가 시트 ---------- */
  function openMealSheet(dateStr) {
    if (!S.admin) { withAdmin(function () { openMealSheet(dateStr); }); return; }
    $("mDate").value = dateStr || todayStr();
    $("mPrice").value = C.UNIT_PRICE;
    renderMealExisting();
    openOv("ovMeal");
  }
  function renderMealExisting() {
    var d = $("mDate").value;
    var list = C.recordsOn(S.records, d);
    var box = $("mExisting");
    if (!list.length) { box.innerHTML = '<div class="empty-note" style="padding:8px 0">등록된 내역이 없습니다.</div>'; return; }
    box.innerHTML = '<div class="sumline" style="margin:0 0 7px">' + list.length + "식 / " + C.won(C.sumPrice(list)) + "원</div>" +
      list.map(function (r) {
        return '<div class="mrow"><span><b>' + esc(r.person) + "</b> " + esc(r.mealType) + ' <span style="color:#94a3b8">(' + C.won(r.price) + '원)</span></span>' +
          '<button class="x" data-act="del-meal" data-id="' + esc(r.id) + '"><svg class="ic"><use href="#i-x"/></svg></button></div>';
      }).join("");
  }
  function addMeal() {
    if (!S.admin) { toast("관리자만 기록할 수 있습니다"); return; }
    var date = $("mDate").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("날짜를 선택해 주세요"); return; }
    var rec = {
      date: date,
      person: $("mPerson").value,
      mealType: $("mType").value,
      price: parseInt($("mPrice").value, 10) || C.UNIT_PRICE,
      at: Date.now(),
      by: "Admin"
    };
    var id = date.replace(/-/g, "") + "-" + rec.person + "-" + rec.mealType + "-" + Date.now().toString(36).slice(-4);
    if (S.db) {
      fbSet(ROOT + "/records/" + id, rec).then(function (ok) { if (ok) toast("추가했습니다"); });
    } else {
      S.records.push(Object.assign({ id: id }, rec));
      saveDemo();
      toast("추가했습니다 (오프라인)");
    }
    setTimeout(renderMealExisting, 250);
  }
  function delMeal(id) {
    if (!S.admin) { toast("관리자만 삭제할 수 있습니다"); return; }
    var rec = S.records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    if (!confirm((C.dateParts(rec.date) || {}).md + " " + rec.person + " " + rec.mealType + " 내역을 삭제할까요?")) return;
    if (S.db) fbRemove(ROOT + "/records/" + id).then(function (ok) { if (ok) toast("삭제했습니다"); });
    else { S.records = S.records.filter(function (r) { return r.id !== id; }); saveDemo(); toast("삭제했습니다 (오프라인)"); }
    setTimeout(renderMealExisting, 250);
  }

  /* ---------- 정산 표 ---------- */
  function settleMonths() {
    var months = C.monthList(S.records, S.settles);
    if (!months.length) months = [curYm()];
    return months;
  }

  function renderSettle() {
    var box = $("stTable");
    if (!box) return;
    var months = settleMonths();
    var html = '<div class="st-row hd">' +
      "<div>년월</div><div>거래명세서</div><div>수신일</div><div>대금송금일</div><div>현금영수증</div></div>";

    months.forEach(function (ym) {
      var row = C.settleRow(ym, S.settles[ym]);
      var st = C.monthStats(S.records, ym);
      html += '<div class="st-row" data-ym="' + ym + '">';

      /* 년월 */
      html += '<button class="st-c" data-act="st-edit" data-ym="' + ym + '">' +
        '<span class="st-ym">' + C.ymLabel(ym) + "</span>" +
        '<span class="st-meals">' + st.meals + "식 · " + C.won(st.amount) + "원</span>" +
        (st.byPerson["조명수"].amount ? '<span class="st-mine">조명수 ' + C.won(st.byPerson["조명수"].amount) + "원</span>" : "") +
        "</button>";

      /* 거래명세서 · 현금영수증 */
      html += docCell(ym, "invoice", row.invoiceImg);
      /* 수신일 · 대금송금일 */
      html += dateCell(ym, row.collectDate);
      html += dateCell(ym, row.remitDate, true);
      html += docCell(ym, "receipt", row.receiptImg);
      html += "</div>";
    });
    box.innerHTML = html;

    var need = months.filter(function (ym) { return !C.settleRow(ym, S.settles[ym]).hasInvoice; }).length;
    $("stFoot").textContent = months.length + "개월 · 거래명세서 미등록 " + need + "건" +
      (S.admin ? " · 칸을 눌러 등록·수정할 수 있습니다" : "");
    var add = $("addMonth");
    if (add) add.hidden = !S.admin;
  }

  function docCell(ym, kind, img) {
    var label = C.DOC_KINDS[kind];
    if (img) {
      return '<button class="st-c" data-act="st-doc" data-ym="' + ym + '" data-kind="' + kind + '" aria-label="' + label + ' 사진 보기">' +
        '<img class="st-thumb" src="' + img + '" alt="' + label + '">' +
        "</button>";
    }
    return '<button class="st-c" data-act="st-edit" data-ym="' + ym + '">' +
      (S.admin ? '<span class="st-add"><svg class="ic"><use href="#i-plus"/></svg></span>'
        : '<span class="st-empty">미등록</span>') +
      "</button>";
  }

  function dateCell(ym, dateStr, isRemit) {
    var parts = C.dateParts(dateStr);
    return '<button class="st-c" data-act="st-edit" data-ym="' + ym + '">' +
      (parts
        ? '<span class="st-d">' + parts.y + '</span><span class="st-md">' + parts.md + "</span>"
        : '<span class="st-empty">' + (isRemit ? "미입력" : "미입력") + "</span>") +
      "</button>";
  }

  /* ---------- 정산 등록·수정 시트 ---------- */
  function openSettleSheet(ym) {
    if (!S.admin) { withAdmin(function () { openSettleSheet(ym); }); return; }
    var isNew = !ym;
    var cand = null;
    if (isNew) {
      /* 아직 정산 행이 없는 달만 후보로 — 기본값은 '이번 달 다음 달' */
      var have = {};
      C.monthList(S.records, S.settles).forEach(function (k) { have[k] = 1; });
      cand = [];
      var base = C.monthList(S.records, S.settles)[0] || curYm();
      for (var i = 1; i <= 8; i++) {
        var k = C.shiftYm(base, i);
        if (!have[k] && cand.indexOf(k) < 0) cand.push(k);
      }
      if (!cand.length) cand = [C.shiftYm(base, 1)];
      ym = cand[0];
    }
    var row = C.settleRow(ym, S.settles[ym] || {});
    S.edit = {
      ym: ym, isNew: isNew, cand: cand,
      invoiceImg: row.invoiceImg, invoiceAt: row.invoiceAt,
      receiptImg: row.receiptImg, receiptAt: row.receiptAt,
      collectDate: row.collectDate, remitDate: row.remitDate, memo: row.memo || "",
      exists: !!S.settles[ym]
    };
    $("stETitle").textContent = isNew ? "정산 등록" : C.ymLabel(ym) + " 정산";
    $("stESub").textContent = isNew ? "등록할 달을 고르고 사진·날짜를 넣으세요" : "관리자만 수정할 수 있습니다";
    $("stEBody").innerHTML = settleFormHtml(S.edit);
    openOv("ovSettle");
  }

  function settleFormHtml(e) {
    var st = C.monthStats(S.records, e.ym);
    var html = "";
    if (e.isNew && e.cand && e.cand.length) {
      html += '<div class="fld"><label>년월</label><div class="chipline">' +
        e.cand.map(function (k) {
          return '<button class="chip' + (k === e.ym ? " on" : "") + '" data-act="st-pick-ym" data-ym="' + k + '">' +
            C.ymLabel(k) + "</button>";
        }).join("") + "</div></div>";
    }
    html += '<div class="fld"><label>' + (e.isNew ? "이 달 정산 내용" : "년월") + '</label><div class="sumline" style="margin:0">' +
      C.ymLabel(e.ym) + " · " + st.meals + "식 " + C.won(st.amount) + "원 · 조명수 " + C.won(st.byPerson["조명수"].amount) + "원</div></div>";
    html += upBlock("invoice", "거래명세서 사진", e.invoiceImg, e.invoiceAt);
    html += '<div class="row2">' +
      '<div class="fld"><label>수신일</label><input type="date" class="in" id="stECollect" value="' + esc(e.collectDate) + '"></div>' +
      '<div class="fld"><label>대금송금일</label><input type="date" class="in" id="stERemit" value="' + esc(e.remitDate) + '"></div>' +
      "</div>";
    html += upBlock("receipt", "현금영수증 사진", e.receiptImg, e.receiptAt);
    html += '<div class="fld"><label>메모 (선택)</label><input type="text" class="in" id="stEMemo" value="' + esc(e.memo) + '" placeholder="예: 11월분 정산 완료"></div>';
    if (!e.isNew && e.exists) {
      html += '<button class="mini warn" data-act="st-del" style="margin-top:2px">이 달 정산 내용 삭제</button>';
    }
    html += '<input type="file" class="filehide" id="fileInvoice" accept="image/*"><input type="file" class="filehide" id="fileReceipt" accept="image/*">';
    return html;
  }

  function upBlock(kind, title, img, at) {
    var stamp = at ? C.dotDate(String(at).slice(0, 10)) : "";
    return '<div class="fld"><label>' + title + "</label>" +
      '<div class="up" id="up-' + kind + '">' +
      (img ? '<img class="up-thumb" src="' + img + '" alt="' + title + '">'
        : '<div class="up-none"><svg class="ic"><use href="#i-image"/></svg></div>') +
      '<div class="up-b"><div class="up-t">' + (img ? "등록됨" : "사진 없음") + "</div>" +
      '<div class="up-s">' + (img ? (stamp ? stamp + " 등록" : "등록됨") : "촬영하거나 앨범에서 고르세요") + "</div>" +
      '<div class="up-btns"><button class="mini ' + (img ? "" : "solid") + '" data-act="pick" data-kind="' + kind + '">' +
      (img ? "바꾸기" : "사진 선택") + "</button>" +
      (img ? '<button class="mini warn" data-act="pick-clear" data-kind="' + kind + '">삭제</button>' : "") +
      "</div></div></div></div>";
  }

  function readImage(file, max, quality) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("파일을 읽지 못했습니다")); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("사진을 열지 못했습니다")); };
        img.onload = function () {
          try {
            var size = C.fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, max);
            var cv = document.createElement("canvas");
            cv.width = size.w; cv.height = size.h;
            var ctx = cv.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, size.w, size.h);
            ctx.drawImage(img, 0, 0, size.w, size.h);
            resolve(cv.toDataURL("image/jpeg", quality));
          } catch (e) { reject(e); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function pickImage(kind, file) {
    if (!file) return;
    toast("사진을 줄이는 중…");
    readImage(file, 1200, 0.72).then(function (dataUrl) {
      var bytes = C.dataUrlBytes(dataUrl);
      if (S.edit) {
        if (kind === "invoice") {
          S.edit.invoiceImg = dataUrl;
          S.edit.invoiceAt = nowIso();
          if (!$("stECollect").value) $("stECollect").value = todayStr();
        } else {
          S.edit.receiptImg = dataUrl;
          S.edit.receiptAt = nowIso();
        }
      }
      refreshUp(kind);
      toast("사진을 넣었습니다 (" + Math.round(bytes / 1024) + "KB)");
    }).catch(function (e) { toast("사진을 넣지 못했습니다: " + ((e && e.message) || e)); });
  }

  function refreshUp(kind) {
    if (!S.edit) return;
    var holder = $("up-" + kind);
    if (!holder) return;
    var img = kind === "invoice" ? S.edit.invoiceImg : S.edit.receiptImg;
    var at = kind === "invoice" ? S.edit.invoiceAt : S.edit.receiptAt;
    var wrap = document.createElement("div");
    wrap.innerHTML = upBlock(kind, (C.DOC_KINDS[kind]) + " 사진", img, at);
    var fresh = wrap.querySelector(".fld");
    var outer = (holder.closest && holder.closest(".fld")) || holder.parentNode;
    outer.parentNode.replaceChild(fresh, outer);
  }

  function saveSettle() {
    if (!S.edit) return;
    if (!S.admin) { toast("관리자만 저장할 수 있습니다"); return; }
    var e = S.edit;
    var collect = ($("stECollect") || {}).value || "";
    var remit = ($("stERemit") || {}).value || "";
    var memo = ($("stEMemo") || {}).value || "";
    if (e.invoiceImg && !collect) collect = todayStr();     /* 업로드하면 수신일 자동 기록 */
    var obj = {
      ym: e.ym,
      collectDate: collect,
      remitDate: remit,
      memo: memo,
      invoice: e.invoiceImg ? { img: e.invoiceImg, at: e.invoiceAt || nowIso(), by: "Admin" } : null,
      receipt: e.receiptImg ? { img: e.receiptImg, at: e.receiptAt || nowIso(), by: "Admin" } : null,
      updatedAt: Date.now()
    };
    if (S.db) {
      fbSet(ROOT + "/settlements/" + e.ym, obj).then(function (ok) {
        if (!ok) return;
        closeOv("ovSettle");
        toast(C.ymLabel(e.ym) + " 정산을 저장했습니다");
      });
    } else {
      S.settles[e.ym] = obj;
      closeOv("ovSettle");
      saveDemo();
      toast("저장했습니다 (오프라인)");
    }
  }

  function deleteSettle() {
    if (!S.edit || !S.admin) return;
    var ym = S.edit.ym;
    if (!confirm(C.ymLabel(ym) + " 정산 내용(사진·날짜)을 지웁니다. 계속할까요?")) return;
    if (S.db) {
      fbRemove(ROOT + "/settlements/" + ym).then(function (ok) {
        if (ok) { closeOv("ovSettle"); toast("삭제했습니다"); }
      });
    } else {
      delete S.settles[ym];
      closeOv("ovSettle");
      saveDemo();
      toast("삭제했습니다");
    }
  }

  /* ---------- 사진 팝업 ---------- */
  function openPhoto(ym, kind) {
    var row = C.settleRow(ym, S.settles[ym] || {});
    var img = kind === "invoice" ? row.invoiceImg : row.receiptImg;
    if (!img) return;
    $("lbImg").src = img;
    $("lbImg").classList.remove("zoom");
    $("lbCap").innerHTML = C.ymLabel(ym) + " · " + C.DOC_KINDS[kind] +
      "<em>" + (kind === "invoice" ? row.collectDate ? "수신일 " + C.dotDate(row.collectDate) : ""
        : row.remitDate ? "대금송금일 " + C.dotDate(row.remitDate) : "") + "</em>";
    openOv("lightbox");
  }

  /* ---------- 화면 전환 ---------- */
  function go(view) {
    S.view = view;
    $("viewMain").hidden = view !== "main";
    $("viewSettle").hidden = view !== "settle";
    $("fabAdd").hidden = view !== "main" || !S.admin;
    var want = view === "settle" ? "#/settle" : "#/";
    if ((location.hash || "#/") !== want) { try { location.hash = want; } catch (e) {} }
    render();
  }
  function route() {
    var h = String(location.hash || "").replace(/^#\/?/, "");
    S.view = h === "settle" ? "settle" : "main";
    $("viewMain").hidden = S.view !== "main";
    $("viewSettle").hidden = S.view !== "settle";
    $("fabAdd").hidden = S.view !== "main" || !S.admin;
    render();
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var el = t && t.closest ? t.closest("[data-act]") : null;
      var closeEl = tCLosest(t, "[data-close]");
      if (closeEl) { closeOv(closeEl.getAttribute("data-close")); return; }
      if (!el) return;
      var act = el.getAttribute("data-act");
      if (act === "list") { ev.preventDefault(); openList(el.getAttribute("data-mode")); }
      else if (act === "settle") { ev.preventDefault(); go("settle"); }
      else if (act === "day") {
        var d = el.getAttribute("data-date");
        if (S.admin) openMealSheet(d); else openList(null, d);
      }
      else if (act === "del-meal") { ev.preventDefault(); ev.stopPropagation(); delMeal(el.getAttribute("data-id")); }
      else if (act === "st-edit") {
        var ym = el.getAttribute("data-ym");
        if (S.admin) openSettleSheet(ym); else toast("관리자만 등록·수정할 수 있습니다");
      }
      else if (act === "st-doc") { openPhoto(el.getAttribute("data-ym"), el.getAttribute("data-kind")); }
      else if (act === "st-del") { deleteSettle(); }
      else if (act === "st-pick-ym") {
        if (!S.edit) return;
        S.edit.collectDate = ($("stECollect") || {}).value || "";
        S.edit.remitDate = ($("stERemit") || {}).value || "";
        S.edit.memo = ($("stEMemo") || {}).value || "";
        S.edit.ym = el.getAttribute("data-ym");
        $("stETitle").textContent = "정산 등록";
        $("stEBody").innerHTML = settleFormHtml(S.edit);
      }
      else if (act === "pick") {
        var k = el.getAttribute("data-kind");
        var f = $(k === "invoice" ? "fileInvoice" : "fileReceipt");
        if (f) f.click();
      }
      else if (act === "pick-clear") {
        var k2 = el.getAttribute("data-kind");
        if (S.edit) {
          if (k2 === "invoice") { S.edit.invoiceImg = ""; S.edit.invoiceAt = ""; }
          else { S.edit.receiptImg = ""; S.edit.receiptAt = ""; }
        }
        refreshUp(k2);
      }
      else if (act === "admin") {
        if (S.admin) {
          S.admin = false; saveSession(); renderChip();
          closeOv("setSheet");
          toast("관리자에서 나왔습니다 — 조회 화면입니다");
          render();
        } else { closeOv("setSheet"); openAdminSheet(null); }
      }
      else if (act === "reload") { location.reload(); }
    });

    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.id === "mDate") renderMealExisting();
      if (t.id === "fileInvoice") pickImage("invoice", t.files && t.files[0]);
      if (t.id === "fileReceipt") pickImage("receipt", t.files && t.files[0]);
    });

    $("navPrev").addEventListener("click", function () {
      if (S.view === "settle") { go("main"); return; }
      S.ym = C.shiftYm(S.ym, -1);
      render();
    });
    $("navNext").addEventListener("click", function () {
      S.ym = C.shiftYm(S.ym, 1);
      render();
    });
    $("admChip").addEventListener("click", function () { openOv("setSheet"); });
    $("fabAdd").addEventListener("click", function () { openMealSheet(todayStr()); });
    $("mAdd").addEventListener("click", addMeal);
    $("pwOk").addEventListener("click", submitPw);
    $("pwInput").addEventListener("keydown", function (e) { if (e.key === "Enter") submitPw(); });
    $("stSave").addEventListener("click", saveSettle);
    $("addMonth").addEventListener("click", function () { openSettleSheet(null); });
    $("lbClose").addEventListener("click", function () { closeOv("lightbox"); });
    $("lbZoom").addEventListener("click", function () {
      $("lbImg").classList.toggle("zoom");
      $("lbZoom").textContent = $("lbImg").classList.contains("zoom") ? "맞추기" : "확대";
    });
    $("lbImg").addEventListener("click", function () { $("lbZoom").click(); });
    $("lightbox").addEventListener("click", function (e) { if (e.target.id === "lightbox") closeOv("lightbox"); });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      ["ovList", "ovMeal", "ovSettle", "ovAdmin", "setSheet", "lightbox"].forEach(function (id) {
        var el = $(id); if (el && !el.hidden) closeOv(id);
      });
    });
    window.addEventListener("hashchange", route);
  }

  function tCLosest(t, sel) {
    var el = t;
    while (el && el !== document) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* ---------- 시작 ---------- */
  function boot() {
    var q = {};
    try { q = new URLSearchParams(location.search); } catch (e) {}
    if (q.get("sandbox") === "1") { ROOT = ROOT + "/sandbox"; S.sandbox = true; }
    S.ym = (q.get("ym") || "").match(/^\d{4}-\d{2}$/) ? q.get("ym") : curYm();
    loadSession();
    bind();
    renderChip();
    if (window.location.hash) route(); else render();
    startFirebase();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* 테스트용(순수 함수는 core.js) — 화면 조작 없이 상태만 본다 */
  return {
    state: function () { return S; },
    setRecords: function (arr) { S.records = arr || []; render(); },
    openSettleSheet: openSettleSheet,
    openList: openList,
    go: go, render: render,
    settleFormHtml: settleFormHtml
  };
})();
if (typeof globalThis !== "undefined") { try { globalThis.__dsApp = App; } catch (e) {} }
