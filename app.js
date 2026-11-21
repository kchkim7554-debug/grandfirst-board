"use strict";
/* =========================================================
   💓💓게시판 관리💓💓 — 풍경채 그랑퍼스트
   실시간 다중 사용자 게시판 (Firebase Realtime Database / Spark 무료)
   프로세스: 1 등록(관리자) → 2 게시 체크 → 3 제거 체크 → 4 보관함
   ========================================================= */
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyDl9QEY_NSwR4CB4ln71m9vfbF9pbbN7uI",
  authDomain: "grandfirst-board.firebaseapp.com",
  databaseURL: "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "grandfirst-board",
  storageBucket: "grandfirst-board.firebasestorage.app",
  messagingSenderId: "411291957122",
  appId: "1:411291957122:web:7d1f75d58719c447aa019b"
};
var PIN_SALT = "grandfirst-board|";
/* 기본 관리자 PIN 7554 의 SHA-256 (평문은 DB에 저장하지 않음) */
var DEFAULT_PIN_HASH = "280e9599e805b04e6990ecd8a70563e485534485b97cbc93835be8a4bce7965f";

var DEFAULT_CONFIG = {
  admins: ["카일", "관리사무소"],
  pinHash: DEFAULT_PIN_HASH,
  teams: {
    A: { label: "A조", zones: { front: "염일엽", backA: "성연무", backB: "윤주한" } },
    B: { label: "B조", zones: { front: "황보선희", backA: "김기춘", backB: "조명수" } }
  }
};

var App = (function () {
  /* ---------- state ---------- */
  var FAC = null;                       // 시설 데이터 (data.json): 동/코어/게시판
  var CFG = null;                       // 담당자·PIN 설정 (Firebase board/config)
  var NOTICES = [];                     // 게시물 배열 (Firebase board/notices)
  var ALERTS = [];                      // 07시 제거 알림 (Firebase board/daily_alerts), 최신순
  var BYID = {};                        // id → notice
  var INDEX = {}, PLACE = {}, BSTAT = {};   // 게시판 인덱스
  var TODAY = "";
  var VIEW = { name: "home", no: null, core: null, loc: null, slot: null };
  var ZONE = "all";
  var FONT_LG = false;
  var SESSION = { role: null, team: "A", zone: "front", name: "", admin: "" };
  var ARCH_FILTER = { date: "all", slot: "all", q: "" };
  /* 게시물 이력 및 통계 화면 탭 상태 (누적조회 · 년월별 · 처리 이력) */
  var HIST = { tab: "cum", from: "", to: "", month: "", day: "" };
  var CONNECTED = false;
  var LOADED = false;
  var NOTICES_READY = false;            // 게시물 응답이 한 번이라도 왔는지
  var db = null;
  var lastRenderKey = "";

  var STATUS_LABEL = {
    overdue: "기한 경과", today: "오늘 제거", tomorrow: "내일 제거",
    soon: "기한 임박", active: "게시 중", permanent: "상시", removed: "제거 완료"
  };
  var STATUS_RANK = { overdue: 0, today: 1, tomorrow: 2, soon: 3, permanent: 4, active: 5 };
  var CATEGORIES = ["안내문", "공고문", "홍보물", "기타"];

  /* ---------- basics ---------- */
  function pad2(v) { return String(v).padStart(2, "0"); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function toUTC(s) {
    if (!s) return 0;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    return Date.UTC(y, m - 1, d);
  }
  function diffDays(from, to) {
    if (!from || !to) return null;
    return Math.round((toUTC(to) - toUTC(from)) / 86400000);
  }
  function dotDate(s) { return s ? s.replace(/-/g, ".") : ""; }
  function mmdd(s) { return s ? s.slice(5, 7) + "/" + s.slice(8, 10) : ""; }
  function korDate(s) {
    if (!s) return "";
    return +s.slice(0, 4) + "년 " + (+s.slice(5, 7)) + "월 " + (+s.slice(8, 10)) + "일";
  }
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  function weekday(s) { return WEEK[new Date(toUTC(s)).getUTCDay()]; }
  function num(n) { return (n || 0).toLocaleString("ko-KR"); }
  function tsText(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function nowTs() { return Date.now(); }
  function newId() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function sortByDeadline(a, b) {
    return (a.deadline || "9999-12-31") < (b.deadline || "9999-12-31") ? -1 : 1;
  }
  function byName(a, b) { return a.localeCompare(b); }

  /* ---------- facility helpers ---------- */
  function zoneById(id) {
    if (!FAC) return null;
    for (var i = 0; i < FAC.zones.length; i++) if (FAC.zones[i].id === id) return FAC.zones[i];
    return null;
  }
  function zoneOfBuilding(no) {
    for (var i = 0; i < FAC.buildings.length; i++) if (FAC.buildings[i].no === Number(no)) return FAC.buildings[i].zone;
    return null;
  }
  function buildingByNo(no) {
    for (var i = 0; i < FAC.buildings.length; i++) if (FAC.buildings[i].no === Number(no)) return FAC.buildings[i];
    return null;
  }
  function zoneName(id) { var z = zoneById(id); return z ? z.name : id; }
  function zoneShort(id) { var z = zoneById(id); return z ? (z.short || z.name) : id; }
  function guardName(team, zone) {
    try { return (CFG.teams[team].zones[zone] || "").trim(); } catch (e) { return ""; }
  }

  /* ---------- notice helpers ---------- */
  function getNotice(id) { return BYID[id] || null; }
  function isArchived(n) { return n.status === "archived" || !!n.archivedAt; }
  function targetsOf(n) { return n.targets || []; }
  function buildingsOfTarget(t) {
    if (t.buildings === "all" || !t.buildings) return FAC.buildings.map(function (b) { return b.no; });
    return t.buildings.map(Number);
  }
  function applicableZones(n) {
    var set = {};
    targetsOf(n).forEach(function (t) {
      buildingsOfTarget(t).forEach(function (no) {
        var z = zoneOfBuilding(no);
        if (z) set[z] = true;
      });
    });
    return FAC.zones.map(function (z) { return z.id; }).filter(function (id) { return set[id]; });
  }
  function zoneCheck(n, kind, zone) { return (n[kind] || {})[zone] || null; }
  function attachedZones(n) { return Object.keys(n.attach || {}); }
  function allAttached(n) {
    var zs = applicableZones(n);
    return zs.length > 0 && zs.every(function (z) { return !!zoneCheck(n, "attach", z); });
  }
  function someAttached(n) { return attachedZones(n).length > 0; }
  function allDetached(n) {
    var zs = applicableZones(n);
    return zs.length > 0 && zs.every(function (z) { return !!zoneCheck(n, "detach", z); });
  }
  function needsRemove(n) {
    if (isArchived(n)) return false;
    if (n.permanent || !n.deadline) return false;
    return n.deadline <= TODAY;
  }
  function flowOf(n) {
    if (isArchived(n)) return "archived";
    if (!allAttached(n)) return someAttached(n) ? "attaching" : "pending";
    if (needsRemove(n)) return "removing";
    return "posted";
  }
  function statusOf(n) {
    if (isArchived(n)) return { key: "removed", label: STATUS_LABEL.removed, days: null };
    if (n.permanent || !n.deadline) return { key: "permanent", label: STATUS_LABEL.permanent, days: null };
    var d = diffDays(TODAY, n.deadline);
    if (d < 0) return { key: "overdue", label: STATUS_LABEL.overdue, days: -d };
    if (d === 0) return { key: "today", label: STATUS_LABEL.today, days: 0 };
    if (d === 1) return { key: "tomorrow", label: STATUS_LABEL.tomorrow, days: 1 };
    if (d <= 7) return { key: "soon", label: STATUS_LABEL.soon, days: d };
    return { key: "active", label: STATUS_LABEL.active, days: d };
  }
  function statusText(n) {
    var st = statusOf(n);
    if (st.key === "permanent") return "상시 (별도 지시 전까지 유지)";
    if (st.key === "removed") return "제거 완료 " + dotDate(n.archivedAt || "");
    if (st.key === "overdue") return "기한 " + dotDate(n.deadline) + " · " + st.days + "일 경과";
    if (st.key === "today") return "기한 " + dotDate(n.deadline) + " · 오늘 제거";
    if (st.key === "tomorrow") return "기한 " + dotDate(n.deadline) + " · 내일 제거";
    return "기한 " + dotDate(n.deadline) + " · D-" + st.days;
  }
  function worstStatus(list) {
    var best = null;
    list.forEach(function (it) {
      var k = statusOf(it.notice).key;
      if (k === "removed") return;
      if (best === null || STATUS_RANK[k] < STATUS_RANK[best]) best = k;
    });
    return best || "empty";
  }

  /* ---------- board index (게시된 구역만 노출) ---------- */
  function floorKey(f) { return f === "1층" ? "f1" : f === "지하1층" ? "fb1" : "fb2"; }
  function locLabel(locKey) { return ({ f1: "1층", fb1: "지하1층", fb2: "지하2층" })[locKey] || locKey; }
  function boardKey(no, core, loc, slot) { return no + "|" + core + "|" + loc + "|" + pad2(slot); }

  function buildIndex() {
    INDEX = Object.create(null);
    PLACE = Object.create(null);
    BSTAT = {};
    if (!FAC) return;                    // 시설 데이터 도착 전에는 도면 인덱스를 만들지 않는다
    FAC.buildings.forEach(function (b) { BSTAT[b.no] = { ids: {}, urgent: {}, sheets: 0, pending: 0 }; });

    NOTICES.forEach(function (n) {
      PLACE[n.id] = PLACE[n.id] || [];
      // 게시 대기 집계 (도면에는 표시하지 않음)
      if (!isArchived(n) && !allAttached(n)) {
        var zs = applicableZones(n);
        targetsOf(n).forEach(function (t) {
          buildingsOfTarget(t).forEach(function (no) {
            var z = zoneOfBuilding(no);
            if (BSTAT[no] && zs.indexOf(z) >= 0 && !zoneCheck(n, "attach", z)) {
              BSTAT[no].pending += 1;
            }
          });
        });
      }
      if (isArchived(n)) return;
      var placedZones = attachedZones(n);

      targetsOf(n).forEach(function (t) {
        var nos = buildingsOfTarget(t);
        nos.forEach(function (no) {
          var b = buildingByNo(no);
          if (!b) return;
          if (placedZones.indexOf(b.zone) < 0) return;  // 게시 완료된 구역만 도면 표시
          var coreSel = (t.cores && t.cores !== "all") ? t.cores.map(String) : null;
          b.cores.forEach(function (core) {
            if (coreSel && coreSel.indexOf(String(core.key)) < 0) return;   // 고른 라인만 도면에 표시
            var locs = [];
            if (t.board === "lobby") {
              var floors = (t.floors && t.floors.length) ? t.floors : FAC.boards.lobby.floors;
              floors.forEach(function (f) { locs.push({ key: floorKey(f), label: f, kind: "lobby", elevator: null }); });
            } else {
              core.elevators.forEach(function (e) {
                if (t.elevators && t.elevators !== "all" && (t.elevators || []).map(String).indexOf(String(e.key)) < 0) return;
                locs.push({ key: "e" + e.key, label: "엘리베이터 " + e.name, kind: "elevator", elevator: e });
              });
            }
            locs.forEach(function (loc) {
              var slot = pad2(t.slot);
              var key = boardKey(b.no, core.key, loc.key, slot);
              (INDEX[key] = INDEX[key] || []).push({ notice: n, order: t.order || 1 });
              PLACE[n.id].push({
                building: b.no, zone: b.zone, coreKey: core.key, coreName: core.name,
                locKey: loc.key, locLabel: loc.label, kind: loc.kind, elevator: loc.elevator,
                slot: slot, order: t.order || 1, key: key
              });
            });
          });
        });
      });
    });

    Object.keys(INDEX).forEach(function (k) {
      INDEX[k].sort(function (a, b) { return a.order - b.order; });
    });

    NOTICES.forEach(function (n) {
      if (isArchived(n)) return;
      var st = statusOf(n);
      var urgent = (st.key === "overdue" || st.key === "today" || st.key === "tomorrow");
      (PLACE[n.id] || []).forEach(function (p) {
        var s = BSTAT[p.building];
        if (!s) return;
        s.ids[n.id] = true;
        s.sheets++;
        if (urgent) s.urgent[n.id] = true;
      });
    });
  }

  function slotItems(no, coreKey, locKey, slot) { return INDEX[boardKey(no, coreKey, locKey, slot)] || []; }
  function placementsOf(id) { return PLACE[id] || []; }

  /* ---------- 겹침 순번(order) 자동 관리 ----------
     order 1 = 맨 앞(가장 나중에 게시한 것), 숫자가 클수록 뒤(아래)로 밀린 것.
     신규 게시물은 1번째로 들어가고, 같은 자리에 이미 게시되어 있는 게시물은 한 칸씩 뒤로 밀린다.
     같은 자리 = 같은 게시판(board) + 같은 번호(slot) + 겹치는 층(공동현관)/호기(엘리베이터) + 겹치는 동 */
  var ELEV_KEYS_CACHE = null;
  function allElevKeys() {
    if (ELEV_KEYS_CACHE) return ELEV_KEYS_CACHE;
    var keys = [];
    (FAC && FAC.buildings ? FAC.buildings : []).forEach(function (b) {
      (b.cores || []).forEach(function (c) {
        (c.elevators || []).forEach(function (e) {
          var k = String(e.key);
          if (keys.indexOf(k) < 0) keys.push(k);
        });
      });
    });
    ELEV_KEYS_CACHE = keys.length ? keys : ["1", "2"];
    return ELEV_KEYS_CACHE;
  }
  function lobbyFloorsOf(t) {
    return (t.floors && t.floors.length) ? t.floors.slice() : FAC.boards.lobby.floors.slice();
  }
  function elevKeysOf(t) {
    if (t.elevators && t.elevators !== "all") return (t.elevators || []).map(String);
    return allElevKeys().slice();
  }
  function targetOverlaps(a, b) {
    if (!a || !b) return false;
    var ba = a.board || "lobby", bb = b.board || "lobby";
    if (ba !== bb) return false;
    if (!a.slot || !b.slot || pad2(a.slot) !== pad2(b.slot)) return false;
    // 동이 하나도 겹치지 않으면 서로 다른 게시판이므로 밀지 않는다
    var na = buildingsOfTarget(a), nb = buildingsOfTarget(b);
    var sameBuilding = na.some(function (no) { return nb.indexOf(no) >= 0; });
    if (!sameBuilding) return false;
    if (ba === "lobby") {
      var fa = lobbyFloorsOf(a), fb = lobbyFloorsOf(b);
      return fa.some(function (f) { return fb.indexOf(f) >= 0; });
    }
    var ea = elevKeysOf(a), eb = elevKeysOf(b);
    return ea.some(function (k) { return eb.indexOf(k) >= 0; });
  }
  function orderNum(v) {
    var n = Number(v);
    return (isFinite(n) && n >= 1) ? Math.floor(n) : 1;
  }
  /* 두 대상이 게시판·번호·층/호기·동·순번까지 같은 자리인지 */
  function sameTarget(a, b) {
    if ((a.board || "lobby") !== (b.board || "lobby")) return false;
    if (pad2(a.slot) !== pad2(b.slot)) return false;
    if (orderNum(a.order) !== orderNum(b.order)) return false;
    if ((b.board || "lobby") === "lobby") {
      var fa = lobbyFloorsOf(a), fb = lobbyFloorsOf(b);
      if (fa.length !== fb.length || !fa.every(function (f) { return fb.indexOf(f) >= 0; })) return false;
    } else {
      var ea = elevKeysOf(a), eb = elevKeysOf(b);
      if (ea.length !== eb.length || !ea.every(function (k) { return eb.indexOf(k) >= 0; })) return false;
    }
    var ba = buildingsOfTarget(a), bb = buildingsOfTarget(b);
    return ba.length === bb.length && ba.every(function (no) { return bb.indexOf(no) >= 0; });
  }

  /* 신규 게시물의 대상(newTargets)과 겹치는 활성 게시물의 order 를 +1 씩 올린다.
     반환 { updates: {경로: 값}, pushed: [{id,title,from,to}] } — 한 번의 update()로 함께 저장한다. */
  function pushOrdersForNew(newTargets, excludeId) {
    var updates = {}, pushed = [];
    NOTICES.forEach(function (n) {
      if (n.id === excludeId || isArchived(n)) return;
      var moved = false;
      targetsOf(n).forEach(function (t, i) {
        var hit = newTargets.some(function (nt) { return targetOverlaps(nt, t); });
        if (!hit) return;
        var from = orderNum(t.order), to = from + 1;
        updates["board/notices/" + n.id + "/targets/" + i + "/order"] = to;
        if (!moved) { pushed.push({ id: n.id, title: n.title, from: from, to: to }); moved = true; }
      });
    });
    return { updates: updates, pushed: pushed };
  }

  /* 제거·삭제로 자리가 비었을 때 남은 활성 게시물의 순번을 1,2,3… 으로 다시 이어 붙인다.
     반환 { updates: {경로: 값}, changed: [{id,title,from,to}] } */
  function compactOrders(removedTargets, excludeIds) {
    var skip = {};
    (excludeIds || []).forEach(function (id) { skip[id] = true; });
    var cands = [];
    NOTICES.forEach(function (n) {
      if (skip[n.id] || isArchived(n)) return;
      targetsOf(n).forEach(function (t, i) {
        var hit = (removedTargets || []).some(function (rt) { return targetOverlaps(rt, t); });
        if (!hit) return;
        cands.push({ id: n.id, idx: i, order: orderNum(t.order), createdAt: n.createdAt || 0, title: n.title });
      });
    });
    cands.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;  // 같은 순번이면 최근 등록이 앞
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var updates = {}, changed = [];
    cands.forEach(function (c, i) {
      var want = i + 1;
      if (c.order === want) return;
      updates["board/notices/" + c.id + "/targets/" + c.idx + "/order"] = want;
      changed.push({ id: c.id, title: c.title, from: c.order, to: want });
    });
    return { updates: updates, changed: changed };
  }

  /* 지금 이 자리에 몇 장이 어떤 순번으로 게시되어 있는지 (등록 화면 안내용) */
  function stackedHere(t, excludeId) {
    var out = [];
    NOTICES.forEach(function (n) {
      if (n.id === excludeId || isArchived(n)) return;
      var best = null;
      targetsOf(n).forEach(function (tt) {
        if (!targetOverlaps(t, tt)) return;
        var o = orderNum(tt.order);
        if (best === null || o < best) best = o;
      });
      if (best !== null) out.push({ notice: n, order: best });
    });
    out.sort(function (a, b) { return a.order - b.order; });
    return out;
  }

  /* ---------- summary ---------- */
  function summary() {
    var s = { overdue: 0, today: 0, tomorrow: 0, soon: 0, active: 0, permanent: 0, removed: 0 };
    var sheets = 0, posted = 0, pending = 0, removing = 0;
    NOTICES.forEach(function (n) {
      var k = statusOf(n).key;
      if (k === "removed") { s.removed++; return; }
      s[k] = (s[k] || 0) + 1;
      var fl = flowOf(n);
      if (fl === "posted") posted++;
      if (fl === "pending" || fl === "attaching") pending++;
      if (fl === "removing") removing++;
      sheets += (PLACE[n.id] || []).length;
    });
    return {
      counts: s, sheetsTotal: sheets, posted: posted, pending: pending, removing: removing,
      action: s.overdue + s.today
    };
  }

  /* ---------- texts ---------- */
  function floorsText(floors) { return floors.join("·"); }
  function buildingListText(list) {
    if (!list || !list.length) return "";
    if (list.length <= 3) return list.map(function (n) { return n + "동"; }).join("·");
    return list.slice(0, 3).map(function (n) { return n + "동"; }).join("·") + " 외 " + (list.length - 3) + "개동";
  }
  function slotPos(board, slot) {
    slot = pad2(slot);
    if (board === "elevator") {
      if (slot === "05") return "정면(거울 아래)";
      if (slot === "06") return "좌측";
      if (slot === "04") return "우측 액자 위";
      return "우측 액자";
    }
    return "";
  }
  function orderText(o) { return (!o || o === 1) ? "" : " (" + o + "번째)"; }
  function targetText(t) {
    var b = (t.buildings === "all" || !t.buildings)
      ? "전체 " + FAC.buildings.length + "개동"
      : buildingListText(t.buildings);
    if (t.board === "lobby") {
      var floors = (t.floors && t.floors.length) ? t.floors : FAC.boards.lobby.floors;
      return b + " · 공동현관 " + floorsText(floors) + " " + pad2(t.slot) + "번" + orderText(t.order);
    }
    var e = (t.elevators && t.elevators !== "all") ? (t.elevators.length + "개 호기") : "엘리베이터 전체";
    return b + " · " + e + " · " + slotPos("elevator", t.slot) + " " + pad2(t.slot) + "번" + orderText(t.order);
  }
  function targetShort(t) {
    if (t.board === "lobby") return "공동현관 " + pad2(t.slot) + "번" + orderText(t.order);
    return "엘리베 " + pad2(t.slot) + "번" + orderText(t.order);
  }
  function targetsText(n) { return targetsOf(n).map(targetText).join(" / "); }
  function targetsShort(n) { return targetsOf(n).map(targetShort).join(" / "); }

  /* ---------- toast / sheet ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  function openSheet(opts) {
    var root = document.getElementById("overlayRoot");
    root.innerHTML = '<div class="backdrop" data-act="close-sheet"></div>' +
      '<div class="sheet" id="sheet" data-form="' + (opts.form ? "1" : "0") + '">' +
      '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><div><div class="sheet-title">' + esc(opts.title || "") + "</div>" +
      (opts.sub ? '<div class="sheet-sub">' + esc(opts.sub) + "</div>" : "") + "</div>" +
      '<button class="sheet-close" data-act="close-sheet" aria-label="닫기">×</button></div>' +
      '<div class="sheet-body">' + (opts.html || "") + "</div></div>";
    var bd = root.querySelector(".backdrop"), sh = root.querySelector(".sheet");
    requestAnimationFrame(function () {
      if (bd) bd.classList.add("on");
      if (sh) sh.classList.add("on");
    });
    if (opts.onMount) opts.onMount(sh);
    return sh;
  }
  function closeSheet() {
    var root = document.getElementById("overlayRoot");
    var sh = root.querySelector(".sheet");
    if (!sh) { root.innerHTML = ""; return; }
    var wasForm = sh.dataset.form === "1";
    sh.classList.remove("on");
    var bd = root.querySelector(".backdrop");
    if (bd) bd.classList.remove("on");
    setTimeout(function () { if (root.querySelector(".sheet") === sh) root.innerHTML = ""; }, 200);
    if (VIEW.slot) go("#/b/" + VIEW.no + "/" + VIEW.core + "/" + VIEW.loc);
    else if (LOADED && wasForm) render();   // 폼에서 저장·삭제 후 목록을 즉시 반영
  }

  function openLightbox(src, cap, dl) {
    var lb = document.createElement("div");
    lb.className = "lightbox" + (dl ? " with-dl" : "");
    lb.innerHTML = '<button class="lb-close" aria-label="닫기">×</button><img src="' + esc(src) + '" alt="">' +
      '<div class="lb-cap">' + esc(cap || "") + "</div>" +
      (dl ? '<div class="lb-actions"><a class="lb-dl" href="' + esc(src) + '" download="' + esc(dl) + '">이미지 저장</a></div>' : "");
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-close")) lb.remove();
    });
    document.body.appendChild(lb);
  }

  /* ---------- session / identity ---------- */
  function loadSession() {
    try {
      var raw = localStorage.getItem("gf.session");
      if (raw) {
        var s = JSON.parse(raw);
        SESSION.role = s.role || null;
        SESSION.team = s.team || "A";
        SESSION.zone = s.zone || "front";
        SESSION.name = s.name || "";
        SESSION.admin = s.admin || "";
      }
    } catch (e) {}
    try { FONT_LG = localStorage.getItem("gf.fontLg") === "1"; } catch (e) {}
  }
  function saveSession() {
    try { localStorage.setItem("gf.session", JSON.stringify(SESSION)); } catch (e) {}
    syncWho();
  }
  function syncWho() {
    var btn = document.getElementById("whoBtn");
    if (!btn) return;
    if (SESSION.role === "admin") {
      btn.textContent = "관리자 " + SESSION.admin;
      btn.classList.add("admin");
    } else if (SESSION.role === "guard" && SESSION.name) {
      btn.textContent = SESSION.team + "조 " + zoneShort(SESSION.zone) + " " + SESSION.name;
      btn.classList.remove("admin");
    } else {
      btn.textContent = "조회 중";
      btn.classList.remove("admin");
    }
  }
  function actor() {
    if (SESSION.role === "admin") return { name: SESSION.admin, team: "관리" };
    if (SESSION.role === "guard" && SESSION.name) return { name: SESSION.name, team: SESSION.team };
    return null;
  }
  function requireGuard(cb) {
    var a = actor();
    if (a) { cb(a); return; }
    openWhoSheet(function () { var a2 = actor(); if (a2) cb(a2); });
  }
  function requireAdmin(cb) {
    if (SESSION.role === "admin") { cb(); return; }
    openAdminLogin(cb);
  }
  function openWhoSheet(onDone) {
    var html = '<p class="f-hint" style="margin:0 2px 10px">게시·제거 체크는 담당자 확인 후 기록됩니다. 내 조와 구역을 고르세요. (이 기기에 기억됩니다)</p>';
    html += '<div class="pick">';
    ["A", "B"].forEach(function (t) {
      html += '<div class="pick-row"><div class="pick-head">' + t + "조</div>";
      FAC.zones.forEach(function (z) {
        var nm = guardName(t, z.id);
        html += '<button class="pick-btn" data-act="pick-guard" data-team="' + t + '" data-zone="' + z.id + '">' +
          '<span style="display:block;font-size:.6rem;color:var(--muted);font-weight:700">' + esc(z.name) + "</span>" +
          esc(nm || "미지정") + "</button>";
      });
      html += "</div>";
    });
    html += "</div>";
    html += '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn line" data-act="who-logout" style="flex:1">선택 해제</button>' +
      '<button class="btn soft" data-act="admin-login" style="flex:1">관리자</button></div>';
    openSheet({ title: "담당자 선택", sub: "읽기는 누구나 가능합니다", html: html });
    pendingWhoCb = onDone || null;
  }
  var pendingWhoCb = null;

  function pickGuard(team, zone) {
    SESSION.role = "guard";
    SESSION.team = team;
    SESSION.zone = zone;
    SESSION.name = guardName(team, zone) || (team + "조 " + zoneShort(zone));
    saveSession();
    toast(SESSION.team + "조 " + zoneShort(zone) + " " + SESSION.name + " 님으로 기록합니다");
    closeSheet();
    var cb = pendingWhoCb; pendingWhoCb = null;
    if (cb) setTimeout(cb, 60);
    else render();
  }

  async function hashPin(pin) {
    if (!window.crypto || !crypto.subtle) return null;
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PIN_SALT + pin));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function openAdminLogin(onDone) {
    var html = '<p class="f-hint" style="margin:0 2px 6px">관리자(카일·관리사무소)만 등록·수정·삭제할 수 있습니다. PIN 4자리를 입력하세요.</p>';
    html += '<div class="f-chips" style="margin:8px 0 6px">';
    (CFG.admins || []).forEach(function (a) {
      html += '<button class="f-chip' + (a === SESSION.admin ? " on" : "") + '" data-act="pick-admin" data-name="' + esc(a) + '">' + esc(a) + "</button>";
    });
    html += "</div>";
    html += '<input class="pin-dot" id="pinView" readonly value="" style="width:100%;letter-spacing:10px;text-align:center" inputmode="numeric" aria-label="PIN">';
    html += '<div class="keypad">';
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (k) {
      html += '<button class="key" data-act="pin-key" data-k="' + k + '">' + k + "</button>";
    });
    html += '<button class="key" data-act="pin-key" data-k="del">⌫</button>';
    html += '<button class="key" data-act="pin-key" data-k="0">0</button>';
    html += '<button class="key" data-act="pin-submit">확인</button>';
    html += "</div>";
    openSheet({ title: "관리자 인증", sub: "PIN 4자리", html: html, form: true });
    pinBuf = "";
    if (!SESSION.admin) SESSION.admin = (CFG.admins || [])[0] || "";
    pendingAdminCb = onDone || null;
  }
  var pinBuf = "";
  var pendingAdminCb = null;

  function pinKey(k) {
    if (k === "del") pinBuf = pinBuf.slice(0, -1);
    else if (pinBuf.length < 4) pinBuf += k;
    var v = document.getElementById("pinView");
    if (v) v.value = pinBuf.replace(/./g, "●");
    if (pinBuf.length === 4) setTimeout(pinSubmit, 120);
  }
  async function pinSubmit() {
    if (pinBuf.length !== 4) { toast("PIN 4자리를 입력하세요"); return; }
    var h = await hashPin(pinBuf);
    var ok = h && (h === (CFG.pinHash || DEFAULT_PIN_HASH));
    if (!ok) {
      pinBuf = "";
      var v = document.getElementById("pinView");
      if (v) v.value = "";
      toast("PIN이 맞지 않습니다");
      return;
    }
    SESSION.role = "admin";
    if (!SESSION.admin) SESSION.admin = (CFG.admins || [])[0] || "관리자";
    saveSession();
    pinBuf = "";
    toast("관리자로 인증되었습니다");
    closeSheet();
    var cb = pendingAdminCb; pendingAdminCb = null;
    if (cb) setTimeout(cb, 60);
    else render();
  }

  /* ---------- firebase write helpers ---------- */
  function fbUpdate(obj) {
    return db.ref().update(obj).then(function () { return true; })
      .catch(function (e) { toast("저장 실패: " + (e && e.message ? e.message : e)); return false; });
  }
  function fbSet(path, val) {
    return db.ref(path).set(val).then(function () { return true; })
      .catch(function (e) { toast("저장 실패: " + (e && e.message ? e.message : e)); return false; });
  }
  function fbRemove(path) {
    return db.ref(path).remove().then(function () { return true; })
      .catch(function (e) { toast("저장 실패: " + (e && e.message ? e.message : e)); return false; });
  }
  function writeLog(entry) {
    try { db.ref("board/logs").push(entry); } catch (e) {}
  }

  /* ---------- zone check actions ---------- */
  function checkTeamOf(n, zone, st) {
    if (!st) return "";
    if (st.team === "A" || st.team === "B") return st.team;
    if (st.by && guardName("A", zone) === st.by) return "A";
    if (st.by && guardName("B", zone) === st.by) return "B";
    return "";
  }
  function toggleZoneCheck(id, kind, zone, team) {
    var n = getNotice(id);
    if (!n) return;
    var existing = zoneCheck(n, kind, zone);
    var existingTeam = checkTeamOf(n, zone, existing);
    if (existing && (!team || existingTeam === team)) {
      if (SESSION.role !== "admin") {
        toast(kind === "attach"
          ? "이미 " + (existing.by || "담당자") + " 님이 게시 완료했습니다 (해제는 관리자만)"
          : "이미 " + (existing.by || "담당자") + " 님이 제거 완료했습니다 (해제는 관리자만)");
        return;
      }
      var path = "board/notices/" + id + "/" + kind + "/" + zone;
      fbUpdate({}).then(function () {});
      db.ref(path).remove().then(function () {
        writeLog({ noticeId: id, type: kind + "_undo", zone: zone, by: actor() ? actor().name : "", at: nowTs(), title: n.title });
        toast((kind === "attach" ? "게시" : "제거") + " 체크를 해제했습니다");
        afterZoneChange(id);
      }).catch(function (e) { toast("저장 실패: " + e.message); });
      return;
    }
    if (existing && team && existingTeam && existingTeam !== team && SESSION.role !== "admin") {
      toast("이미 " + existingTeam + "조(" + (existing.by || "담당자") + ")에서 " + (kind === "attach" ? "게시" : "제거") + " 완료했습니다 (변경은 관리자만)");
      return;
    }
    requireGuard(function (a) {
      var recTeam = (SESSION.role === "admin" && (team === "A" || team === "B")) ? team : (a.team || team);
      var recBy = (SESSION.role === "admin" && (team === "A" || team === "B")) ? (guardName(team, zone) || a.name) : a.name;
      var updates = {};
      updates["board/notices/" + id + "/" + kind + "/" + zone] =
        { by: recBy, team: recTeam, at: nowTs() };
      var status = n.status;
      var attachState = Object.assign({}, n.attach || {});
      var detachState = Object.assign({}, n.detach || {});
      if (kind === "attach") {
        attachState[zone] = { by: recBy, team: recTeam, at: nowTs() };
        updates["board/notices/" + id + "/status"] = "posted";
      } else {
        detachState[zone] = { by: recBy, team: recTeam, at: nowTs() };
        var zs = applicableZones(n);
        var allDone = zs.every(function (z) { return !!detachState[z]; });
        if (allDone) {
          updates["board/notices/" + id + "/status"] = "archived";
          updates["board/notices/" + id + "/archivedAt"] = TODAY;
        }
      }
      updates["board/notices/" + id + "/updatedAt"] = nowTs();
      // 제거 완료로 보관함에 들어가면 남은 게시물의 순번을 1,2,3… 으로 이어 붙인다
      if (updates["board/notices/" + id + "/status"] === "archived") {
        var comp = compactOrders(targetsOf(n), [id]);
        Object.keys(comp.updates).forEach(function (k) { updates[k] = comp.updates[k]; });
      }
      fbUpdate(updates).then(function (ok) {
        if (!ok) return;
        writeLog({
          noticeId: id, type: kind, zone: zone, by: recBy, team: recTeam, at: nowTs(), title: n.title
        });
        toast((kind === "attach" ? "게시 완료" : "제거 완료") + " · " + zoneName(zone) + " (" + recTeam + "조 " + recBy + ")");
      });
    });
  }
  function afterZoneChange(id) { /* 리스너가 갱신하므로 화면은 자동 반영 */ }

  /* ---------- deadline change ---------- */
  function openDeadlineSheet(id) {
    var n = getNotice(id);
    if (!n) return;
    var html = '<p class="f-hint" style="margin:0 2px 8px">현장 상황에 따라 기한을 조정합니다. 변경 사유는 기록에 남습니다.</p>';
    html += '<div class="fld"><label>현재 기한</label><div class="f-in" style="background:#f7f9fb">' +
      (n.permanent ? "상시" : dotDate(n.deadline)) + "</div></div>";
    html += '<div class="fld"><label>새 기한 <span class="req">*</span></label>' +
      '<input type="date" class="f-in" id="dlNew" value="' + (n.deadline || TODAY) + '"></div>';
    html += '<div class="fld"><label>변경 사유 (선택)</label>' +
      '<input class="f-in" id="dlNote" placeholder="예: 공사 지연으로 2일 연장"></div>';
    html += '<div class="form-actions"><button class="btn line" data-act="close-sheet" style="flex:1">취소</button>' +
      '<button class="btn solid" data-act="dl-save" data-id="' + esc(id) + '" style="flex:1">기한 변경</button></div>';
    openSheet({ title: "기한 변경", sub: n.title, html: html, form: true });
  }
  function saveDeadline(id) {
    var n = getNotice(id);
    if (!n) return;
    var val = (document.getElementById("dlNew") || {}).value;
    var note = ((document.getElementById("dlNote") || {}).value || "").trim();
    if (!val) { toast("새 기한을 선택하세요"); return; }
    requireGuard(function (a) {
      var updates = {};
      updates["board/notices/" + id + "/deadline"] = val;
      updates["board/notices/" + id + "/permanent"] = false;
      updates["board/notices/" + id + "/updatedAt"] = nowTs();
      updates["board/notices/" + id + "/deadlineChanged"] = { by: a.name, at: nowTs(), from: n.deadline || "", to: val, note: note };
      fbUpdate(updates).then(function (ok) {
        if (!ok) return;
        writeLog({ noticeId: id, type: "deadline", by: a.name, team: a.team, at: nowTs(), note: note, from: n.deadline, to: val, title: n.title });
        closeSheet();
        toast("기한을 " + dotDate(val) + "로 변경했습니다");
      });
    });
  }

  /* ---------- notice sheet ---------- */
  function openNoticeSheet(id) {
    var n = getNotice(id);
    if (!n) return;
    var fl = flowOf(n);
    var flowPill = fl === "pending" ? '<span class="pill pending">게시 대기</span>'
      : fl === "attaching" ? '<span class="pill pending">게시 진행</span>'
        : fl === "removing" ? '<span class="pill overdue">제거 필요</span>'
          : fl === "archived" ? '<span class="pill removed">보관함</span>'
            : '<span class="pill active">게시 중</span>';
    var html = '<div style="display:flex;gap:12px">' +
      '<div style="flex:1 1 auto;min-width:0">' +
      '<div style="font-size:1rem;font-weight:800;line-height:1.35;word-break:keep-all">' + esc(n.title) + "</div>" +
      '<div class="notice-meta" style="margin-top:8px">' + flowPill + testTag(n) + "</div>" +
      '<div class="notice-date" style="margin-top:8px">' + esc(statusText(n)) + "</div>" +
      '<div class="notice-date" style="margin-top:2px">게시 ' + dotDate(n.postedAt) + " · " + esc(n.category || "안내문") + "</div>" +
      (n.memo ? '<div class="notice-memo">' + esc(n.memo) + "</div>" : "") +
      "</div>" +
      (n.photo ? '<button class="thumb" data-act="zoom" data-src="' + esc(n.photo) + '" data-cap="' + esc(n.title) + '"><img src="' + esc(n.photo) + '" alt=""></button>' : '<div class="thumb noimg">사진<br>없음</div>') +
      "</div>";
    html += '<div style="margin-top:14px;font-size:.74rem;color:var(--ink-2);line-height:1.7">' +
      "<b>게시 위치</b> " + esc(targetsText(n)) + "<br>" +
      "<b>대상 구역</b> " + applicableZones(n).map(function (z) { return esc(zoneName(z)); }).join("·") + "</div>";

    // 구역별 게시/제거 기록
    html += '<div style="margin-top:12px"><div class="sec-h" style="margin:0 0 6px"><h3>구역별 기록</h3></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:.7rem">' +
      '<tr style="color:var(--muted)"><th style="text-align:left;padding:3px 2px">구역</th><th style="padding:3px 2px">게시</th><th style="padding:3px 2px">제거</th></tr>';
    applicableZones(n).forEach(function (z) {
      var a = zoneCheck(n, "attach", z), d = zoneCheck(n, "detach", z);
      html += "<tr><td style='padding:4px 2px;font-weight:700'>" + esc(zoneName(z)) + "</td>" +
        "<td style='text-align:center'>" + (a ? "☑ " + esc(a.by) + "<br><span style='color:var(--muted)'>" + tsText(a.at) + "</span>" : "☐") + "</td>" +
        "<td style='text-align:center'>" + (d ? "☑ " + esc(d.by) + "<br><span style='color:var(--muted)'>" + tsText(d.at) + "</span>" : "☐") + "</td></tr>";
    });
    html += "</table></div>";

    var btns = "";
    btns += '<div class="form-actions" style="flex-wrap:wrap">';
    btns += '<button class="btn line" data-act="dl-open" data-id="' + esc(id) + '">기한 변경</button>';
    if (SESSION.role === "admin") {
      btns += '<button class="btn soft" data-act="edit-notice" data-id="' + esc(id) + '">수정</button>';
      if (!isArchived(n)) {
        btns += '<button class="btn line" data-act="force-archive" data-id="' + esc(id) + '">제거 완료 처리</button>';
      }
      btns += '<button class="btn danger" data-act="del-notice" data-id="' + esc(id) + '">삭제</button>';
    }
    btns += "</div>";
    if (isArchived(n)) {
      btns += '<div class="form-actions"><button class="btn solid" data-act="' + (SESSION.role === "admin" ? "repost" : "ask-admin") + '" data-id="' + esc(id) + '">신규 게시로 재등록</button></div>';
    }
    html += btns;
    openSheet({ title: "게시물 상세", sub: mmdd(n.postedAt) + " 게시", html: html });
  }
  function statusPill(n) {
    var st = statusOf(n);
    var extra = "";
    if (st.key === "overdue") extra = " " + st.days + "일";
    else if (st.key === "soon") extra = " D-" + st.days;
    return '<span class="pill ' + st.key + '">' + esc(st.label + extra) + "</span>";
  }
  /* 게시 전 게시물은 '게시 중' 대신 '게시 전'으로 표시 */
  function statusPillFor(n) {
    var fl = flowOf(n);
    if (fl === "pending" || fl === "attaching") {
      return '<span class="pill pending">' + (n.permanent ? "상시 · 게시 전" : "게시 전") + "</span>";
    }
    return statusPill(n);
  }
  function testTag(n) { return n.isTest ? '<span class="pill test">테스트</span>' : ""; }

  /* =========================================================
     VIEWS
     ========================================================= */
  function renderStats(s) {
    return '<div class="stats">' +
      '<div class="stat danger"><span class="stat-num">' + s.counts.overdue + '</span><span class="stat-label">기한 경과</span></div>' +
      '<div class="stat warn"><span class="stat-num">' + s.counts.today + '</span><span class="stat-label">오늘 제거</span></div>' +
      '<div class="stat info"><span class="stat-num">' + s.pending + '</span><span class="stat-label">게시 대기</span></div>' +
      '<div class="stat ok"><span class="stat-num">' + s.posted + '</span><span class="stat-label">게시 중</span></div>' +
      "</div>";
  }
  function renderHero(s) {
    var cls, title, sub;
    if (s.counts.overdue > 0) {
      cls = "danger";
      title = "오늘 제거 대상 " + (s.counts.overdue + s.counts.today) + "건";
      sub = "기한이 지난 게시물이 " + s.counts.overdue + "건 그대로 게시되어 있습니다." +
        (s.counts.today ? " 오늘 기한 도래 " + s.counts.today + "건." : "") + " 근무 중 바로 제거해 주세요.";
    } else if (s.counts.today > 0) {
      cls = "warn";
      title = "오늘 제거 대상 " + s.counts.today + "건";
      sub = "오늘 기한이 끝나는 게시물입니다. 퇴근 전 제거 확인해 주세요.";
    } else if (s.pending > 0) {
      cls = "warn";
      title = "게시할 게시물 " + s.pending + "건";
      sub = "관리자가 등록한 게시물이 게시를 기다리고 있습니다. 게시 체크 후 게시판에 반영됩니다.";
    } else {
      cls = "ok";
      title = "오늘 제거 대상 없음";
      sub = "기한이 지났거나 오늘 끝나는 게시물이 없습니다.";
    }
    var extra = s.counts.tomorrow > 0 ? " 내일 제거 예정 " + s.counts.tomorrow + "건." : "";
    return '<section class="hero ' + cls + '">' +
      '<div class="hero-kicker">' + korDate(TODAY) + " (" + weekday(TODAY) + ") 기준 · 게시판 " + num(s.sheetsTotal) + "장 게시 중</div>" +
      '<div class="hero-title">' + esc(title) + "</div>" +
      '<div class="hero-sub">' + esc(sub + extra) + "</div>" +
      '<div class="hero-actions">' +
      '<button class="btn primary" data-act="copy" data-kind="today">' +
      '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>' +
      "오늘 제거 목록 복사</button>" +
      '<button class="btn ghost" data-act="go" data-go="#/deploy">체크하러 가기</button>' +
      "</div></section>";
  }
  function renderZones() {
    var counts = {};
    FAC.buildings.forEach(function (b) { counts[b.zone] = (counts[b.zone] || 0) + 1; });
    var h = '<div class="chips chip-zone" role="tablist" aria-label="담당 구역">';
    h += '<button class="chip ' + (ZONE === "all" ? "on" : "") + '" data-act="zone" data-zone="all">전체<span class="n">' + FAC.buildings.length + "</span></button>";
    FAC.zones.forEach(function (z) {
      h += '<button class="chip ' + (ZONE === z.id ? "on" : "") + '" data-act="zone" data-zone="' + z.id + '">' +
        esc(z.name) + '<span class="n">' + (counts[z.id] || 0) + "</span></button>";
    });
    return h + "</div>";
  }
  function renderBuildingGrid() {
    var list = FAC.buildings.filter(function (b) { return ZONE === "all" || b.zone === ZONE; });
    var h = '<div class="bgrid">';
    list.forEach(function (b) {
      var st = BSTAT[b.no] || { ids: {}, urgent: {}, sheets: 0, pending: 0 };
      var ids = Object.keys(st.ids).length;
      var urgent = Object.keys(st.urgent).length;
      h += '<button class="btile' + (urgent ? " has-urgent" : "") + '" data-act="building" data-no="' + b.no + '">' +
        (urgent ? '<span class="btile-dot">' + urgent + "</span>" : "") +
        '<span class="btile-no">' + b.no + "<small>동</small></span>" +
        '<span class="btile-meta">게시 ' + ids + " · " + num(st.sheets) + "장</span>" +
        (st.pending ? '<span class="btile-pending">게시 ' + st.pending + "</span>" : "") +
        "</button>";
    });
    h += "</div>";
    h += '<p class="note">동을 누르면 라인·층·엘리베이터별 게시판 그림이 열립니다. 빨간 숫자는 오늘 제거할 게시물 수입니다. 게시 완료 전 게시물은 그림에 나타나지 않습니다.</p>';
    return h;
  }
  function renderFacility() {
    var rows = FAC.zones.map(function (z) {
      var bs = FAC.buildings.filter(function (b) { return b.zone === z.id; });
      var cores = bs.reduce(function (a, b) { return a + b.cores.length; }, 0);
      var els = bs.reduce(function (a, b) { return a + b.cores.reduce(function (c, cc) { return c + cc.elevators.length; }, 0); }, 0);
      var who = "A " + (guardName("A", z.id) || "-") + " · B " + (guardName("B", z.id) || "-");
      return "<tr><th>" + esc(z.name) + "</th><td>" + bs.length + "개동 · " + cores + "코어 · 공동현관 " + (cores * 3) + "게시판 · 엘리베이터 " + els + "대<br><span style='color:var(--muted)'>" + esc(who) + "</span></td></tr>";
    }).join("");
    return '<details class="facility"><summary>단지 시설·담당 현황 보기</summary><div class="fbody">' +
      "<table>" + rows + "</table>" +
      '<p style="margin-top:8px">공동현관 홀은 01~12번(2줄 × 6칸), 엘리베이터는 01~06번입니다. 한 번호에 게시물이 여러 장 겹치면 순번(1번째·2번째)으로 구분합니다.</p>' +
      "</div></details>";
  }
  function syncBar() {
    return '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 8px">' +
      '<span class="sync"><i class="dot ' + (CONNECTED ? "on" : "off") + '"></i>' + (CONNECTED ? "실시간 연결됨" : "연결 중…") + "</span>" +
      '<span style="flex:1"></span>' +
      '<button class="mini-btn" data-act="go" data-go="#/deploy">게시·제거 ' + (summary().pending + summary().removing) + "건</button>" +
      "</div>";
  }

  /* ========================================================
     첫 화면 — 7개 네잎클로버 메뉴 포털
     ======================================================== */
  function cloverSvg() {
    /* 네잎클로버 — 잎은 바깥쪽이 넓고 가운데가 파인 하트 모양, 네 장으로 회전 배치 */
    var leaf = "M12 13.4 C8.6 10.7 7.4 8.6 7.4 6.9 C7.4 5.3 8.6 4.2 10 4.2 C11 4.2 11.7 4.8 12 5.5 C12.3 4.8 13 4.2 14 4.2 C15.4 4.2 16.6 5.3 16.6 6.9 C16.6 8.6 15.4 10.7 12 13.4 Z";
    var tf = function (deg) {
      return ' transform="translate(12 12) rotate(' + deg + ') scale(.8) translate(-12 -12)"';
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12.2 12.2c0 4.6-.7 8-1.6 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity=".5"/>' +
      '<path d="' + leaf + '" fill="currentColor"' + tf(0) + "/>" +
      '<path d="' + leaf + '" fill="currentColor"' + tf(90) + "/>" +
      '<path d="' + leaf + '" fill="currentColor"' + tf(180) + "/>" +
      '<path d="' + leaf + '" fill="currentColor"' + tf(270) + "/>" +
      "</svg>";
  }
  function menuRow(go, title, desc, badge, id) {
    var b = badge ? '<span class="menu-badge"' + (id ? ' id="' + id + '"' : "") + ">" + (badge > 99 ? "99+" : badge) + "</span>" : "";
    return '<button class="menu-row" data-act="go" data-go="' + esc(go) + '">' +
      '<span class="menu-ico">' + cloverSvg() + "</span>" +
      '<span class="menu-main"><span class="menu-title">' + esc(title) + "</span>" +
      '<span class="menu-desc">' + esc(desc) + "</span></span>" + b +
      '<span class="menu-arrow">›</span></button>';
  }
  function todayAlert() {
    var t = null;
    ALERTS.forEach(function (a) { if (a.date === TODAY) t = a; });
    return t;
  }
  function renderPortal() {
    var s = summary();
    var al = todayAlert();
    var nAlert = al ? alertItems(al).length : 0;
    var removeToday = s.counts.overdue + s.counts.today;
    var h = '<section class="pcard">' +
      '<span class="pdot' + (CONNECTED ? "" : " off") + '"><i></i>' + (CONNECTED ? "실시간 연결됨" : "연결 중…") + "</span>" +
      '<div class="pcard-title">게시판 관리 시스템</div>' +
      '<div class="pcard-sub">운정 제일풍경채 그랑퍼스트 · 별하람마을 1단지</div>' +
      '<div class="psum">' +
      '<span' + (removeToday ? ' class="urgent"' : "") + ">오늘 제거 <b>" + removeToday + "</b>건</span>" +
      '<span>게시 대기 <b>' + s.pending + "</b>건</span>" +
      '<span>게시 중 <b>' + num(s.sheetsTotal) + "</b>장</span>" +
      "</div></section>";
    h += '<div class="menu-wrap"><div class="menu-head"><h2>메뉴</h2><span class="hint">메뉴를 누르면 열립니다</span></div><div class="menu-list">';
    h += menuRow("#/create", "게시물 생성 및 이동", "새 게시물 등록 · 게시판 위치·슬롯·순번 이동", 0);
    h += menuRow("#/deploy", "게시물 배포", "오늘 배포 대상 · 구역·동별 게시·제거 체크", s.pending + s.removing);
    h += menuRow("#/status", "현재 게시물 게시 상태 조회", "동별·게시판별 게시 현황과 기한", removeToday);
    h += menuRow("#/history", "게시물 이력 및 통계", "보관함·제거 이력 · 전체/구역별/월별 통계", 0);
    h += menuRow("#/alerts", "제거대상 일일 알림", "매일 07:00 제거 대상 · 카드 이미지 크게 보기·저장", nAlert, "menuAlertBadge");
    h += menuRow("#/admin", "시스템 권한 관리", "관리자 인증 · 조·구역 담당자 권한", 0);
    h += menuRow("#/info", "풍경채 그랑퍼스트 정보", "단지·게시판 구조(E/V 01~06) · 근무조 안내", 0);
    h += "</div></div>";
    h += '<p class="note">게시물·담당자 정보는 Firebase에 실시간 저장됩니다. 등록·수정·이동은 관리자 인증(PIN) 후 가능합니다.' +
      (hasTest() ? "<br><b>테스트 데이터가 포함되어 있습니다.</b> 시스템 권한 관리 → 데이터에서 지울 수 있습니다." : "") + "</p>";
    return h;
  }
  /* 3. 현재 게시물 게시 상태 조회 (동별 현황) */
  function renderStatus() {
    var s = summary();
    var h = '<div class="sec-title"><h2>현재 게시물 게시 상태 조회</h2><span class="hint">' + korDate(TODAY) + " (" + weekday(TODAY) + ")</span></div>";
    h += syncBar();
    h += renderHero(s);
    h += renderStats(s);
    h += '<div class="sec-title"><h2>동별 게시판</h2><span class="hint">' + (ZONE === "all" ? "전체 구역" : zoneName(ZONE)) + "</span></div>";
    h += renderZones();
    h += renderBuildingGrid();
    h += renderFacility();
    h += '<p class="note">게시물·담당자 정보는 Firebase에 실시간 저장됩니다. 경비원 8명이 같은 화면을 함께 봅니다.' +
      (hasTest() ? "<br><b>테스트 데이터가 포함되어 있습니다.</b> 시스템 권한 관리 → 데이터에서 지울 수 있습니다." : "") + "</p>";
    return h;
  }
  function hasTest() { return NOTICES.some(function (n) { return n.isTest; }); }

  /* ---------- building view ---------- */
  function renderSlotCell(no, coreKey, locKey, slot) {
    var items = slotItems(no, coreKey, locKey, slot);
    var isElev = String(locKey).charAt(0) === "e";
    var cls = "slot" + (isElev ? " mini" : "");
    if (isElev && slot === "04") cls += " above";
    if (isElev && (slot === "05" || slot === "06")) cls += " tall";
    if (!items.length) {
      return '<div class="' + cls + ' empty" aria-label="' + slot + '번 빈 게시판">' +
        '<span class="slot-no">' + slot + "</span>" +
        '<span class="slot-empty">' + (isElev && slot === "04" ? "여유 공간" : "빈 게시판") + "</span></div>";
    }
    var st = worstStatus(items);
    var first = items[0].notice;
    var st2 = statusOf(first);
    var meta = st2.key === "permanent" ? "상시" : (st2.key === "overdue" ? st2.days + "일 경과" : "기한 " + dotDate(first.deadline).slice(5));
    if (items.length > 1) meta = items.length + "장 겹침";
    return '<button class="' + cls + ' st-' + st + '" data-act="slot" data-slot="' + slot + '">' +
      (items.length > 1 ? '<span class="slot-badge">' + items.length + "</span>" : "") +
      '<span class="slot-no">' + slot + "</span>" +
      '<span class="slot-title">' + esc(first.title) + "</span>" +
      '<span class="slot-meta">' + esc(meta) + "</span></button>";
  }
  function renderLobbyBoard(no, coreKey, locKey) {
    var h = '<div class="board">';
    FAC.boards.lobby.rows.forEach(function (row) {
      row.forEach(function (slot) { h += renderSlotCell(no, coreKey, locKey, slot); });
    });
    return h + "</div>";
  }
  function renderElevBoard(no, coreKey, locKey) {
    var L = FAC.boards.elevator.layout;
    var right = L.right.frames.map(function (s) { return renderSlotCell(no, coreKey, locKey, s); }).join("");
    return '<div class="elev">' +
      '<div class="elev-side"><div class="elev-cap">우측<small>액자 3칸 · 위 공간</small></div>' +
      renderSlotCell(no, coreKey, locKey, L.right.above) +
      '<div class="elev-frames">' + right + "</div></div>" +
      '<div class="elev-side"><div class="elev-cap">정면<small>거울 아래</small></div>' + renderSlotCell(no, coreKey, locKey, "05") + "</div>" +
      '<div class="elev-side"><div class="elev-cap">좌측<small>출입구 옆</small></div>' + renderSlotCell(no, coreKey, locKey, "06") + "</div>" +
      "</div>";
  }
  function renderLegend() {
    return '<div class="legend">' +
      '<span><i class="sw empty"></i>빈 게시판</span>' +
      '<span><i class="sw active"></i>게시 중</span>' +
      '<span><i class="sw soon"></i>7일 이내</span>' +
      '<span><i class="sw tomorrow"></i>내일 제거</span>' +
      '<span><i class="sw today"></i>오늘 제거</span>' +
      '<span><i class="sw overdue"></i>기한 경과</span>' +
      '<span><i class="sw permanent"></i>상시</span>' +
      "</div>";
  }
  function boardStats(no, coreKey, locKey) {
    var slots = (String(locKey).charAt(0) === "e") ? FAC.boards.elevator.slots : FAC.boards.lobby.slots;
    var total = 0, urgent = 0;
    slots.forEach(function (s) {
      var items = slotItems(no, coreKey, locKey, s);
      total += items.length;
      if (items.some(function (it) {
        var k = statusOf(it.notice).key;
        return k === "overdue" || k === "today" || k === "tomorrow";
      })) urgent++;
    });
    return { total: total, urgent: urgent };
  }
  function renderBuilding() {
    var b = buildingByNo(VIEW.no);
    if (!b) { location.hash = "#/"; return ""; }
    var core = b.cores.filter(function (c) { return c.key === VIEW.core; })[0] || b.cores[0];
    VIEW.core = core.key;
    var locKey = VIEW.loc || "f1";
    var isElev = String(locKey).charAt(0) === "e";
    var elevKey = isElev ? String(locKey).slice(1) : null;
    var elev = isElev ? (core.elevators.filter(function (e) { return e.key === elevKey; })[0] || core.elevators[0]) : null;
    if (isElev && elev && locKey !== "e" + elev.key) locKey = "e" + elev.key;
    VIEW.loc = locKey;

    var zone = zoneById(b.zone);
    var h = '<div class="crumb">' +
      '<button class="back" data-act="back" aria-label="뒤로"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>' +
      '<div><div class="crumb-t">' + b.no + "동</div>" +
      '<div class="crumb-s">' + esc(zone ? zone.name : "") + " · " + esc(b.typeLabel) + "</div></div></div>";

    if (b.cores.length > 1) {
      h += '<div class="seg"><div class="seg-label">라인(코어) 선택</div><div class="chips">';
      b.cores.forEach(function (c) {
        h += '<button class="chip ' + (c.key === core.key ? "on" : "") + '" data-act="core" data-core="' + c.key + '">' + esc(c.name) + "</button>";
      });
      h += "</div></div>";
    }
    h += '<div class="seg"><div class="seg-label">게시판 위치</div><div class="chips">';
    FAC.boards.lobby.floors.forEach(function (f) {
      var k = floorKey(f);
      h += '<button class="chip ' + (k === locKey ? "on" : "") + '" data-act="loc" data-loc="' + k + '">' + f + "</button>";
    });
    h += '<button class="chip ' + (isElev ? "on" : "") + '" data-act="loc" data-loc="e1">엘리베이터</button>';
    h += "</div></div>";
    if (isElev && core.elevators.length > 1) {
      h += '<div class="seg"><div class="seg-label">호기 선택</div><div class="chips">';
      core.elevators.forEach(function (e) {
        h += '<button class="chip ' + ("e" + e.key === locKey ? "on" : "") + '" data-act="loc" data-loc="e' + e.key + '">' +
          esc(e.name + (e.side ? " (" + e.side + ")" : "")) + "</button>";
      });
      h += "</div></div>";
    }
    var bs = boardStats(b.no, core.key, locKey);
    var title = isElev ? "엘리베이터 " + (elev ? elev.name : "") + " 내 게시판" : "공동현관 홀 · " + locLabel(locKey);
    h += '<div class="card board-card"><div class="board-head"><div>' +
      '<div class="board-title">' + esc(title) + "</div>" +
      '<div class="board-sub">' + b.no + "동 " + esc(core.name) + "</div></div>" +
      '<div class="board-sum">게시 ' + bs.total + "장<br>" + (bs.urgent ? "<b>제거 " + bs.urgent + "칸</b>" : "제거 0칸") + "</div></div>";
    h += isElev ? renderElevBoard(b.no, core.key, locKey) : renderLobbyBoard(b.no, core.key, locKey);
    h += renderLegend() + "</div>";

    var slots = isElev ? FAC.boards.elevator.slots : FAC.boards.lobby.slots;
    var rows = "";
    slots.forEach(function (s) {
      var its = slotItems(b.no, core.key, locKey, s);
      its.forEach(function (it) {
        var n = it.notice;
        rows += '<button class="row" data-act="slot" data-slot="' + s + '">' +
          '<span class="row-slot">' + s + "번" + (its.length > 1 || orderNum(it.order) > 1 ? " " + orderNum(it.order) + "번째" : "") + "</span>" +
          '<span class="row-main"><span class="row-title">' + esc(n.title) + "</span>" +
          '<span class="row-sub">게시 ' + dotDate(n.postedAt) + (n.permanent ? " · 상시" : " · 기한 " + dotDate(n.deadline)) + "</span></span>" +
          statusPill(n) + "</button>";
      });
    });
    h += '<div class="blist-h">이 게시판의 게시물</div>';
    h += rows ? '<div class="list">' + rows + "</div>" : '<div class="empty-box">이 게시판에는 게시물이 없습니다.</div>';
    return h;
  }

  /* ---------- tasks view (게시·제거 체크) ---------- */
  function chkCell(n, kind, zone, team) {
    var zs = applicableZones(n);
    if (zs.indexOf(zone) < 0) {
      return '<div class="chk na" aria-label="대상 아님"><span class="box">–</span><span class="zn">' + esc(zoneShort(zone)) + '</span><span class="nm">대상 아님</span></div>';
    }
    var st = zoneCheck(n, kind, zone);
    var checkedTeam = checkTeamOf(n, zone, st);
    var gname = guardName(team, zone);
    if (st && (checkedTeam === team || (!checkedTeam && team === "A"))) {
      return '<button class="chk on" data-act="chk-undo" data-id="' + esc(n.id) + '" data-kind="' + kind + '" data-zone="' + zone + '" data-team="' + team + '">' +
        '<span class="box">☑</span><span class="zn">' + esc(zoneShort(zone)) + "</span>" +
        '<span class="nm">' + esc(st.by || gname) + " " + tsText(st.at).slice(-5) + "</span></button>";
    }
    return '<button class="chk off" data-act="chk" data-id="' + esc(n.id) + '" data-kind="' + kind + '" data-zone="' + zone + '" data-team="' + team + '">' +
      '<span class="box">☐</span><span class="zn">' + esc(zoneShort(zone)) + "</span>" +
      '<span class="nm">' + esc(gname || "-") + "</span></button>";
  }
  function taskCard(n, kind) {
    var st = statusOf(n);
    var pill = kind === "attach"
      ? '<span class="pill pending">' + (someAttached(n) ? "게시 진행 " + attachedZones(n).length + "/" + applicableZones(n).length : "게시 대기") + "</span>"
      : statusPill(n);
    var dl = n.permanent ? "상시" : "기한 " + dotDate(n.deadline) + (st.key === "overdue" ? " (" + st.days + "일 경과)" : "");
    var h = '<div class="task">';
    h += '<div class="task-h"><div class="task-t">' +
      '<div class="task-date">' + mmdd(n.postedAt) + "</div>" +
      '<div class="task-title">' + esc(n.title) + "</div>" +
      '<div class="task-meta">' + esc(targetsShort(n)) + " · " + esc(dl) + " · " + esc(targetsText(n).split(" · ")[0]) + "</div>" +
      "</div><div class=\"task-side\">" + pill + testTag(n) + "</div></div>";
    h += '<div class="task-row"><div class="team-tag">A조</div>' + FAC.zones.map(function (z) { return chkCell(n, kind, z.id, "A"); }).join("") + "</div>";
    h += '<div class="task-row"><div class="team-tag">B조</div>' + FAC.zones.map(function (z) { return chkCell(n, kind, z.id, "B"); }).join("") + "</div>";
    h += '<div class="task-foot">' +
      '<button class="mini-btn" data-act="open-notice" data-id="' + esc(n.id) + '">상세</button>' +
      '<button class="mini-btn" data-act="dl-open" data-id="' + esc(n.id) + '">기한 변경</button>' +
      "</div>";
    h += "</div>";
    return h;
  }
  function renderTasks() {
    var attachList = NOTICES.filter(function (n) { return !isArchived(n) && !allAttached(n); });
    var detachList = NOTICES.filter(function (n) { return !isArchived(n) && someAttached(n) && needsRemove(n); });
    attachList.sort(sortByDeadline);
    detachList.sort(sortByDeadline);

    var h = '<div class="sec-title"><h2>게시물 배포</h2><span class="hint">게시·제거 체크 · ' + korDate(TODAY) + " (" + weekday(TODAY) + ")</span></div>";
    h += '<div class="dsum">' +
      '<span class="' + (attachList.length ? "warn" : "") + '">오늘 게시 대상 <b>' + attachList.length + "</b>건</span>" +
      '<span class="' + (detachList.length ? "warn" : "") + '">오늘 제거 대상 <b>' + detachList.length + "</b>건</span>" +
      '<span>구역 <b>' + FAC.zones.length + "</b>곳 · 담당 <b>" + (FAC.zones.length * 2) + "</b>명</span>" +
      "</div>";
    h += '<div class="warnbox">게시 완료를 체크하면 그 구역 <b>도면에 바로 게시</b>됩니다. 제거는 모든 대상 구역이 체크되면 자동으로 <b>보관함</b>으로 이동합니다.</div>';

    h += '<div class="sec-h"><h3>② 게시 필요</h3><span class="count">' + attachList.length + "건</span></div>";
    if (!attachList.length) {
      h += '<div class="empty-box" style="border-style:solid;background:var(--green-bg);color:var(--green);border-color:var(--green-line);font-weight:700">게시할 게시물이 없습니다.</div>';
    } else {
      h += attachList.map(function (n) { return taskCard(n, "attach"); }).join("");
    }

    h += '<div class="sec-h"><h3>③ 제거 필요</h3><span class="count">' + detachList.length + "건</span></div>";
    if (!detachList.length) {
      h += '<div class="empty-box" style="border-style:solid;background:var(--green-bg);color:var(--green);border-color:var(--green-line);font-weight:700">오늘 제거할 게시물이 없습니다.</div>';
    } else {
      h += detachList.map(function (n) { return taskCard(n, "detach"); }).join("");
    }

    var upcoming = NOTICES.filter(function (n) {
      return !isArchived(n) && allAttached(n) && !needsRemove(n) && !n.permanent && n.deadline;
    }).sort(sortByDeadline).slice(0, 6);
    h += '<div class="sec-h"><h3>게시 중 (제거 예정)</h3><span class="count">' + upcoming.length + "건</span>" +
      '<span class="spacer"></span><button class="mini-btn" data-act="copy" data-kind="all">전체 복사</button></div>';
    if (!upcoming.length) {
      h += '<div class="empty-box">예정된 제거가 없습니다.</div>';
    } else {
      h += '<div class="list">' + upcoming.map(function (n) {
        return '<button class="row" data-act="open-notice" data-id="' + esc(n.id) + '">' +
          '<span class="row-main"><span class="row-title">' + esc(n.title) + "</span>" +
          '<span class="row-sub">' + esc(targetsShort(n)) + " · " + (n.permanent ? "상시" : "기한 " + dotDate(n.deadline)) + "</span></span>" +
          statusPill(n) + "</button>";
      }).join("") + "</div>";
    }
    return h;
  }
  function renderDeploy() { return renderTasks(); }

  /* =========================================================
     1. 게시물 생성 및 이동 ([생성] / [이동])
     ========================================================= */
  var MV_FILTER = { q: "" };
  var moveState = null;

  function flowBadge(n) {
    var fl = flowOf(n);
    if (fl === "pending") return '<span class="pill pending">게시 대기</span>';
    if (fl === "attaching") return '<span class="pill pending">게시 ' + attachedZones(n).length + "/" + applicableZones(n).length + "</span>";
    if (fl === "removing") return '<span class="pill overdue">제거 필요</span>';
    return '<span class="pill active">게시 중</span>';
  }
  function lockCardHtml(title, desc) {
    return '<div class="lockcard"><div style="font-size:1.35rem">🔒</div>' +
      '<div class="lk-t">' + esc(title) + "</div>" +
      '<div class="lk-s">' + desc + "</div>" +
      '<button class="btn solid wide lk-b" data-act="admin-login">관리자 인증 (PIN)</button></div>';
  }
  function renderCreate(tab) {
    var isA = SESSION.role === "admin";
    var h = '<div class="sec-title"><h2>게시물 생성 및 이동</h2><span class="hint">' + (isA ? "관리자 권한" : "관리자 인증 필요") + "</span></div>";
    h += '<div class="seg-tabs" role="tablist" aria-label="생성·이동">' +
      '<button class="seg-tab' + (tab === "move" ? "" : " on") + '" data-act="create-tab" data-v="new" role="tab" aria-selected="' + (tab !== "move") + '">생성</button>' +
      '<button class="seg-tab' + (tab === "move" ? " on" : "") + '" data-act="create-tab" data-v="move" role="tab" aria-selected="' + (tab === "move") + '">이동</button>' +
      "</div>";
    h += (tab === "move") ? moveTabHtml(isA) : newTabHtml(isA);
    return h;
  }
  /* ---------- 게시장소 선택 (생성·이동 공용) ----------
     동(전체/복수) · 라인(전체/복수) · 게시판(전체/1층·지하1층·지하2층 + 번호 01~12) · E/V(전체/호기 + 번호 01~06) */
  function dup(o) { return JSON.parse(JSON.stringify(o)); }
  function lineList() {
    var out = [];
    (FAC && FAC.buildings ? FAC.buildings : []).forEach(function (b) {
      (b.cores || []).forEach(function (c) {
        var k = String(c.key), hit = false;
        for (var i = 0; i < out.length; i++) if (out[i].key === k) hit = true;
        if (!hit) out.push({ key: k, name: c.name });
      });
    });
    return out;
  }
  function lineLabel(k) {
    var list = lineList();
    for (var i = 0; i < list.length; i++) if (list[i].key === String(k)) return list[i].name;
    return k + "라인";
  }
  function allBuildingNos() { return FAC.buildings.map(function (b) { return b.no; }); }
  function allFloorNames() { return FAC.boards.lobby.floors.slice(); }
  function allLineKeys() { return lineList().map(function (l) { return l.key; }); }
  /* "전체" | 배열 — 전체를 누르면 전체, 처음 하나를 누르면 그것만, 이어서 누르면 더하기/빼기 */
  function togglePick(cur, allVals, v) {
    if (String(v) === "all") return "all";
    var arr = (cur === "all") ? [] : cur.slice();
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    if (!arr.length) return "all";
    if (arr.length === allVals.length && allVals.every(function (x) { return arr.indexOf(x) >= 0; })) return "all";
    return arr;
  }
  /* 선택 상태 → 저장용 대상(target) */
  function specTarget(spec) {
    var t = { board: spec.type === "elevator" ? "elevator" : "lobby", slot: pad2(spec.slot), order: 1 };
    t.buildings = spec.buildings === "all" ? "all" : spec.buildings.map(Number).sort(function (a, b) { return a - b; });
    if (spec.lines && spec.lines !== "all") t.cores = spec.lines.map(String);
    if (t.board === "lobby") t.floors = (spec.floors === "all" || !spec.floors || !spec.floors.length) ? allFloorNames() : spec.floors.slice();
    else t.elevators = (spec.elevators === "all" || !spec.elevators || !spec.elevators.length) ? "all" : spec.elevators.map(String);
    return t;
  }
  /* 선택 상태 → 사람이 읽는 위치 문구 */
  function specPlaceText(spec) {
    var b = spec.buildings === "all" ? "전체 " + FAC.buildings.length + "개동" : buildingListText(spec.buildings.map(Number));
    var l = (!spec.lines || spec.lines === "all") ? "전체 라인" : spec.lines.map(lineLabel).join("·");
    if (spec.type === "elevator") {
      var e = (!spec.elevators || spec.elevators === "all") ? "전체 호기" : spec.elevators.map(function (k) { return k + "호기"; }).join("·");
      return b + " · " + l + " · E/V " + e + " " + pad2(spec.slot) + "번";
    }
    var f = (!spec.floors || spec.floors === "all" || spec.floors.length === allFloorNames().length) ? "전체 층" : spec.floors.join("·");
    return b + " · " + l + " · 게시판 " + f + " " + pad2(spec.slot) + "번";
  }
  /* 게시물의 대상이 이 위치에 걸리는지 (이동 원본 찾기) */
  function specHitsTarget(spec, t) {
    if ((t.board || "lobby") !== spec.type) return false;
    if (pad2(t.slot) !== pad2(spec.slot)) return false;
    var nb = buildingsOfTarget(t);
    if (spec.buildings !== "all" && !spec.buildings.some(function (no) { return nb.indexOf(Number(no)) >= 0; })) return false;
    if (spec.lines && spec.lines !== "all") {
      var tc = (t.cores && t.cores !== "all") ? t.cores.map(String) : null;
      if (tc && !tc.some(function (k) { return spec.lines.indexOf(k) >= 0; })) return false;
    }
    if (spec.type === "lobby") {
      if (spec.floors && spec.floors !== "all" && spec.floors.length < allFloorNames().length) {
        var tf = (t.floors && t.floors.length) ? t.floors : allFloorNames();
        if (!spec.floors.some(function (f) { return tf.indexOf(f) >= 0; })) return false;
      }
    } else if (spec.elevators && spec.elevators !== "all" && spec.elevators.length < allElevKeys().length) {
      var te = (t.elevators && t.elevators !== "all") ? t.elevators.map(String) : allElevKeys();
      if (!spec.elevators.some(function (k) { return te.indexOf(String(k)) >= 0; })) return false;
    }
    return true;
  }
  function sameSpec(a, b) {
    return a.type === b.type && pad2(a.slot) === pad2(b.slot) &&
      JSON.stringify(a.buildings) === JSON.stringify(b.buildings) &&
      JSON.stringify(a.lines) === JSON.stringify(b.lines) &&
      JSON.stringify(a.floors || null) === JSON.stringify(b.floors || null) &&
      JSON.stringify(a.elevators || null) === JSON.stringify(b.elevators || null);
  }
  function targetKinds(n) {
    var lobby = false, elev = false;
    targetsOf(n).forEach(function (t) { if ((t.board || "lobby") === "elevator") elev = true; else lobby = true; });
    return lobby && elev ? "게시판·E/V" : elev ? "E/V" : "게시판";
  }
  function targetsPlaceText(n) {
    return targetsOf(n).map(function (t) {
      var b = (t.buildings === "all" || !t.buildings) ? "전체동" : buildingListText(t.buildings);
      var where;
      if (t.board === "elevator") {
        where = (t.elevators && t.elevators !== "all") ? "E/V " + t.elevators.join("·") + "호기" : "E/V 전체";
      } else {
        var fl = (t.floors && t.floors.length) ? t.floors : allFloorNames();
        where = fl.length === allFloorNames().length ? "전체층" : fl.join("·");
      }
      var line = (t.cores && t.cores !== "all") ? " " + t.cores.map(lineLabel).join("·") : "";
      return b + line + " " + where + " " + pad2(t.slot) + "번" + orderText(t.order);
    }).join(" / ");
  }

  /* ---------- [생성] 탭 ---------- */
  var NF = null;
  function nfReset() {
    NF = {
      photo: null, title: "",
      scope: "all", buildings: [],
      lines: "all",
      lobbyOn: true, floors: "all", lobbySlot: "01",
      evOn: false, elevators: "all", evSlot: "01",
      deadline: "", noDeadline: false,
      picked: {}
    };
    return NF;
  }
  function nfEnsure() { if (!NF) nfReset(); return NF; }

  function nfPhotoHtml() {
    nfEnsure();
    return '<div class="nf-shot">' +
      '<div class="photo-prev" id="nfPhotoPrev">' + (NF.photo ? '<img src="' + esc(NF.photo) + '" alt="">' : "사진<br>없음") + "</div>" +
      '<div class="photo-ctl">' +
      '<input type="file" accept="image/*" id="nfPhoto" style="display:none">' +
      '<input type="file" accept="image/*" capture="environment" id="nfCam" style="display:none">' +
      '<div class="f-row"><button class="btn line" data-act="nf-photo">사진 선택</button>' +
      '<button class="btn line" data-act="nf-cam">카메라</button></div>' +
      '<button class="mini-btn" data-act="nf-photo-clear">사진 지우기</button>' +
      '<div class="f-hint" id="nfPhotoInfo">' + (NF.photo ? "첫 장만 저장합니다" : "촬영하거나 앨범에서 · 자동 축소(900px)") + "</div>" +
      "</div></div>";
  }
  function nfPlaceHtml() {
    nfEnsure();
    var h = "";
    /* 동 */
    h += '<div class="nf-row"><div class="nf-lab">동</div><div class="nf-chips">' +
      '<button class="f-chip' + (NF.scope === "all" ? " on" : "") + '" data-act="nf-bld" data-v="all">전체 ' + FAC.buildings.length + "동</button>" +
      FAC.buildings.map(function (b) {
        var on = NF.scope === "pick" && NF.buildings.indexOf(b.no) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="nf-bld" data-v="' + b.no + '">' + b.no + "</button>";
      }).join("") + "</div></div>";
    /* 라인 */
    h += '<div class="nf-row"><div class="nf-lab">라인</div><div class="nf-chips">' +
      '<button class="f-chip' + (NF.lines === "all" ? " on" : "") + '" data-act="nf-line" data-v="all">전체</button>' +
      lineList().map(function (l) {
        var on = NF.lines !== "all" && NF.lines.indexOf(l.key) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="nf-line" data-v="' + esc(l.key) + '">' + esc(l.name) + "</button>";
      }).join("") + "</div></div>";
    /* 게시판 */
    h += '<div class="nf-row' + (NF.lobbyOn ? " on" : " off") + '"><div class="nf-lab">게시판</div><div class="nf-body">' +
      '<div class="nf-line"><button class="f-chip sm' + (NF.lobbyOn ? " on" : "") + '" data-act="nf-lobby-on">' + (NF.lobbyOn ? "게시 ✓" : "넣기") + "</button>" +
      (NF.lobbyOn ? '<div class="nf-chips">' +
        '<button class="f-chip' + (NF.floors === "all" ? " on" : "") + '" data-act="nf-floor" data-v="all">전체</button>' +
        allFloorNames().map(function (f) {
          var on = NF.floors !== "all" && NF.floors.indexOf(f) >= 0;
          return '<button class="f-chip' + (on ? " on" : "") + '" data-act="nf-floor" data-v="' + esc(f) + '">' + esc(f) + "</button>";
        }).join("") + "</div>" : "") + "</div>" +
      (NF.lobbyOn ? '<div class="nf-numrow"><span class="nf-numlab">번호</span><div class="f-grid nf-num">' + slotChipsHtml("nf-lslot", NF.lobbySlot, 12) + "</div></div>" : "") +
      "</div></div>";
    /* E/V */
    h += '<div class="nf-row' + (NF.evOn ? " on" : " off") + '"><div class="nf-lab">E/V</div><div class="nf-body">' +
      '<div class="nf-line"><button class="f-chip sm' + (NF.evOn ? " on" : "") + '" data-act="nf-ev-on">' + (NF.evOn ? "게시 ✓" : "넣기") + "</button>" +
      (NF.evOn ? '<div class="nf-chips">' +
        '<button class="f-chip' + (NF.elevators === "all" ? " on" : "") + '" data-act="nf-elev" data-v="all">전체</button>' +
        allElevKeys().map(function (k) {
          var on = NF.elevators !== "all" && NF.elevators.indexOf(String(k)) >= 0;
          return '<button class="f-chip' + (on ? " on" : "") + '" data-act="nf-elev" data-v="' + esc(k) + '">' + esc(k) + "호기</button>";
        }).join("") + "</div>" : "") + "</div>" +
      (NF.evOn ? '<div class="nf-numrow"><span class="nf-numlab">번호</span><div class="f-grid nf-num">' + slotChipsHtml("nf-eslot", NF.evSlot, 6) + "</div></div>" : "") +
      "</div></div>";
    return h;
  }
  function mvSpecChips(side, kind, val, max) {
    var out = "";
    for (var i = 1; i <= max; i++) {
      var s2 = pad2(i);
      out += '<button class="f-chip' + (val && pad2(val) === s2 ? " on" : "") + '" data-act="mv-' + kind + 'slot" data-side="' + esc(side) + '" data-v="' + s2 + '">' + s2 + "</button>";
    }
    return out;
  }
  function slotChipsHtml(act, val, max) {
    var out = "";
    for (var i = 1; i <= max; i++) {
      var s = pad2(i);
      out += '<button class="f-chip' + (pad2(val) === s ? " on" : "") + '" data-act="' + act + '" data-v="' + s + '">' + s + "</button>";
    }
    return out;
  }
  function nfFormHtml() {
    nfEnsure();
    var h = "";
    h += '<div class="nf"><div class="nf-h"><h3>① 게시물 사진</h3><span class="nf-tag">여러 page면 첫 page만</span></div>' + nfPhotoHtml() +
      '<div class="fld" style="margin:11px 0 0"><label>게시물 제목 <span class="req">*</span></label>' +
      '<input class="f-in" id="nfTitle" value="' + esc(NF.title) + '" placeholder="예: 승강기 정기 점검 안내"></div></div>';
    h += '<div class="nf"><div class="nf-h"><h3>② 게시장소</h3><span class="nf-tag">동 · 라인 · 게시판 / E/V</span></div>' + nfPlaceHtml() + "</div>";
    h += '<div class="nf"><div class="nf-h"><h3>③ 생성일자 · 게시 기한</h3></div>' +
      '<div class="nf-row"><div class="nf-lab">생성일자</div><div class="nf-body"><span class="nf-fixed">' + esc(dotDate(TODAY)) +
      " (" + esc(weekday(TODAY)) + ")</span><span class=\"f-hint\" style=\"display:block\">사진을 올린 날로 자동 기록됩니다</span></div></div>" +
      '<div class="nf-row"><div class="nf-lab">게시 기한</div><div class="nf-body"><div class="f-row">' +
      '<input type="date" class="f-in" id="nfDeadline" value="' + esc(NF.deadline) + '"' + (NF.noDeadline ? " disabled" : "") + ">" +
      '<button class="btn line" data-act="nf-nodeadline" style="flex:0 0 auto">' + (NF.noDeadline ? "기한 없음 ✓" : "기한 없음") + "</button>" +
      "</div></div></div></div>";
    h += '<div class="nf-save"><button class="btn solid wide" data-act="nf-save">저장</button></div>';
    return h;
  }
  /* 목록 정렬 — 제거 필요 → 게시 중 → 게시 대기 순, 같으면 기한 순 */
  function activeSorted() {
    var live = NOTICES.filter(function (n) { return !isArchived(n); });
    live.sort(function (a, b) {
      var fa = flowOf(a), fb = flowOf(b);
      var rank = { removing: 0, attaching: 1, pending: 2, posted: 3 };
      if (rank[fa] !== rank[fb]) return rank[fa] - rank[fb];
      return sortByDeadline(a, b);
    });
    return live;
  }
  function createListHtml(isA) {
    nfEnsure();
    var list = activeSorted();
    var h = '<div class="sec-h"><h3>게시물 목록</h3><span class="count">' + list.length + "건</span>";
    if (isA) {
      h += '<span class="spacer"></span><button class="mini-btn" data-act="nf-pick-all">전체 선택</button>' +
        '<button class="mini-btn danger" data-act="nf-delete">선택 삭제</button>';
    }
    h += "</div>";
    if (!list.length) return h + '<div class="empty-box">등록된 게시물이 없습니다.</div>';
    h += '<div class="statcard" style="padding:2px"><div class="tscroll"><table class="ctable"><thead><tr>' +
      (isA ? '<th class="ck">선택</th>' : "") +
      "<th>구분</th><th>게시물</th><th>생성일자</th><th>게시장소</th><th>게시 기한</th></tr></thead><tbody>";
    list.forEach(function (n) {
      var gen = n.postedAt || ymdOfTs(n.createdAt) || "";
      var dl = (n.permanent || !n.deadline) ? "기한 없음" : dotDate(n.deadline);
      var on = !!(isA && NF.picked[n.id]);
      h += '<tr class="' + (on ? "sel" : "") + '">' +
        (isA ? '<td class="ck"><button class="ckbox' + (on ? " on" : "") + '" data-act="nf-pick" data-id="' + esc(n.id) + '" aria-label="선택">' + (on ? "✓" : "") + "</button></td>" : "") +
        '<td class="ct">' + esc(targetKinds(n)) + "</td>" +
        '<td class="cn"><button class="clink" data-act="open-notice" data-id="' + esc(n.id) + '">' + esc(n.title) + "</button></td>" +
        '<td class="cd">' + esc(dotDate(gen)) + "</td>" +
        '<td class="cp">' + esc(targetsPlaceText(n)) + "</td>" +
        '<td class="cd">' + esc(dl) + "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    h += '<p class="note">줄의 <b>게시물 이름</b>을 누르면 관리자 화면에서 내용을 확인·수정·이동할 수 있습니다. ' +
      "<b>선택 삭제</b>는 고른 게시물을 완전히 지웁니다(보관함 기록도 사라짐).</p>";
    return h;
  }
  function newTabHtml(isA) {
    var h = "";
    if (!isA) {
      h += lockCardHtml("게시물 등록은 관리자 인증이 필요합니다",
        "새 게시물 등록·삭제는 관리자(카일·관리사무소)가 PIN 4자리로 인증한 뒤 사용합니다.<br>경비원은 조회와 게시·제거 체크를 바로 쓸 수 있습니다.");
      return h + createListHtml(false);
    }
    h += '<div class="warnbox">사진을 올리고 <b>동·라인·게시판/E/V·번호</b>와 <b>게시 기한</b>을 고른 뒤 저장하면 <b>게시 대기</b>로 등록됩니다. ' +
      "같은 자리에 이미 있는 게시물은 한 칸씩 뒤로 밀립니다. 배포에서 게시 체크를 해야 도면에 나타납니다.</div>";
    h += '<div id="nfBody">' + nfFormHtml() + "</div>";
    h += '<div id="nfList">' + createListHtml(true) + "</div>";
    return h;
  }
  /* 작성 상태 → 저장할 대상(target) 목록 */
  function nfBuildTargets(st) {
    var s = st || NF;
    var base = { buildings: s.scope === "all" ? "all" : s.buildings.slice(), lines: s.lines };
    var out = [];
    if (s.lobbyOn) out.push(specTarget(Object.assign({}, base, { type: "lobby", floors: s.floors, slot: s.lobbySlot })));
    if (s.evOn) out.push(specTarget(Object.assign({}, base, { type: "elevator", elevators: s.elevators, slot: s.evSlot })));
    return out;
  }
  function saveNewNotice() {
    nfEnsure();
    var titleEl = document.getElementById("nfTitle");
    NF.title = titleEl ? titleEl.value : NF.title;
    var title = (NF.title || "").trim();
    if (!title) { toast("게시물 제목을 입력하세요"); return; }
    if (!NF.lobbyOn && !NF.evOn) { toast("게시할 곳(게시판 또는 E/V)을 하나 이상 고르세요"); return; }
    if (NF.scope !== "all" && !NF.buildings.length) { toast("게시할 동을 하나 이상 고르세요"); return; }
    if (NF.lines !== "all" && !NF.lines.length) { toast("게시할 라인을 하나 이상 고르세요"); return; }
    if (!NF.noDeadline) {
      var dlEl = document.getElementById("nfDeadline");
      if (dlEl) NF.deadline = dlEl.value || NF.deadline;
      if (!NF.deadline) { toast("게시 기한을 고르거나 '기한 없음'을 선택하세요"); return; }
    }
    var targets = nfBuildTargets(NF);
    var id = newId();
    var payload = {
      id: id, title: title, category: "안내문", memo: "",
      postedAt: TODAY, deadline: NF.noDeadline ? null : NF.deadline, permanent: !!NF.noDeadline,
      targets: targets, photo: NF.photo || null, updatedAt: nowTs(),
      status: "pending_attach", createdAt: nowTs(), createdBy: SESSION.admin || "관리자",
      attach: null, detach: null, archivedAt: null, isTest: false
    };
    var placeTxt = targetsPlaceText({ targets: targets });
    var push = pushOrdersForNew(targets, id);
    var updates = push.updates;
    updates["board/notices/" + id] = payload;
    var btn = document.querySelector('[data-act="nf-save"]');
    if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    fbUpdate(updates).then(function (ok) {
      if (!ok) { if (btn) { btn.disabled = false; btn.textContent = "다시 저장"; } return; }
      writeLog({
        noticeId: id, type: "create", by: SESSION.admin || "관리자", at: nowTs(), title: title,
        place: placeTxt, pushed: push.pushed.length
      });
      var picked = NF.picked;
      nfReset();
      NF.picked = picked;
      toast("등록했습니다 · " + placeTxt + (push.pushed.length ? " (기존 " + push.pushed.length + "건 뒤로 밀림)" : ""));
    });
  }
  function deleteSelected() {
    nfEnsure();
    var ids = Object.keys(NF.picked).filter(function (k) { return NF.picked[k] && getNotice(k); });
    if (!ids.length) { toast("삭제할 게시물을 선택하세요"); return; }
    var names = ids.map(function (id) { return getNotice(id).title; });
    if (!confirm("선택한 " + ids.length + "건을 완전히 삭제할까요?\n· " + names.slice(0, 5).join("\n· ") +
      (names.length > 5 ? "\n· 외 " + (names.length - 5) + "건" : "") + "\n\n보관함 기록도 사라집니다.")) return;
    var updates = {}, removed = [];
    ids.forEach(function (id) {
      var n = getNotice(id);
      updates["board/notices/" + id] = null;
      targetsOf(n).forEach(function (t) { removed.push(t); });
    });
    var comp = compactOrders(removed, ids);
    Object.keys(comp.updates).forEach(function (k) { updates[k] = comp.updates[k]; });
    requireAdmin(function () {
      fbUpdate(updates).then(function (ok) {
        if (!ok) return;
        writeLog({ type: "delete", count: ids.length, by: SESSION.admin || "관리자", at: nowTs(), ids: ids, titles: names });
        NF.picked = {};
        toast(ids.length + "건을 삭제했습니다");
      });
    });
  }

  /* ---------- [이동] 탭 ---------- */
  var MV = null;
  var MLOGS = [];          // 최근 이동 기록 (board/logs · type=move)
  function mvBlank(type) {
    return {
      buildings: "all", lines: "all",
      type: type || "lobby",
      floors: "all", elevators: "all", slot: "01"
    };
  }
  function mvReset() {
    MV = { from: mvBlank("lobby"), to: mvBlank("lobby"), picked: {} };
    MV.to.slot = "02";
    return MV;
  }
  function mvEnsure() { if (!MV) mvReset(); return MV; }
  function setMoveLogs(val) {
    MLOGS = [];
    if (val && typeof val === "object") {
      Object.keys(val).forEach(function (k) {
        var e = val[k];
        if (!e || typeof e !== "object") return;
        if (e.type !== "move") return;
        e.key = k;
        MLOGS.push(e);
      });
    }
    MLOGS.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    MLOGS = MLOGS.slice(0, 12);
  }
  function mvSideHtml(side) {
    var s = MV[side];
    var title = side === "from" ? "현재 위치" : "이동할 곳";
    var h = '<div class="mvpanel"><div class="mvph">' + title + "</div>";
    h += '<div class="nf-row"><div class="nf-lab">동</div><div class="nf-chips">' +
      '<button class="f-chip' + (s.buildings === "all" ? " on" : "") + '" data-act="mv-bld" data-side="' + side + '" data-v="all">전체</button>' +
      FAC.buildings.map(function (b) {
        var on = s.buildings !== "all" && s.buildings.indexOf(b.no) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-bld" data-side="' + side + '" data-v="' + b.no + '">' + b.no + "</button>";
      }).join("") + "</div></div>";
    h += '<div class="nf-row"><div class="nf-lab">라인</div><div class="nf-chips">' +
      '<button class="f-chip' + (s.lines === "all" ? " on" : "") + '" data-act="mv-line" data-side="' + side + '" data-v="all">전체</button>' +
      lineList().map(function (l) {
        var on = s.lines !== "all" && s.lines.indexOf(l.key) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-line" data-side="' + side + '" data-v="' + esc(l.key) + '">' + esc(l.name) + "</button>";
      }).join("") + "</div></div>";
    h += '<div class="nf-row' + (s.type === "lobby" ? " on" : " off") + '"><div class="nf-lab">게시판</div><div class="nf-body">' +
      '<div class="nf-chips">' +
      '<button class="f-chip' + (s.type === "lobby" && s.floors === "all" ? " on" : "") + '" data-act="mv-floor" data-side="' + side + '" data-v="all">전체</button>' +
      allFloorNames().map(function (f) {
        var on = s.type === "lobby" && s.floors !== "all" && s.floors.indexOf(f) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-floor" data-side="' + side + '" data-v="' + esc(f) + '">' + esc(f) + "</button>";
      }).join("") + "</div>" +
      '<div class="nf-numrow"><span class="nf-numlab">번호</span><div class="f-grid nf-num">' + mvSpecChips(side, "l", s.type === "lobby" ? s.slot : "", 12) + "</div></div>" +
      "</div></div>";
    h += '<div class="nf-row' + (s.type === "elevator" ? " on" : " off") + '"><div class="nf-lab">E/V</div><div class="nf-body">' +
      '<div class="nf-chips">' +
      '<button class="f-chip' + (s.type === "elevator" && s.elevators === "all" ? " on" : "") + '" data-act="mv-elev" data-side="' + side + '" data-v="all">전체</button>' +
      allElevKeys().map(function (k) {
        var on = s.type === "elevator" && s.elevators !== "all" && s.elevators.indexOf(String(k)) >= 0;
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-elev" data-side="' + side + '" data-v="' + esc(k) + '">' + esc(k) + "호기</button>";
      }).join("") + "</div>" +
      '<div class="nf-numrow"><span class="nf-numlab">번호</span><div class="f-grid nf-num">' + mvSpecChips(side, "e", s.type === "elevator" ? s.slot : "", 6) + "</div></div>" +
      "</div></div>";
    h += '<div class="mvsum">' + esc(specPlaceText(s)) + "</div></div>";
    return h;
  }
  function mvMatches(spec) {
    var out = [];
    NOTICES.forEach(function (n) {
      if (isArchived(n)) return;
      targetsOf(n).forEach(function (t, i) {
        if (!specHitsTarget(spec, t)) return;
        out.push({ id: n.id, title: n.title, idx: i, order: orderNum(t.order), t: t, notice: n });
      });
    });
    out.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return (a.title || "") < (b.title || "") ? -1 : 1;
    });
    return out;
  }
  /* 선택한 게시물을 한 번에 옮기는 update 맵 — 도착지 순번은 기존 게시물 뒤로, 원래 자리는 1..n 압축 */
  function massMoveUpdates(items, toSpec) {
    var dest = specTarget(toSpec);
    var moved = {};
    items.forEach(function (it) { moved[it.id] = true; });
    var destCount = 0;
    NOTICES.forEach(function (n) {
      if (isArchived(n) || moved[n.id]) return;
      targetsOf(n).forEach(function (t) { if (targetOverlaps(dest, t)) destCount++; });
    });
    var updates = {}, olds = [];
    items.forEach(function (it, k) {
      var t = dup(dest);
      t.order = destCount + k + 1;
      var arr = targetsOf(it.notice).slice();
      arr[it.idx] = t;
      updates["board/notices/" + it.id + "/targets"] = arr;
      updates["board/notices/" + it.id + "/updatedAt"] = nowTs();
      olds.push(it.t);
    });
    var comp = compactOrders(olds, items.map(function (it) { return it.id; }));
    Object.keys(comp.updates).forEach(function (k2) { if (!(k2 in updates)) updates[k2] = comp.updates[k2]; });
    return { updates: updates, dest: dest, compacted: comp.changed };
  }
  function mvPickedList() {
    return mvMatches(MV.from).filter(function (it) { return MV.picked[it.id] !== false; });
  }
  function mvListHtml(isA) {
    var items = mvMatches(MV.from);
    var picked = items.filter(function (it) { return MV.picked[it.id] !== false; });
    var toTxt = specPlaceText(MV.to);
    var h = '<div class="sec-h"><h3>이동 목록</h3><span class="count">' + items.length + "건" +
      (picked.length !== items.length ? " · 선택 " + picked.length + "건" : "") + "</span>";
    if (isA && items.length) h += '<span class="spacer"></span><button class="mini-btn" data-act="mv-all">전체 선택/해제</button>';
    h += "</div>";
    if (!items.length) {
      h += '<div class="empty-box">현재 위치에 게시 중인 게시물이 없습니다.<br>왼쪽에서 위치를, 오른쪽에서 옮길 곳을 고르세요.</div>';
    } else {
      h += '<div class="statcard" style="padding:2px"><div class="tscroll"><table class="ctable mt"><thead><tr>' +
        (isA ? '<th class="ck">선택</th>' : "") +
        "<th>구분</th><th>이동대상</th><th>이동할 곳</th><th>이동일</th></tr></thead><tbody>";
      items.forEach(function (it) {
        var on = MV.picked[it.id] !== false;
        var where = (it.t.board === "elevator")
          ? "E/V " + pad2(it.t.slot) + "번"
          : ((it.t.floors && it.t.floors.length && it.t.floors.length < allFloorNames().length ? it.t.floors.join("·") : "전체층") + " " + pad2(it.t.slot) + "번");
        h += '<tr class="' + (on ? "sel" : "") + '">' +
          (isA ? '<td class="ck"><button class="ckbox' + (on ? " on" : "") + '" data-act="mv-pick" data-id="' + esc(it.id) + '" aria-label="선택">' + (on ? "✓" : "") + "</button></td>" : "") +
          '<td class="ct">' + ((it.t.board === "elevator") ? "E/V" : "게시판") + "</td>" +
          '<td class="cn">' + esc(it.title) + '<span class="csub">' + esc(where + orderText(it.t.order)) + "</span></td>" +
          '<td class="cp">' + esc(toTxt) + "</td>" +
          '<td class="cd">' + esc(dotDate(TODAY)) + "</td></tr>";
      });
      h += "</tbody></table></div></div>";
    }
    if (MLOGS.length) {
      h += '<div class="sec-h"><h3>최근 이동 기록</h3><span class="count">' + MLOGS.length + "건</span></div>";
      h += '<div class="statcard" style="padding:2px"><div class="tscroll"><table class="ctable mt"><thead><tr>' +
        "<th>구분</th><th>이동대상</th><th>이동할 곳</th><th>이동일</th></tr></thead><tbody>";
      MLOGS.forEach(function (m) {
        h += "<tr><td class=\"ct\">" + esc(m.count ? m.count + "건" : (m.noticeId ? "1건" : "-")) + "</td>" +
          '<td class="cn">' + esc((m.titles && m.titles.length ? m.titles.slice(0, 2).join(" · ") : (m.title || "-"))) + "</td>" +
          '<td class="cp">' + esc(m.to || "") + '<span class="csub">← ' + esc(m.from || "") + "</span></td>" +
          '<td class="cd">' + esc(m.date || ymdOfTs(m.at) || "") + "</td></tr>";
      });
      h += "</tbody></table></div></div>";
    }
    return h;
  }
  function mvPanelsHtml() {
    return '<div class="mvpanels">' + mvSideHtml("from") +
      '<div class="mvgo-wrap"><button class="btn solid mvgo" data-act="mv-apply">이동 →</button></div>' +
      mvSideHtml("to") + "</div>";
  }
  /* 화면 전체를 다시 그리지 않고 폼·목록만 갱신 (칩을 눌러도 스크롤·제목이 유지된다) */
  function refreshCreate() {
    var b = document.getElementById("nfBody"), l = document.getElementById("nfList");
    if (!b && !l) { render(); return; }
    if (b) b.innerHTML = nfFormHtml();
    if (l) l.innerHTML = createListHtml(SESSION.role === "admin");
  }
  function refreshMove() {
    var b = document.getElementById("mvBody"), l = document.getElementById("mvList");
    if (!b && !l) { render(); return; }
    if (b) b.innerHTML = mvPanelsHtml();
    if (l) l.innerHTML = mvListHtml(SESSION.role === "admin");
  }
  function moveTabHtml(isA) {
    mvEnsure();
    var h = "";
    if (!isA) {
      h += lockCardHtml("게시물 이동은 관리자 인증이 필요합니다",
        "게시판 위치·번호를 바꾸면 현장 게시판 전체에 영향을 주므로 관리자만 할 수 있습니다. 아래 목록은 조회용입니다.");
      return h + mvListHtml(false);
    }
    h += '<div class="warnbox">왼쪽 <b>현재 위치</b>에 게시된 게시물을 골라 오른쪽 <b>이동할 곳</b>으로 한 번에 옮깁니다. ' +
      "옮긴 게시물은 이동한 날짜와 함께 기록에 남습니다.</div>";
    h += '<div id="mvBody">' + mvPanelsHtml() + "</div>";
    h += '<div id="mvList">' + mvListHtml(true) + "</div>";
    return h;
  }
  function applyMassMove() {
    mvEnsure();
    var items = mvPickedList();
    if (!items.length) { toast("이동할 게시물을 선택하세요"); return; }
    if (sameSpec(MV.from, MV.to)) { toast("이동할 곳이 현재 위치와 같습니다 · 오른쪽에서 옮길 곳을 바꾸세요"); return; }
    var res = massMoveUpdates(items, MV.to);
    var fromTxt = specPlaceText(MV.from), toTxt = specPlaceText(MV.to);
    requireAdmin(function () {
      var btn = document.querySelector('[data-act="mv-apply"]');
      if (btn) { btn.disabled = true; btn.textContent = "이동 중…"; }
      fbUpdate(res.updates).then(function (ok) {
        if (btn) { btn.disabled = false; btn.textContent = "이동 →"; }
        if (!ok) return;
        writeLog({
          type: "move", by: SESSION.admin || "관리자", at: nowTs(), date: TODAY,
          from: fromTxt, to: toTxt, count: items.length,
          ids: items.map(function (it) { return it.id; }),
          titles: items.map(function (it) { return it.title; })
        });
        MV.picked = {};
        var needAttach = items.some(function (it) {
          var att = attachedZones(it.notice);
          return buildingsOfTarget(res.dest).some(function (no) {
            var z = zoneOfBuilding(no);
            return z && att.indexOf(z) < 0;
          });
        });
        toast(items.length + "건을 이동했습니다 · " + toTxt + (needAttach ? " (새 구역은 게시 체크 필요)" : ""));
      });
    });
  }

  /* ---- 이동 시트 ---- */
  function openMoveSheet(id) {
    var n = getNotice(id);
    if (!n) return;
    var t = targetsOf(n)[0] || { board: "lobby", slot: "01", order: 1 };
    moveState = {
      id: id,
      orig: JSON.parse(JSON.stringify(t)),
      buildings: (t.buildings === "all" || !t.buildings) ? "all" : t.buildings.slice(),
      board: t.board || "lobby",
      floors: (t.floors && t.floors.length) ? t.floors.slice() : FAC.boards.lobby.floors.slice(),
      elevators: (t.elevators && t.elevators !== "all") ? t.elevators.map(String) : "all",
      slot: pad2(t.slot || "01"),
      order: orderNum(t.order)
    };
    openSheet({ title: "게시물 이동", sub: n.title, html: moveSheetHtml(n), form: true });
  }
  function moveStateTarget() {
    var t = {
      board: moveState.board, slot: moveState.slot, order: moveState.order,
      buildings: moveState.buildings === "all" ? "all" : moveState.buildings.slice()
    };
    if (moveState.board === "lobby") t.floors = (moveState.floors && moveState.floors.length) ? moveState.floors.slice() : FAC.boards.lobby.floors.slice();
    else t.elevators = moveState.elevators;
    return t;
  }
  function mvLocChips() {
    if (moveState.board === "elevator") {
      var out = '<button class="f-chip' + (moveState.elevators === "all" ? " on" : "") + '" data-act="mv-loc" data-v="all">전체 호기</button>';
      allElevKeys().forEach(function (k) {
        var on = moveState.elevators !== "all" && moveState.elevators.indexOf(String(k)) >= 0;
        out += '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-loc" data-v="' + esc(k) + '">' + esc(k) + "호기</button>";
      });
      return out;
    }
    return FAC.boards.lobby.floors.map(function (f) {
      var on = moveState.floors.indexOf(f) >= 0;
      return '<button class="f-chip' + (on ? " on" : "") + '" data-act="mv-loc" data-v="' + esc(f) + '">' + esc(f) + "</button>";
    }).join("");
  }
  function mvSlotChips() {
    var max = moveState.board === "elevator" ? 6 : 12;
    var out = "";
    for (var i = 1; i <= max; i++) {
      var s = pad2(i);
      out += '<button class="f-chip' + (moveState.slot === s ? " on" : "") + '" data-act="mv-slot" data-v="' + s + '">' + s + "</button>";
    }
    return out;
  }
  function mvOrderChips() {
    var out = "";
    for (var o = 1; o <= Math.max(3, orderNum(moveState.order) + 1); o++) {
      out += '<button class="f-chip' + (orderNum(moveState.order) === o ? " on" : "") + '" data-act="mv-order" data-v="' + o + '">' + o + "번째</button>";
    }
    return out;
  }
  function mvPreviewHtml() {
    var here;
    try { here = stackedHere(moveStateTarget(), moveState.id); } catch (e) { here = []; }
    if (!here.length) return '<div class="f-hint" style="margin-top:6px">이 자리는 지금 비어 있습니다.</div>';
    return '<div class="f-hint" style="margin-top:6px">이 자리 지금: ' + here.map(function (it) {
      return esc(it.notice.title) + "(" + it.order + "번째)";
    }).join(" · ") + "</div>";
  }
  function moveSheetHtml(n) {
    var h = '<div class="fld"><label>현재 위치</label>' +
      '<div class="f-in" style="background:#f7f9fb;font-size:.8rem;line-height:1.5;min-height:auto">' + esc(targetsText(n)) + "</div></div>";
    h += '<div class="fld"><label>새 게시판 종류</label><div class="f-chips" id="mvBoard">' +
      '<button class="f-chip' + (moveState.board === "lobby" ? " on" : "") + '" data-act="mv-board" data-v="lobby">공동현관 홀</button>' +
      '<button class="f-chip' + (moveState.board === "elevator" ? " on" : "") + '" data-act="mv-board" data-v="elevator">엘리베이터</button>' +
      "</div></div>";
    h += '<div class="fld"><label><span id="mvLocLabel">' + (moveState.board === "elevator" ? "호기" : "층") + '</span></label><div class="f-chips" id="mvLoc">' + mvLocChips() + "</div></div>";
    h += '<div class="fld"><label>게시 번호</label><div class="f-grid" id="mvSlot">' + mvSlotChips() + "</div></div>";
    h += '<div class="fld"><label>겹치는 순번</label><div class="f-chips" id="mvOrder">' + mvOrderChips() + '</div><div id="mvPreview">' + mvPreviewHtml() + "</div></div>";
    h += '<div class="f-hint" style="margin:0 2px">동 범위는 그대로 유지됩니다 · ' +
      esc(moveState.buildings === "all" ? "전체 " + FAC.buildings.length + "개동" : buildingListText(moveState.buildings)) + "</div>";
    h += '<div class="form-actions"><button class="btn line" data-act="close-sheet" style="flex:1">취소</button>' +
      '<button class="btn solid" data-act="mv-save" data-id="' + esc(n.id) + '" style="flex:1.3">이동 저장</button></div>';
    return h;
  }
  function refreshMoveBits() {
    var b = document.getElementById("mvBoard");
    if (b) b.querySelectorAll(".f-chip").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-v") === moveState.board); });
    var ll = document.getElementById("mvLocLabel");
    if (ll) ll.textContent = moveState.board === "elevator" ? "호기" : "층";
    var loc = document.getElementById("mvLoc");
    if (loc) loc.innerHTML = mvLocChips();
    var slot = document.getElementById("mvSlot");
    if (slot) slot.innerHTML = mvSlotChips();
    var ord = document.getElementById("mvOrder");
    if (ord) ord.innerHTML = mvOrderChips();
    var prev = document.getElementById("mvPreview");
    if (prev) prev.innerHTML = mvPreviewHtml();
  }

  /* 이동 저장 맵 — 같은 자리면 1..N 재배열, 다른 자리면 새 자리에 순번 삽입 + 원래 자리 순번 압축 */
  function buildMoveUpdates(id, n, oldTargets, newTarget) {
    var olds = oldTargets || [];
    if (olds.length === 1 && sameTarget(olds[0], newTarget)) return { updates: {}, changed: false, needsAttach: false };
    var updates = {};
    var sameArea = olds.some(function (o) { return targetOverlaps(o, newTarget); });
    var dest = [];
    NOTICES.forEach(function (x) {
      if (x.id === id || isArchived(x)) return;
      targetsOf(x).forEach(function (tt, i) {
        if (!targetOverlaps(newTarget, tt)) return;
        dest.push({ id: x.id, idx: i, order: orderNum(tt.order), createdAt: x.createdAt || 0 });
      });
    });
    dest.sort(function (a, b) { return a.order - b.order || b.createdAt - a.createdAt; });
    var want = orderNum(newTarget.order);
    var selfTarget = Object.assign({}, newTarget, { order: want });
    if (sameArea) {
      var self = { id: id, self: true, order: orderNum(olds[0].order), createdAt: n.createdAt || 0 };
      var list = dest.slice();
      var at = Math.min(Math.max(1, want), list.length + 1);
      list.splice(at - 1, 0, self);
      list.forEach(function (d, i) {
        var to = i + 1;
        if (d.self) { selfTarget.order = to; updates["board/notices/" + id + "/targets"] = [selfTarget]; }
        else if (orderNum(d.order) !== to) updates["board/notices/" + d.id + "/targets/" + d.idx + "/order"] = to;
      });
    } else {
      var at2 = Math.min(Math.max(1, want), dest.length + 1);
      dest.forEach(function (d, i) {
        if (i + 1 >= at2) updates["board/notices/" + d.id + "/targets/" + d.idx + "/order"] = orderNum(d.order) + 1;
      });
      selfTarget.order = at2;
      updates["board/notices/" + id + "/targets"] = [selfTarget];
      var comp = compactOrders(olds, [id]);
      Object.keys(comp.updates).forEach(function (k) { if (!(k in updates)) updates[k] = comp.updates[k]; });
    }
    updates["board/notices/" + id + "/updatedAt"] = nowTs();
    var newZones = [];
    buildingsOfTarget(newTarget).forEach(function (no) {
      var z = zoneOfBuilding(no);
      if (z && newZones.indexOf(z) < 0) newZones.push(z);
    });
    var att = attachedZones(n);
    var needsAttach = newZones.some(function (z) { return att.indexOf(z) < 0; });
    return { updates: updates, changed: true, needsAttach: needsAttach };
  }
  function saveMove(id) {
    var n = getNotice(id);
    if (!n || !moveState) return;
    var t = moveStateTarget();
    var res = buildMoveUpdates(id, n, targetsOf(n), t);
    if (!res.changed) { toast("위치가 그대로입니다 · 번호나 순번을 바꿔 주세요"); return; }
    requireAdmin(function () {
      var btn = document.querySelector('[data-act="mv-save"]');
      if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
      fbUpdate(res.updates).then(function (ok) {
        if (!ok) { if (btn) { btn.disabled = false; btn.textContent = "다시 저장"; } return; }
        writeLog({ noticeId: id, type: "move", by: SESSION.admin || "관리자", at: nowTs(), title: n.title, from: targetsText(n), to: targetText(t) });
        closeSheet();
        toast("이동했습니다 · " + targetShort(t) + (res.needsAttach ? " (새 구역은 게시 체크 필요)" : ""));
      });
    });
  }

  /* ---------- 시스템 권한 관리 ---------- */
  function whoText() {
    if (SESSION.role === "admin") return "관리자 " + (SESSION.admin || "");
    if (SESSION.role === "guard" && SESSION.name) return SESSION.team + "조 " + zoneShort(SESSION.zone) + " " + SESSION.name;
    return "조회 중 (권한 없음)";
  }
  function renderAdmin() {
    var isAdmin = SESSION.role === "admin";
    var h = '<div class="sec-title"><h2>시스템 권한 관리</h2><span class="hint">관리자 · 경비원 · 조회</span></div>';
    h += '<div class="lockcard" style="text-align:left">' +
      '<div style="font-size:.7rem;font-weight:800;color:var(--muted)">현재 접속</div>' +
      '<div style="font-size:1rem;font-weight:800;margin-top:4px">' + esc(whoText()) + "</div>" +
      '<div class="lk-s" style="text-align:left">' +
      (isAdmin ? "관리자 권한 · 등록·수정·삭제·이동·권한 설정을 쓸 수 있습니다."
        : SESSION.role === "guard" ? "경비원 권한 · 조회와 게시·제거 체크를 할 수 있습니다. 등록·이동은 관리자 인증이 필요합니다."
          : "조회 모드입니다. 게시·제거 체크를 하려면 내 조·구역을 고르세요.") + "</div>" +
      '<div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">' +
      '<button class="btn soft" data-act="who" style="flex:1 1 46%">내 조·구역 선택</button>' +
      (isAdmin
        ? '<button class="btn line" data-act="admin-logout" style="flex:1 1 46%">관리자 해제</button>'
        : '<button class="btn solid" data-act="admin-login" style="flex:1 1 46%">관리자 인증</button>') +
      "</div></div>";

    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 8px"><h3>권한 구조</h3></div>' +
      '<table class="itable">' +
      '<tr><th>관리자</th><td>게시물 등록·수정·삭제·이동, 기한 변경, 담당자·PIN 설정, 데이터 관리<br><span style="color:var(--muted);font-weight:600">PIN 4자리 인증 · ' + esc((CFG.admins || []).join(" · ")) + "</span></td></tr>" +
      '<tr><th>경비원</th><td>조회, 구역별 게시·제거 체크 (본인 기록으로 남음)<br><span style="color:var(--muted);font-weight:600">A·B조 × 정문/후문A/후문B 담당자로 선택</span></td></tr>' +
      '<tr><th>조회</th><td>누구나 읽기 가능 (기록·수정 불가)</td></tr>' +
      "</table></div>";

    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 8px"><h3>조·구역 담당자</h3>' +
      '<span class="spacer"></span>' +
      (isAdmin ? '<button class="mini-btn" data-act="settings">설정</button>' : "") + "</div>" +
      '<table class="itable">' +
      FAC.zones.map(function (z) {
        return "<tr><th>" + esc(z.name) + "</th><td>" + z.buildings.length + "개동<br><span style='color:var(--muted);font-weight:600'>A조 " +
          esc(guardName("A", z.id) || "미지정") + " · B조 " + esc(guardName("B", z.id) || "미지정") + "</span></td></tr>";
      }).join("") +
      "</table>" +
      (isAdmin ? "" : '<div class="f-hint" style="margin-top:8px">담당자·PIN 변경은 관리자 인증 후 가능합니다.</div>') + "</div>";

    if (isAdmin) {
      h += '<div class="statcard"><div class="sec-h" style="margin:0 0 8px"><h3>데이터 관리</h3></div>' +
        '<button class="btn line wide" data-act="export-json" style="margin-bottom:7px">전체 데이터 내보내기 (JSON 복사)</button>' +
        '<button class="btn line wide" data-act="go" data-go="#/history" style="margin-bottom:7px">게시물 이력·보관함 열기</button>' +
        '<button class="btn danger wide" data-act="del-test">테스트 데이터 일괄 삭제</button>' +
        '<div class="f-hint" style="margin-top:7px">Database: grandfirst-board-default-rtdb (asia-southeast1) · Spark 무료 요금제</div></div>';
    }
    return h;
  }

  /* =========================================================
     5. 게시물 제거 대상 일일 알림 (매일 07:00 · Firebase board/daily_alerts)
     [알림]     년월일 | 내용 | 제거건수 | 담당(A조/B조) 표 — 최신순/역순 — 행을 누르면 아래에 상세
     [선택조회] from 년월 ~ to 년월 + 담당(전체/A조/B조) + [조회] → 같은 표 → 행을 누르면 상세
     데이터는 매일 07:00 쌓이는 board/daily_alerts(날짜 키) 를 그대로 읽는다.
     ========================================================= */
  function ymdUTC(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
  function addDays(s, n) { var d = new Date(toUTC(s)); d.setUTCDate(d.getUTCDate() + n); return ymdUTC(d); }

  /* 화면 상태 (탭 · 정렬 · 조회 기간 · 담당 · 펼친 날짜) */
  var AZ = { tab: "list", sort: "desc", from: "", to: "", shift: "all", open: "" };

  function alertItems(a) {
    if (!a || !a.items) return [];
    if (Array.isArray(a.items)) return a.items.filter(Boolean);
    return Object.keys(a.items).map(function (k) { return a.items[k]; }).filter(Boolean);
  }
  function setAlerts(val) {
    ALERTS = [];
    if (val && typeof val === "object") {
      Object.keys(val).forEach(function (k) {
        var a = val[k];
        if (!a || typeof a !== "object") return;
        a.date = a.date || k;
        ALERTS.push(a);
      });
    }
    ALERTS.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function shiftLabel(a) {
    var s = (a && a.shift) || "";
    return s && s.indexOf("조") < 0 ? s + "조" : s;
  }
  function alertTeamKey(a) {
    var s = shiftLabel(a);
    return s === "A조" ? "A" : s === "B조" ? "B" : "";
  }
  function alertYm(a) { return a && a.date ? String(a.date).slice(0, 7) : ""; }
  function alertCount(a) { return alertItems(a).length; }
  /* 내용 칸 — 그날 제거 대상 게시물 이름(최대 2건 + 외 N건), 없으면 기록 문구 */
  function alertContent(a) {
    var items = alertItems(a);
    if (!items.length) return (a && a.summary) || "제거 대상 없음";
    var names = items.map(function (it) { return it.title || it.name || "제거 대상"; });
    if (names.length <= 2) return names.join(" · ");
    return names.slice(0, 2).join(" · ") + " 외 " + (names.length - 2) + "건";
  }
  /* 최신순(desc) / 역순(asc) 정렬 */
  function alertSortRows(list) {
    var out = (list || []).slice();
    out.sort(function (a, b) {
      var d = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return AZ.sort === "asc" ? d : -d;
    });
    return out;
  }
  function alertMonthBounds() {
    var lo = "", hi = "";
    ALERTS.forEach(function (a) {
      var ym = alertYm(a);
      if (!ym) return;
      if (!lo || ym < lo) lo = ym;
      if (!hi || ym > hi) hi = ym;
    });
    return { lo: lo, hi: hi };
  }
  /* 조회 기간 기본값 = 기록이 있는 첫 년월 ~ 마지막 년월 */
  function alertEnsureRange() {
    var b = alertMonthBounds();
    var now = (TODAY || todayStr()).slice(0, 7);
    if (!AZ.from) AZ.from = b.lo || now;
    if (!AZ.to) AZ.to = b.hi || now;
    if (AZ.to < AZ.from) AZ.to = AZ.from;
  }
  function alertHit(a) {
    var ym = alertYm(a);
    if (AZ.from && ym < AZ.from) return false;
    if (AZ.to && ym > AZ.to) return false;
    if (AZ.shift !== "all" && alertTeamKey(a) !== AZ.shift) return false;
    return true;
  }
  function alertFiltered() {
    alertEnsureRange();
    return alertSortRows(ALERTS.filter(alertHit));
  }
  function alertCountText(days) {
    var n = 0;
    (days || []).forEach(function (a) { n += alertCount(a); });
    return "<b>" + (days || []).length + "일</b> · <b>" + n + "건</b>";
  }
  function alertItemHtml(a, it, i) {
    var title = it.title || it.name || "제거 대상";
    var loc = it.location || it.loc || it.place || "";
    var msg = it.message || it.desc || it.text || "";
    var img = it.cardImage || it.image || it.img || "";
    img = img ? esc(img) : "";
    var fname = img ? img.split("/").pop() : "";
    var h = '<div class="aitem">' +
      '<div class="aitem-h"><span class="aitem-no">' + (i + 1) + "</span>" +
      '<span class="aitem-title">' + esc(title) + "</span></div>";
    if (loc) h += '<div class="aitem-loc">위치 · ' + esc(loc) + "</div>";
    if (img) {
      h += '<button class="acard" data-act="zoom" data-src="' + img + '" data-dl="' + esc(fname) + '" data-cap="' +
        esc(a.date + " " + (shiftLabel(a) ? shiftLabel(a) + " " : "") + title) + '">' +
        '<img src="' + img + '" alt="' + esc(title) + '">' +
        '<span class="acard-tag">눌러서 크게 보기 · 저장</span></button>';
    }
    if (msg) h += '<div class="aitem-msg">' + esc(msg) + "</div>";
    h += '<div class="aitem-foot">' +
      '<button class="mini-btn" data-act="alert-copy" data-date="' + esc(a.date) + '" data-i="' + i + '">안내 문구 복사</button>' +
      (img ? '<a class="mini-btn" href="' + img + '" download="' + esc(fname) + '">카드 저장</a>' : "") +
      "</div></div>";
    return h;
  }
  /* 표 — 년월일 | 내용 | 제거건수 | 담당 */
  function alertTableHtml(rows) {
    if (!ALERTS.length) {
      return '<div class="empty-box">아직 07시 알림 기록이 없습니다.<br>매일 07:00 제거 알림이 날짜별로 이곳에 쌓입니다.</div>';
    }
    if (!rows || !rows.length) {
      return '<div class="empty-box">조건에 맞는 알림이 없습니다.<br>조회 기간을 넓히거나 담당을 <b>전체</b>로 바꿔 보세요.</div>';
    }
    var h = '<div class="statcard" style="padding:2px 2px 4px"><div class="tscroll">' +
      '<table class="ptable atable"><thead><tr>' +
      "<th>년월일</th><th>내용</th><th class=\"ac\">제거건수</th><th class=\"ac\">담당</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (a) {
      var n = alertCount(a);
      var on = AZ.open === a.date ? " sel" : "";
      h += '<tr class="atr' + on + '" data-act="alert-open" data-date="' + esc(a.date) + '">' +
        '<th scope="row">' + esc(dotDate(a.date)) + ' <small>(' + esc(a.weekday || weekday(a.date)) + ")</small></th>" +
        '<td class="al">' + esc(alertContent(a)) + "</td>" +
        '<td class="ac' + (n ? "" : " z") + '">' + (n ? n + "건" : "-") + "</td>" +
        '<td class="ac">' + esc(shiftLabel(a) || "-") + "</td></tr>";
    });
    return h + "</tbody></table></div></div>";
  }
  /* 상세 — 기존 카드 이미지 · 안내 문구 · 내려받기 그대로 */
  function alertDetailHtml(date) {
    var a = null;
    ALERTS.forEach(function (x) { if (x.date === date) a = x; });
    if (!a) return "";
    var items = alertItems(a);
    var h = '<div class="adetail" id="alertDetail">' +
      '<div class="adetail-h"><div class="adetail-t">' + esc(korDate(a.date)) +
      " (" + esc(a.weekday || weekday(a.date)) + ")" +
      (shiftLabel(a) ? ' <span class="pill soon">' + esc(shiftLabel(a)) + "</span>" : "") +
      ' <span class="pill ' + (items.length ? "overdue" : "removed") + '">제거 대상 ' + items.length + "건</span></div>" +
      '<button class="mini-btn" data-act="alert-close">닫기</button></div>';
    if (a.summary) h += '<div class="aday-sum">' + esc(a.summary) + "</div>";
    if (!items.length) {
      h += '<div class="adetail-none">이 날은 제거 대상 게시물이 없었습니다.<br>' +
        esc(a.memo || "07:00 알림 기록만 남았습니다.") + "</div>";
    } else {
      if (a.memo) h += '<div class="aday-sum">' + esc(a.memo) + "</div>";
      h += '<div>' + items.map(function (it, i) { return alertItemHtml(a, it, i); }).join("") + "</div>";
    }
    return h + "</div>";
  }
  function alertQueryHtml() {
    alertEnsureRange();
    var h = '<div class="card filtercard">';
    h += '<div class="fld" style="margin-bottom:9px"><label>기간 (년월)</label><div class="f-daterow">' +
      '<input class="f-in" type="month" id="alertFromM" value="' + esc(AZ.from) + '" aria-label="시작 년월">' +
      '<span class="tilde">~</span>' +
      '<input class="f-in" type="month" id="alertToM" value="' + esc(AZ.to) + '" aria-label="끝 년월">' +
      "</div></div>";
    h += '<div class="fld" style="margin-bottom:10px"><label>담당</label><div class="f-chips" id="alertShift">' +
      [["all", "전체"], ["A", "A조"], ["B", "B조"]].map(function (o) {
        return '<button class="f-chip' + (AZ.shift === o[0] ? " on" : "") + '" data-act="alert-shift" data-v="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + "</div></div>";
    h += '<div class="qrow"><button class="mini-btn" data-act="alert-range-reset">초기화</button>' +
      '<button class="btn solid qbtn" data-act="alert-query">조회</button></div>';
    return h + "</div>";
  }
  function alertBodyHtml() {
    var rows = alertFiltered();
    var h = "";
    if (AZ.tab === "query") h += alertQueryHtml();
    h += '<div class="srow"><span class="scnt">' + (AZ.tab === "query" ? "조회 결과 " : "전체 ") +
      alertCountText(rows) + "</span>" +
      '<button class="mini-btn" data-act="alert-sort">' + (AZ.sort === "asc" ? "오래된순 ↑" : "최신순 ↓") + "</button></div>";
    h += alertTableHtml(rows);
    if (AZ.open) {
      var keep = rows.some(function (a) { return a.date === AZ.open; });
      if (keep) h += alertDetailHtml(AZ.open);
      else AZ.open = "";
    }
    return h;
  }
  function renderAlerts() {
    var h = '<div class="sec-title"><h2>게시물 제거 대상 일일 알림</h2><span class="hint">매일 07:00 · 제거 대상</span></div>';
    h += '<div class="seg-tabs" role="tablist" aria-label="알림·선택조회">' +
      '<button class="seg-tab' + (AZ.tab === "query" ? "" : " on") + '" data-act="alert-tab" data-v="list" role="tab" aria-selected="' + (AZ.tab !== "query") + '">알림</button>' +
      '<button class="seg-tab' + (AZ.tab === "query" ? " on" : "") + '" data-act="alert-tab" data-v="query" role="tab" aria-selected="' + (AZ.tab === "query") + '">선택조회</button>' +
      "</div>";
    h += '<div id="alertBody">' + alertBodyHtml() + "</div>";
    h += '<p class="note">표의 행을 누르면 <b>그날의 제거 대상 게시물</b>과 카드 이미지·안내 문구가 아래에 나타납니다. ' +
      "<b>제거건수</b>는 그날 제거 대상 게시물 수, <b>담당</b>은 07:00 근무조입니다.</p>";
    return h;
  }
  /* Firebase 알림 기록이 바뀌면 화면만 다시 그린다 */
  function renderAlertList() {
    syncMenuBadges();
    if (VIEW && VIEW.name === "alerts") render();
  }
  function syncAlertBadge() { syncMenuBadges(); }
  function copyAlertItem(date, idx) {
    var a = null;
    ALERTS.forEach(function (x) { if (x.date === date) a = x; });
    if (!a) return;
    var it = alertItems(a)[idx];
    if (!it) return;
    var text = it.message || it.desc || it.text ||
      ((it.location ? it.location + " " : "") + "게시판 게시물 [" + (it.title || it.name || "") + "] 오늘 제거 바랍니다.");
    copyPlain(text);
  }
  function copyPlain(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast("복사했습니다. 카카오톡에 붙여넣기 하세요."); })
        .catch(function () { copyFallback(text); });
    } else copyFallback(text);
  }

  /* ---------- 4. 게시물 이력 및 통계 ----------
     집계 기준 (2026-11-20 개편 · 손그림 설계)
     · 단위: 게시물 1건 × 구역 1곳의 게시(제거) 체크 기록 1건.
       그 구역에서 그 게시물이 공동현관 게시판이면 「게시판」 1건, 엘리베이터(E/V)면 「E/V」 1건으로 센다.
       (두 게시판에 모두 거는 게시물은 게시판 1 + E/V 1 = 합계 2건)
     · 게시 = notice.attach[구역] 기록, 제거 = notice.detach[구역] 기록.
       체크를 취소하면 기록이 지워지므로 logs(이력) 대신 현재 기록을 기준으로 센다(취소분 미집계).
     · 테스트 게시물(isTest)은 집계에서 제외.
     · 날짜: 게시는 게시일(postedAt) — 없으면 게시 체크 시각.
             제거는 제거 체크 시각 — 없으면 보관일(archivedAt).
       (시드처럼 과거 실적을 한꺼번에 입력한 게시 체크 시각은 실제 게시일이 아니므로 postedAt 을 먼저 쓴다)
     · 조: 체크 기록에 남은 team(A/B). 기록이 없으면 「미지정」으로 합계에만 더한다.
  --------------------------------------------------------- */
  var STAT_KINDS = ["lobby", "elevator"];
  var STAT_KIND_LABEL = { lobby: "게시판", elevator: "E/V" };

  function isYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function ymOf(s) { return s ? String(s).slice(0, 7) : ""; }
  /* 밀리초 시각 → 한국 시간 기준 YYYY-MM-DD */
  function ymdOfTs(ms) {
    var v = Number(ms);
    if (!v) return "";
    var d = new Date(v + 9 * 3600000);
    if (isNaN(d.getTime())) return "";
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function shiftYm(ym, delta) {
    var base = /^\d{4}-\d{2}$/.test(String(ym || "")) ? ym : (TODAY || todayStr()).slice(0, 7);
    var d = new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1 + delta, 1));
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1);
  }
  function ymLabel(ym) { return +ym.slice(0, 4) + "년 " + (+ym.slice(5, 7)) + "월"; }
  function statTeamOf(t) { return (t === "A" || t === "B") ? t : ""; }

  /* 게시·제거 이벤트 목록 (순수 함수 — DB를 건드리지 않는다) */
  function statEvents(notices, fac) {
    var list = notices || [];
    var f = fac || FAC || { buildings: [] };
    var zoneOf = Object.create(null), allNos = [];
    (f.buildings || []).forEach(function (b) { zoneOf[Number(b.no)] = b.zone; allNos.push(Number(b.no)); });
    var out = [];
    list.forEach(function (n) {
      if (!n || n.isTest) return;                       // 테스트 건 제외
      var zoneKinds = Object.create(null);
      targetsOf(n).forEach(function (t) {
        var kind = t.board === "elevator" ? "elevator" : "lobby";
        var nos = (t.buildings === "all" || !t.buildings) ? allNos : (t.buildings || []).map(Number);
        nos.forEach(function (no) {
          var z = zoneOf[no];
          if (!z) return;
          (zoneKinds[z] = zoneKinds[z] || Object.create(null))[kind] = true;
        });
      });
      var postDate = isYmd(n.postedAt) ? n.postedAt : "";
      Object.keys(zoneKinds).forEach(function (z) {
        var kinds = STAT_KINDS.filter(function (k) { return zoneKinds[z][k]; });
        var a = (n.attach || {})[z];
        if (a) {
          var ad = postDate || ymdOfTs(a.at);
          kinds.forEach(function (k) {
            out.push({
              type: "post", kind: k, date: ad, zone: z,
              team: statTeamOf(a.team), by: a.by || "",
              noticeId: n.id, title: n.title || ""
            });
          });
        }
        var r = (n.detach || {})[z];
        if (r) {
          var rd = ymdOfTs(r.at) || (isYmd(n.archivedAt) ? n.archivedAt : "");
          kinds.forEach(function (k) {
            out.push({
              type: "remove", kind: k, date: rd, zone: z,
              team: statTeamOf(r.team), by: r.by || "",
              noticeId: n.id, title: n.title || ""
            });
          });
        }
      });
    });
    return out;
  }

  function statBucket() {
    return {
      total: 0, lobby: 0, elevator: 0,
      teams: {
        A: { total: 0, lobby: 0, elevator: 0 },
        B: { total: 0, lobby: 0, elevator: 0 },
        "": { total: 0, lobby: 0, elevator: 0 }
      }
    };
  }
  /* 기간(년월 from ~ to, 양끝 포함) 집계 — from/to 가 비면 전체 */
  function statAggregate(events, from, to) {
    var res = { post: statBucket(), remove: statBucket() };
    (events || []).forEach(function (e) {
      var ym = ymOf(e.date);
      if (!ym) return;
      if (from && ym < from) return;
      if (to && ym > to) return;
      var b = e.type === "remove" ? res.remove : res.post;
      var kind = e.kind === "elevator" ? "elevator" : "lobby";
      var t = b.teams[statTeamOf(e.team)];
      b.total++; b[kind]++;
      t.total++; t[kind]++;
    });
    return res;
  }
  /* 한 달(YYYY-MM)의 날짜별 집계 */
  function statByDay(events, ym) {
    var days = Object.create(null);
    (events || []).forEach(function (e) {
      if (ymOf(e.date) !== ym) return;
      var d = days[e.date] = days[e.date] || { date: e.date, post: 0, remove: 0, items: [] };
      if (e.type === "remove") d.remove++; else d.post++;
      d.items.push(e);
    });
    return { days: days, sum: statAggregate(events, ym, ym) };
  }
  /* 통계에 쓰이는 전체 이벤트 (화면 렌더마다 새로 계산) */
  function histEvents() { return statEvents(NOTICES, FAC); }
  function histEnsure(events) {
    var now = (TODAY || todayStr()).slice(0, 7);
    var months = [];
    (events || []).forEach(function (e) { var m = ymOf(e.date); if (m) months.push(m); });
    months.sort();
    if (!HIST.from) HIST.from = months.length ? months[0] : now;
    if (!HIST.to) HIST.to = now;
    if (!HIST.month) HIST.month = now;
    if (HIST.to < HIST.from) HIST.to = HIST.from;
    return events;
  }
  function histTabOn(v) { return HIST.tab === v ? " on" : ""; }

  function renderHistory() {
    var events = histEnsure(histEvents());
    var h = '<div class="sec-title"><h2>게시물 이력 및 통계</h2><span class="hint">게시 · 제거 기록</span></div>';
    h += '<div class="seg-tabs three">' +
      '<button class="seg-tab' + histTabOn("cum") + '" data-act="hist-tab" data-v="cum">누적조회</button>' +
      '<button class="seg-tab' + histTabOn("month") + '" data-act="hist-tab" data-v="month">년월별</button>' +
      '<button class="seg-tab' + histTabOn("log") + '" data-act="hist-tab" data-v="log">처리 이력</button>' +
      "</div>";
    if (HIST.tab === "month") h += renderHistoryMonth(events);
    else if (HIST.tab === "log") h += renderHistoryLog();
    else h += renderHistoryCumulative(events);
    return h;
  }

  /* ---------- 4-1. 누적조회 탭 ---------- */
  function histTableRow(label, cls, b) {
    function cell(v) { return '<td class="' + (v ? "" : "z") + '">' + num(v) + "</td>"; }
    return '<tr class="' + cls + '"><th scope="row">' + esc(label) + "</th>" +
      cell(b.total) + cell(b.lobby) + cell(b.elevator) + "</tr>";
  }
  function renderHistoryCumulative(events) {
    var agg = statAggregate(events, HIST.from, HIST.to);
    var h = '<div class="statcard" style="padding:11px 12px 10px">';
    h += '<div class="f-daterow">' +
      '<span class="hd-lab">년월</span>' +
      '<input class="f-in" type="month" id="cumFrom" value="' + esc(HIST.from) + '" aria-label="시작 년월">' +
      '<span class="tilde">~</span>' +
      '<input class="f-in" type="month" id="cumTo" value="' + esc(HIST.to) + '" aria-label="끝 년월">' +
      "</div>";
    h += '<div class="quickrow">' +
      '<button class="qchip" data-act="hist-range" data-v="all">전체 기간</button>' +
      '<button class="qchip" data-act="hist-range" data-v="year">올해</button>' +
      '<button class="qchip" data-act="hist-range" data-v="month">이번 달</button>' +
      "</div></div>";

    h += '<div class="dsum">' +
      '<span>기간 게시 <b>' + num(agg.post.total) + "건</b></span>" +
      '<span>제거 <b>' + num(agg.remove.total) + "건</b></span>" +
      "</div>";

    h += '<div class="statcard" style="padding:2px 4px 6px">';
    h += '<table class="ptable"><thead><tr><th>구분</th><th>합계</th><th>게시판</th><th>E/V</th></tr></thead><tbody>';
    h += histTableRow("게시", "grp post", agg.post);
    h += histTableRow("(A조)", "sub", agg.post.teams.A);
    h += histTableRow("(B조)", "sub", agg.post.teams.B);
    if (agg.post.teams[""].total) h += histTableRow("(미지정)", "sub", agg.post.teams[""]);
    h += histTableRow("제거", "grp remove", agg.remove);
    h += histTableRow("(A조)", "sub", agg.remove.teams.A);
    h += histTableRow("(B조)", "sub", agg.remove.teams.B);
    if (agg.remove.teams[""].total) h += histTableRow("(미지정)", "sub", agg.remove.teams[""]);
    h += "</tbody></table></div>";

    h += '<p class="note">기간은 게시일·제거일이 속한 <b>년월</b> 기준입니다. ' +
      "한 게시물을 한 구역에 게시하면 그 구역 <b>게시판 종류(공동현관 / E/V)에 1건</b>으로 잡히고, " +
      "두 곳에 함께 거는 게시물은 양쪽에 각각 잡힙니다. 테스트 게시물은 빠집니다.</p>";
    return h;
  }

  /* ---------- 4-2. 년월별 탭 (달력) ---------- */
  function renderHistoryMonth(events) {
    var ym = HIST.month;
    var data = statByDay(events, ym);
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var nowYm = (TODAY || todayStr()).slice(0, 7);

    var h = '<div class="statcard" style="padding:9px 10px 11px">';
    h += '<div class="monthnav">' +
      '<button class="mnav" data-act="hist-prev" aria-label="전월">‹</button>' +
      '<div class="mlabel">' + ymLabel(ym) +
      (ym === nowYm ? '<small>당월</small>' : "") + "</div>" +
      '<button class="mnav" data-act="hist-next" aria-label="차월">›</button>' +
      "</div>";

    h += '<div class="cal-head">';
    WEEK.forEach(function (w, i) {
      h += '<div class="cal-h' + (i === 0 ? " sun" : i === 6 ? " sat" : "") + '">' + w + "</div>";
    });
    h += "</div>";

    h += '<div class="cal">';
    for (var i = 0; i < startDow; i++) h += '<div class="cal-cell blank"></div>';
    for (var d = 1; d <= lastDay; d++) {
      var ds = ym + "-" + pad2(d);
      var day = data.days[ds];
      var pc = day ? day.post : 0, rc = day ? day.remove : 0;
      h += '<button class="cal-cell' + (ds === TODAY ? " today" : "") + (ds === HIST.day ? " sel" : "") + '"' +
        ' data-act="hist-day" data-d="' + ds + '" aria-label="' + korDate(ds) + " 게시 " + pc + "건 제거 " + rc + '건">' +
        '<span class="cal-d">' + d + "</span>" +
        '<span class="cal-p' + (pc ? "" : " zero") + '">게시 ' + pc + "<em>건</em></span>" +
        '<span class="cal-r' + (rc ? "" : " zero") + '">제거 ' + rc + "<em>건</em></span>" +
        "</button>";
    }
    h += "</div>";

    var s = data.sum;
    h += '<div class="calsum">' +
      '<div class="csrow"><b class="post">게시 ' + num(s.post.total) + '건</b>' +
      '<span>A조 ' + num(s.post.teams.A.total) + '건</span>' +
      '<span>B조 ' + num(s.post.teams.B.total) + '건</span>' +
      (s.post.teams[""].total ? '<span>미지정 ' + num(s.post.teams[""].total) + '건</span>' : "") +
      "</div>" +
      '<div class="csrow"><b class="remove">제거 ' + num(s.remove.total) + '건</b>' +
      '<span>A조 ' + num(s.remove.teams.A.total) + '건</span>' +
      '<span>B조 ' + num(s.remove.teams.B.total) + '건</span>' +
      (s.remove.teams[""].total ? '<span>미지정 ' + num(s.remove.teams[""].total) + '건</span>' : "") +
      "</div></div>";
    h += '<p class="note" style="padding:4px 4px 0">파란색은 게시, 붉은색은 제거 건수입니다. 날짜를 누르면 그날 내역이 아래에 나옵니다.</p>';
    h += "</div>";

    if (HIST.day) h += renderHistoryDay(data, HIST.day);
    return h;
  }

  function renderHistoryDay(data, ds) {
    var day = data.days[ds];
    var post = day ? day.post : 0, remove = day ? day.remove : 0;
    var h = '<div class="statcard">';
    h += '<div class="sec-h" style="margin:0 0 7px"><h3>' + korDate(ds) + " " + weekday(ds) + '요일</h3>' +
      '<span class="count">게시 ' + post + "건 · 제거 " + remove + "건</span></div>";
    if (!day || !day.items.length) {
      return h + '<div class="empty-box" style="padding:14px">이 날은 게시·제거 기록이 없습니다.</div></div>';
    }
    var items = day.items.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "post" ? -1 : 1;
      if (a.zone !== b.zone) return a.zone < b.zone ? -1 : 1;
      return a.kind === b.kind ? 0 : (a.kind === "lobby" ? -1 : 1);
    });
    h += '<div class="evlist">';
    items.forEach(function (e) {
      h += '<div class="ev-row">' +
        '<span class="ev-badge ' + (e.type === "post" ? "post" : "remove") + '">' +
        (e.type === "post" ? "게시" : "제거") + "</span>" +
        '<span class="ev-main"><b>' + esc(e.title || e.noticeId) + "</b>" +
        '<small>' + esc(STAT_KIND_LABEL[e.kind]) + " · " + esc(zoneName(e.zone)) +
        (e.by ? " · " + esc(e.by) : "") +
        (e.team ? " (" + esc(e.team) + "조)" : "") + "</small></span>" +
        "</div>";
    });
    h += "</div></div>";
    return h;
  }

  /* ---------- 4-3. 처리 이력 탭 (기존 요약 · 보관함) ---------- */
  function renderHistoryLog() {
    var s = summary();
    var arch = NOTICES.filter(isArchived);
    var live = NOTICES.filter(function (n) { return !isArchived(n); });
    var h = '<div class="stats4">' +
      '<div class="s4 navy"><span class="n">' + NOTICES.length + '</span><span class="l">전체 등록</span></div>' +
      '<div class="s4 green"><span class="n">' + live.length + '</span><span class="l">게시 중·대기</span></div>' +
      '<div class="s4 gray"><span class="n">' + arch.length + '</span><span class="l">제거 완료</span></div>' +
      '<div class="s4 red"><span class="n">' + (s.counts.overdue + s.counts.today) + '</span><span class="l">오늘 제거 대상</span></div>' +
      "</div>";

    var zrows = FAC.zones.map(function (z) {
      return {
        z: z,
        a: live.filter(function (n) { return applicableZones(n).indexOf(z.id) >= 0; }).length,
        d: arch.filter(function (n) { return applicableZones(n).indexOf(z.id) >= 0; }).length
      };
    });
    var maxZ = 1;
    zrows.forEach(function (r) { maxZ = Math.max(maxZ, r.a); });
    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 6px"><h3>구역별 게시 현황</h3><span class="count">게시 중 / 제거 완료</span></div>';
    zrows.forEach(function (r) {
      h += '<div class="bar-row"><span class="bar-k">' + esc(r.z.name) + "</span>" +
        '<span class="bar-track"><i class="bar-fill" style="width:' + Math.round(r.a / maxZ * 100) + '%"></i></span>' +
        '<span class="bar-v">' + r.a + "건 <span style=\"color:var(--muted);font-weight:600\">/ " + r.d + "</span></span></div>";
    });
    h += "</div>";

    h += '<div class="sec-h"><h3>제거 이력 · 보관함</h3><span class="count">' + arch.length + "건</span></div>";
    h += renderArchiveBody();
    return h;
  }

  /* ---------- archive view ---------- */
  function renderArchiveBody() {
    var arch = NOTICES.filter(isArchived);
    var h = "";
    if (!arch.length) {
      return h + '<div class="empty-box">아직 제거 완료된 게시물이 없습니다.<br>모든 구역의 제거 체크가 끝나면 이곳으로 자동 이동합니다.</div>';
    }
    var dates = {};
    var slots = {};
    arch.forEach(function (n) {
      var d = n.archivedAt || "미기록";
      dates[d] = (dates[d] || 0) + 1;
      targetsOf(n).forEach(function (t) { slots[pad2(t.slot)] = true; });
    });

    h += '<div class="toolbar">';
    h += '<button class="chip ' + (ARCH_FILTER.date === "all" ? "on" : "") + '" data-act="arch-date" data-v="all">전체 날짜</button>';
    Object.keys(dates).sort().reverse().forEach(function (d) {
      h += '<button class="chip ' + (ARCH_FILTER.date === d ? "on" : "") + '" data-act="arch-date" data-v="' + esc(d) + '">' +
        (d === "미기록" ? d : mmdd(d)) + '<span class="n">' + dates[d] + "</span></button>";
    });
    h += "</div>";
    h += '<div class="toolbar">';
    h += '<button class="chip ' + (ARCH_FILTER.slot === "all" ? "on" : "") + '" data-act="arch-slot" data-v="all">전체 번호</button>';
    Object.keys(slots).sort().forEach(function (s) {
      h += '<button class="chip ' + (ARCH_FILTER.slot === s ? "on" : "") + '" data-act="arch-slot" data-v="' + s + '">' + s + "번</button>";
    });
    h += "</div>";
    h += '<div class="fld"><input class="f-in" id="archQ" placeholder="제목 검색" value="' + esc(ARCH_FILTER.q) + '"></div>';

    var list = arch.filter(function (n) {
      if (ARCH_FILTER.date !== "all" && (n.archivedAt || "미기록") !== ARCH_FILTER.date) return false;
      if (ARCH_FILTER.slot !== "all") {
        var ok = targetsOf(n).some(function (t) { return pad2(t.slot) === ARCH_FILTER.slot; });
        if (!ok) return false;
      }
      if (ARCH_FILTER.q && n.title.indexOf(ARCH_FILTER.q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.archivedAt || "") < (a.archivedAt || "") ? -1 : 1; });

    h += '<div class="sec-h"><h3>제거 기록</h3><span class="count">' + list.length + "건</span></div>";
    if (!list.length) {
      h += '<div class="empty-box">조건에 맞는 보관 기록이 없습니다.</div>';
      return h;
    }
    h += '<div class="list">' + list.map(function (n) {
      return '<button class="row" data-act="open-notice" data-id="' + esc(n.id) + '">' +
        '<span class="row-main">' +
        '<span style="display:flex;gap:4px;flex-wrap:wrap"><span class="pill removed">제거 ' + mmdd(n.archivedAt || "") + "</span>" + testTag(n) + "</span>" +
        '<span class="row-title">' + esc(n.title) + "</span>" +
        '<span class="row-sub">' + esc(targetsText(n)) + "</span>" +
        '<span class="row-sub">게시 ' + dotDate(n.postedAt) + " · 기한 " + (n.deadline ? dotDate(n.deadline) : "상시") + "</span>" +
        "</span><span class=\"row-arrow\">›</span></button>";
    }).join("") + "</div>";
    h += '<p class="note">제거 날짜·게시 번호로 찾을 수 있습니다. ' +
      (SESSION.role === "admin" ? "게시물을 누르면 수정·삭제·재등록할 수 있습니다." : "수정·삭제는 관리자 인증 후 가능합니다.") + "</p>";
    return h;
  }

  /* ---------- 7. 풍경채 그랑퍼스트 정보 ---------- */
  function procRow(no, title, desc) {
    return '<div class="proc-row"><span class="proc-no">' + no + "</span><span><b>" + esc(title) + "</b> · " + esc(desc) + "</span></div>";
  }
  /* 사진 여러 장을 한 카드에 담고 누르면 확대 모달로 보여 줍니다 */
  function photoCard(opts) {
    return '<div class="statcard"><div class="sec-h" style="margin:0 0 8px"><h3>' + esc(opts.title) + '</h3><span class="count">' + esc(opts.count) + '</span></div>' +
      '<div class="dhgrid' + (opts.cols === 2 ? " two" : "") + '">' +
      opts.items.map(function (it) {
        return '<button class="dh-btn" data-act="zoom" data-src="' + esc(it.src) + '" data-cap="' + esc(it.cap) + '">' +
          '<img src="' + esc(it.src) + '" alt="' + esc(it.cap) + '" loading="lazy">' +
          '<span class="dh-cap">' + esc(it.label) + '<small>크게 보기</small></span></button>';
      }).join("") +
      '</div>' +
      (opts.hint ? '<div class="f-hint" style="margin-top:8px">' + opts.hint + "</div>" : "") +
      "</div>";
  }
  function renderInfo() {
    var nos = FAC.buildings.map(function (b) { return b.no; });
    var minNo = Math.min.apply(null, nos), maxNo = Math.max.apply(null, nos);
    var h = '<div class="sec-title"><h2>풍경채 그랑퍼스트 정보</h2><span class="hint">현장 안내용</span></div>';
    h += '<div class="ihero">' +
      '<button class="ihero-shot gate" data-act="zoom" data-src="images/bg_complex_gate.jpg" data-cap="운정 제일풍경채 그랑퍼스트 · 정문(GATE)">' +
      '<img src="images/bg_complex_gate.jpg" alt="단지 정문">' +
      '<span class="ihero-tag">정문 GATE</span>' +
      '<span class="ihero-cap"><b>운정 제일풍경채 그랑퍼스트 아파트</b>' +
      '<small>별하람마을 1단지 · ' + minNo + "~" + maxNo + "동 · " + FAC.buildings.length + "개동</small></span></button>" +
      '<button class="ihero-shot aerial" data-act="zoom" data-src="images/bg_complex_aerial.jpg" data-cap="운정 제일풍경채 그랑퍼스트 · 단지 배치 조감도">' +
      '<img src="images/bg_complex_aerial.jpg" alt="단지 배치 조감도" loading="lazy">' +
      '<span class="ihero-tag">조감도</span>' +
      '<span class="ihero-cap"><b>단지 배치</b><small>정문 · 후문A · 후문B 3개 구역</small></span></button>' +
      "</div>";
    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 4px"><h3>단지 기본 정보</h3></div><table class="itable">' +
      "<tr><th>단지명</th><td>운정 제일풍경채 그랑퍼스트 아파트<br><span style='color:var(--muted);font-weight:600'>(별하람마을 1단지)</span></td></tr>" +
      "<tr><th>동 범위</th><td>" + minNo + "동 ~ " + maxNo + "동 · " + FAC.buildings.length + "개동</td></tr>" +
      "<tr><th>구역</th><td>" + FAC.zones.map(function (z) { return esc(z.name) + " " + z.buildings.length + "동"; }).join(" · ") + "</td></tr>" +
      "<tr><th>근무조</th><td>A조 · B조 격일 근무<br><span style='color:var(--muted);font-weight:600'>구역별 담당이 게시·제거를 맡습니다</span></td></tr>" +
      "<tr><th>세대수</th><td>총 1,926세대<br><span style='color:var(--muted);font-weight:600'>59㎡ 796 · 74㎡A 90 · 74㎡B 223 · 84㎡ 817</span></td></tr>" +
      "<tr><th>게시판</th><td>공동현관 홀 12칸 (01~12번)<br>엘리베이터 6곳 (E/V 01~06번)</td></tr>" +
      "</table></div>";
    h += '<div class="mapcard"><div class="sec-h" style="margin:0 0 8px"><h3>단지 배치도</h3><span class="count">총 1,926세대</span></div>' +
      '<button class="map-shot" data-act="zoom" data-src="images/complex_layout_map.jpg" data-cap="운정 제일풍경채 그랑퍼스트 단지 배치도 (총 1,926세대)">' +
      '<img src="images/complex_layout_map.jpg" alt="단지 배치도 101~124동" loading="lazy">' +
      '<span class="map-hint">눌러서 크게 보기</span></button>' +
      '<div class="hh-grid">' +
      '<div class="hh"><b>59㎡</b><span>796세대</span></div>' +
      '<div class="hh"><b>74㎡A</b><span>90세대</span></div>' +
      '<div class="hh"><b>74㎡B</b><span>223세대</span></div>' +
      '<div class="hh"><b>84㎡</b><span>817세대</span></div>' +
      '</div>' +
      '<div class="hh total" style="margin-top:7px"><b>합계 1,926세대</b><span>101동 ~ 124동 · 24개동</span></div>' +
      '<div class="f-hint" style="margin-top:8px">배치도의 동 번호와 게시판 조회의 동 번호가 같습니다. 현장 안내 시 함께 보세요.</div></div>';
    h += photoCard({ title: "동·호수 배치표 (101~124동)", count: "3장",
      hint: "동마다 아래(저층)부터 위(최고층)까지 호수 배치입니다. 사진을 누르면 크게 볼 수 있습니다.",
      items: [
        { src: "images/dong_ho_table_101_108.jpg", label: "101~108동", cap: "동·호수 배치표 · 101동~108동" },
        { src: "images/dong_ho_table_109_116.jpg", label: "109~116동", cap: "동·호수 배치표 · 109동~116동" },
        { src: "images/dong_ho_table_117_124.jpg", label: "117~124동", cap: "동·호수 배치표 · 117동~124동" }
      ] });
    h += photoCard({ title: "동·라인별 저층·최고층 요약표 (01~24동)", count: "2장", cols: 2,
      hint: "동별 저층·라인별 최고 호수를 정리한 표입니다. 사진을 누르면 크게 볼 수 있습니다.",
      items: [
        { src: "images/dong_line_summary_01_12.jpg", label: "01~12동", cap: "동·라인별 저층·최고층 요약표 · 01동~12동" },
        { src: "images/dong_line_summary_13_24.jpg", label: "13~24동", cap: "동·라인별 저층·최고층 요약표 · 13동~24동" }
      ] });
    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 6px"><h3>게시판 구조</h3></div>' +
      '<table class="itable">' +
      "<tr><th>공동현관 홀</th><td>게시판 4면 · 번호판 12칸<br><span style='color:var(--muted);font-weight:600'>2줄 × 6칸 · 01~12번</span></td></tr>" +
      "<tr><th>엘리베이터</th><td>E/V 01~06번<br><span style='color:var(--muted);font-weight:600'>우측 액자 01~03 · 우측 액자 위 04 · 정면(거울 아래) 05 · 좌측 06</span></td></tr>" +
      "<tr><th>겹침</th><td>같은 번호에 여러 장이면 순번(1번째 = 맨 앞)으로 구분합니다</td></tr>" +
      "</table>" +
      '<div class="tpl2">' +
      '<button class="tpl-btn" data-act="zoom" data-src="templates/lobby_board_template.jpg" data-cap="공동현관 홀 게시판 번호판 01~12번">' +
      '<img src="templates/lobby_board_template.jpg" alt="공동현관 홀 번호판" loading="lazy">' +
      '<span class="tl">공동현관 홀 12칸<small>01~12번 배치</small></span></button>' +
      '<button class="tpl-btn" data-act="zoom" data-src="templates/elevator_board_template.jpg" data-cap="엘리베이터 게시판 E/V 01~06번">' +
      '<img src="templates/elevator_board_template.jpg" alt="엘리베이터 번호판" loading="lazy">' +
      '<span class="tl">엘리베이터 6곳<small>E/V 01~06번 배치</small></span></button>' +
      "</div>" +
      '<div class="f-hint" style="margin-top:7px">사진을 누르면 크게 볼 수 있습니다.</div></div>';
    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 4px"><h3>구역별 담당</h3></div><table class="itable">' +
      FAC.zones.map(function (z) {
        return "<tr><th>" + esc(z.name) + "</th><td>A조 " + esc(guardName("A", z.id) || "미지정") + " · B조 " + esc(guardName("B", z.id) || "미지정") +
          "<br><span style='color:var(--muted);font-weight:600'>" + esc(buildingListText(z.buildings)) + "</span></td></tr>";
      }).join("") + "</table></div>";
    h += '<div class="statcard"><div class="sec-h" style="margin:0 0 6px"><h3>게시판 관리 절차</h3></div><div class="proc">' +
      procRow("1", "등록", "관리자가 게시물을 등록합니다 (게시 대기)") +
      procRow("2", "게시 체크", "담당 구역에 게시한 뒤 체크하면 도면에 나타납니다") +
      procRow("3", "제거 체크", "기한이 되면 제거 후 체크합니다") +
      procRow("4", "보관함", "모든 구역 제거가 끝나면 자동으로 보관함으로 들어갑니다") +
      "</div></div>";
    return h;
  }

  /* ---------- slot sheet ---------- */
  function openSlotSheet() {
    var no = VIEW.no, coreKey = VIEW.core, locKey = VIEW.loc, slot = VIEW.slot;
    var b = buildingByNo(no);
    if (!b) return;
    var core = b.cores.filter(function (c) { return c.key === coreKey; })[0] || b.cores[0];
    var isElev = String(locKey).charAt(0) === "e";
    var elev = isElev ? core.elevators.filter(function (e) { return "e" + e.key === locKey; })[0] : null;
    var items = slotItems(no, core.key, locKey, slot);
    var locText = isElev
      ? "엘리베이터 " + (elev ? elev.name : "") + " · " + slotPos("elevator", slot) + " " + slot + "번"
      : locLabel(locKey) + " 공동현관 홀 · " + slot + "번";
    var html = "";
    if (!items.length) {
      html = '<div class="empty-box">이 번호는 비어 있습니다.<br>게시 완료 체크 전의 게시물은 이곳에 보이지 않습니다.</div>';
    } else {
      items.forEach(function (it, idx) {
        var n = it.notice;
        var ord = orderNum(it.order);
        html += '<article class="notice">' +
          '<div class="notice-order"' + (ord === 1 && items.length > 1 ? ' title="맨 앞"' : '') + '>' + ord + "번째</div>" +
          '<div class="notice-main">' +
          '<div class="notice-title">' + esc(n.title) + "</div>" +
          '<div class="notice-meta">' + statusPill(n) + testTag(n) + "</div>" +
          '<div class="notice-date" style="margin-top:6px">' + esc(statusText(n)) + "</div>" +
          '<div class="notice-date" style="margin-top:2px">게시 ' + dotDate(n.postedAt) + " · " + esc(n.category || "") + "</div>" +
          (n.memo ? '<div class="notice-memo">' + esc(n.memo) + "</div>" : "") +
          '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<button class="mini-btn" data-act="open-notice" data-id="' + esc(n.id) + '">상세</button>' +
          '<button class="mini-btn" data-act="dl-open" data-id="' + esc(n.id) + '">기한 변경</button>' +
          "</div></div>" +
          (n.photo
            ? '<button class="thumb" data-act="zoom" data-src="' + esc(n.photo) + '" data-cap="' + esc(n.title) + '"><img src="' + esc(n.photo) + '" alt=""></button>'
            : '<div class="thumb noimg">사진<br>없음</div>') +
          "</article>";
      });
    }
    openSheet({ title: b.no + "동 " + core.name, sub: locText + " · 게시물 " + items.length + "장", html: html });
  }

  /* =========================================================
     FORMS (등록/수정)
     ========================================================= */
  var formState = null;   // { id, photo, photoIsNew }

  function openNoticeForm(base) {
    // base: 기존 게시물(수정) 또는 {} (신규)
    var isEdit = !!(base && base.id);
    var t = (base && base.targets && base.targets[0]) ? base.targets[0] : { buildings: "all", board: "lobby", floors: null, elevators: "all", slot: "01", order: 1 };
    formState = {
      id: isEdit ? base.id : null,
      photo: base && base.photo ? base.photo : null,
      photoIsNew: false,
      board: t.board || "lobby",
      scope: (t.buildings === "all" || !t.buildings) ? "all" : "pick",
      buildings: (t.buildings === "all" || !t.buildings) ? [] : t.buildings.map(Number),
      floors: (t.floors && t.floors.length) ? t.floors.slice() : null,
      elevators: (t.elevators && t.elevators !== "all") ? t.elevators.map(String) : "all",
      slot: pad2(t.slot || "01"),
      order: t.order || 1
    };
    renderForm(base || {});
  }
  function noticeDefaults(base) {
    return {
      title: base.title || "",
      category: base.category || "안내문",
      memo: base.memo || "",
      postedAt: base.postedAt || TODAY,
      deadline: base.deadline || "",
      permanent: !!base.permanent
    };
  }
  var formDefaults = null;

  function renderForm(base) {
    formDefaults = noticeDefaults(base);
    var isEdit = !!(base && base.id);
    var html = '';
    html += '<div class="fld"><label>제목 <span class="req">*</span></label>' +
      '<input class="f-in" id="fTitle" value="' + esc(formDefaults.title) + '" placeholder="예: 승강기 정기 점검 안내"></div>';
    html += '<div class="fld"><label>분류</label><div class="f-chips" id="fCat">' +
      CATEGORIES.map(function (c) {
        return '<button class="f-chip' + (c === formDefaults.category ? " on" : "") + '" data-act="f-cat" data-v="' + c + '">' + c + "</button>";
      }).join("") + "</div></div>";
    html += '<div class="fld"><label>사진 (자동 축소·압축, 최대 900px / JPEG)</label><div class="photo-box">' +
      '<div class="photo-prev" id="fPhotoPrev">' + (formState.photo ? '<img src="' + esc(formState.photo) + '" alt="">' : "사진<br>없음") + "</div>" +
      '<div class="photo-ctl">' +
      '<input type="file" accept="image/*" id="fPhoto" style="display:none">' +
      '<button class="btn line" data-ifile id="fPhotoBtn">사진 선택</button>' +
      '<button class="mini-btn" data-act="f-photo-clear">사진 지우기</button>' +
      '<div class="f-hint" id="fPhotoInfo">사진은 DB에 압축 저장됩니다. 용량을 줄여 무료 한도 안에서 운영합니다.</div>' +
      "</div></div></div>";

    html += '<div class="fld"><label>게시판 종류</label><div class="f-chips" id="fBoard">' +
      '<button class="f-chip' + (formState.board === "lobby" ? " on" : "") + '" data-act="f-board" data-v="lobby">공동현관 홀</button>' +
      '<button class="f-chip' + (formState.board === "elevator" ? " on" : "") + '" data-act="f-board" data-v="elevator">엘리베이터</button>' +
      "</div></div>";

    html += '<div class="fld"><label>게시 범위 <span class="req">*</span></label><div class="f-chips" id="fScope">' +
      '<button class="f-chip' + (formState.scope === "all" ? " on" : "") + '" data-act="f-scope" data-v="all">전체 동</button>' +
      '<button class="f-chip' + (formState.scope === "zone" ? " on" : "") + '" data-act="f-scope" data-v="zone">구역으로</button>' +
      '<button class="f-chip' + (formState.scope === "pick" ? " on" : "") + '" data-act="f-scope" data-v="pick">동 선택</button>' +
      "</div>";
    html += '<div id="fScopeBody" style="margin-top:7px">' + scopeBodyHtml() + "</div></div>";

    html += '<div class="fld"><label>' + (formState.board === "elevator" ? "호기" : "층") + "</label><div class=\"f-chips\" id=\"fLoc\">" + locChipsHtml() + "</div></div>";

    var slotsMax = formState.board === "elevator" ? 6 : 12;
    html += '<div class="fld"><label>게시 번호 <span class="req">*</span></label><div class="f-grid" id="fSlot">';
    for (var i = 1; i <= slotsMax; i++) {
      var s = pad2(i);
      html += '<button class="f-chip' + (formState.slot === s ? " on" : "") + '" data-act="f-slot" data-v="' + s + '">' + s + "</button>";
    }
    html += "</div>";
    if (formState.board === "elevator") {
      html += '<div class="f-hint">우측 액자 01~03 · 우측 액자 위 04 · 정면(거울 아래) 05 · 좌측 06</div>';
    }
    html += "</div>";

    html += '<div class="fld"><label>겹침 순번</label>' + orderFieldHtml(isEdit) + "</div>";

    html += '<div class="fld"><label>게시 시작일</label><input type="date" class="f-in" id="fPosted" value="' + esc(formDefaults.postedAt) + '"></div>';
    html += '<div class="fld"><label>기한 <span class="req">*</span></label>' +
      '<div class="f-row"><input type="date" class="f-in" id="fDeadline" value="' + esc(formDefaults.deadline) + '">' +
      '<button class="btn line" data-act="f-perm" id="fPerm" style="flex:0 0 auto">' + (formDefaults.permanent ? "상시 ∞ (해제)" : "상시 ∞") + "</button></div>" +
      '<div class="f-hint">상시 게시물은 제거 목록에 오르지 않고, 관리자가 직접 제거 처리할 때까지 유지됩니다.</div></div>';

    html += '<div class="fld"><label>메모 (선택)</label><textarea class="f-ta" id="fMemo" placeholder="현장 메모">' + esc(formDefaults.memo) + "</textarea></div>";

    html += '<div class="form-actions"><button class="btn line" data-act="close-sheet" style="flex:1">취소</button>' +
      '<button class="btn solid" data-act="f-save" style="flex:1.4">' + (isEdit ? "수정 저장" : "등록 (게시 대기)") + "</button></div>";

    openSheet({
      title: isEdit ? "게시물 수정" : "새 게시물 등록",
      sub: isEdit ? "수정해도 게시 기록은 유지됩니다" : "등록 후 게시 체크 전까지 도면에 표시되지 않습니다",
      html: html, form: true,
      onMount: function (sh) {
        var inp = sh.querySelector("#fPhoto");
        var btn = sh.querySelector("#fPhotoBtn");
        if (btn) btn.addEventListener("click", function (e) { e.preventDefault(); inp.click(); });
        if (inp) inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0];
          if (!f) return;
          toast("사진 압축 중…");
          compressImage(f, function (data, kb) {
            formState.photo = data;
            formState.photoIsNew = true;
            var prev = document.getElementById("fPhotoPrev");
            if (prev) prev.innerHTML = '<img src="' + data + '" alt="">';
            var info = document.getElementById("fPhotoInfo");
            if (info) info.textContent = "압축 완료 · 약 " + kb + "KB (DB에 함께 저장됩니다)";
            toast("사진 준비 완료 (" + kb + "KB)");
          });
        });
      }
    });
  }
  function scopeBodyHtml() {
    if (formState.scope === "all") {
      return '<div class="f-hint">전체 ' + FAC.buildings.length + "개동 · 정문/후문A/후문B 모두 게시 (구역별 게시 체크 필요)</div>";
    }
    if (formState.scope === "zone") {
      return '<div class="f-chips">' + FAC.zones.map(function (z) {
        var on = formState.buildings.length && z.buildings.every(function (b) { return formState.buildings.indexOf(b) >= 0; });
        return '<button class="f-chip' + (on ? " on" : "") + '" data-act="f-zone" data-v="' + z.id + '">' + esc(z.name) + " (" + z.buildings.length + "동)</button>";
      }).join("") + "</div>";
    }
    return '<div class="f-grid" style="grid-template-columns:repeat(6,1fr)">' + FAC.buildings.map(function (b) {
      var on = formState.buildings.indexOf(b.no) >= 0;
      return '<button class="f-chip' + (on ? " on" : "") + '" data-act="f-bld" data-v="' + b.no + '">' + b.no + "</button>";
    }).join("") + "</div>";
  }
  function locChipsHtml() {
    if (formState.board === "elevator") {
      var out = '<button class="f-chip' + (formState.elevators === "all" ? " on" : "") + '" data-act="f-loc" data-v="all">전체 호기</button>';
      ["1", "2"].forEach(function (k) {
        var on = formState.elevators !== "all" && formState.elevators.indexOf(k) >= 0;
        out += '<button class="f-chip' + (on ? " on" : "") + '" data-act="f-loc" data-v="' + k + '">' + k + "호기</button>";
      });
      return out;
    }
    return FAC.boards.lobby.floors.map(function (f) {
      var on = !formState.floors || formState.floors.indexOf(f) >= 0;
      return '<button class="f-chip' + (on ? " on" : "") + '" data-act="f-loc" data-v="' + f + '">' + f + "</button>";
    }).join("");
  }
  function refreshFormParts() {
    var scopeBody = document.getElementById("fScopeBody");
    if (scopeBody) scopeBody.innerHTML = scopeBodyHtml();
    var locBox = document.getElementById("fLoc");
    if (locBox) locBox.innerHTML = locChipsHtml();
    var orderBox = document.getElementById("fOrderWrap");
    if (orderBox) orderBox.outerHTML = orderFieldHtml(!!formState.id);
  }

  /* 겹침 순번 칸 — 신규는 자동(1번째), 수정은 직접 고르기 */
  function orderFieldHtml(isEdit) {
    var here = [];
    try { here = stackedHere(formTarget(), formState.id); } catch (e) { here = []; }
    var preview = here.length
      ? '<div class="f-hint" style="margin-top:5px">지금 이 자리: ' + here.map(function (it) {
          return esc(it.notice.title) + "(" + it.order + "번째)";
        }).join(" · ") + "</div>"
      : '<div class="f-hint" style="margin-top:5px">지금 이 자리에 겹쳐 있는 게시물은 없습니다.</div>';
    if (!isEdit) {
      var n = here.length;
      return '<div id="fOrderWrap"><div class="f-chips" id="fOrder">' +
        '<button class="f-chip on" data-act="f-order" data-v="1">1번째 (자동)</button></div>' +
        '<div class="f-hint">신규는 항상 <b>맨 앞(1번째)</b>로 들어가고, 이 자리에 이미 있는 게시물은 한 칸씩 뒤로 밀립니다' +
        (n === 1 ? " (지금 1장 → 2번째로 밀림)" : n > 1 ? " (지금 " + n + "장 → 2~" + (n + 1) + "번째로 밀림)" : "") + ".</div>" +
        preview + "</div>";
    }
    var max = Math.max(3, orderNum(formState.order));
    var chips = [];
    for (var o = 1; o <= max; o++) {
      chips.push('<button class="f-chip' + (orderNum(formState.order) === o ? " on" : "") +
        '" data-act="f-order" data-v="' + o + '">' + o + "번째</button>");
    }
    return '<div id="fOrderWrap"><div class="f-chips" id="fOrder">' + chips.join("") + "</div>" +
      '<div class="f-hint">1번째가 맨 앞입니다. 새로 등록할 때는 자동으로 1번째가 되고 기존 게시물이 뒤로 밀립니다.</div>' +
      preview + "</div>";
  }

  function compressImage(file, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var targetBytes = 118000;            // ≈115KB 이하 목표 (Base64 길이 기준 160000자)
      var w = Math.min(900, img.width);
      var h = Math.round(img.height * (w / img.width));
      var q = 0.72, tries = 0, data = "";
      while (tries < 12) {
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        data = canvas.toDataURL("image/jpeg", q);
        if (data.length <= targetBytes * 1.36) break;
        tries++;
        if (q > 0.42) q = Math.max(0.4, q - 0.08);
        else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); q = 0.62; }
      }
      URL.revokeObjectURL(url);
      cb(data, Math.round((data.length * 3 / 4) / 1024));
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast("사진을 읽지 못했습니다"); };
    img.src = url;
  }

  function formTarget() {
    var t = { board: formState.board, slot: formState.slot, order: formState.order };
    if (formState.scope === "all") t.buildings = "all";
    else t.buildings = formState.buildings.slice().sort(function (a, b) { return a - b; });
    if (formState.board === "lobby") {
      t.floors = formState.floors && formState.floors.length ? formState.floors.slice() : FAC.boards.lobby.floors.slice();
    } else {
      t.elevators = formState.elevators;
    }
    return t;
  }

  function saveNoticeForm() {
    var title = (document.getElementById("fTitle") || {}).value || "";
    title = title.trim();
    if (!title) { toast("제목을 입력하세요"); return; }
    var deadline = (document.getElementById("fDeadline") || {}).value || "";
    var posted = (document.getElementById("fPosted") || {}).value || TODAY;
    var memo = (document.getElementById("fMemo") || {}).value || "";
    if (!formDefaults.permanent && !deadline) { toast("기한을 정하거나 상시로 설정하세요"); return; }
    if (formState.scope !== "all" && !formState.buildings.length) { toast("게시할 동을 하나 이상 고르세요"); return; }
    var target = formTarget();
    var id = formState.id || newId();
    var existing = getNotice(id);
    if (!existing) target.order = 1;      // 신규는 항상 맨 앞(1번째)
    var payload = {
      id: id,
      title: title,
      category: formDefaults.category,
      memo: memo.trim(),
      postedAt: posted,
      deadline: formDefaults.permanent ? null : deadline,
      permanent: !!formDefaults.permanent,
      targets: [target],
      photo: formState.photo || null,
      updatedAt: nowTs()
    };
    if (!existing) {
      payload.status = "pending_attach";
      payload.createdAt = nowTs();
      payload.createdBy = SESSION.admin || "관리자";
      payload.attach = null;
      payload.detach = null;
      payload.archivedAt = null;
      payload.isTest = false;
    }
    var btn = document.querySelector('[data-act="f-save"]');
    if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    // 신규 등록: 같은 자리(게시판+번호+겹치는 층/호기+겹치는 동)의 기존 활성 게시물을
    // 한 칸씩 뒤로 밀고(1→2, 2→3) 새 게시물을 1번째로 넣는다.
    // 순서가 어긋나지 않게 기존 게시물의 order 변경과 신규 게시물 저장을 한 번의 update()로 보낸다.
    var save = buildNoticeUpdates(id, payload, target, existing);
    fbUpdate(save.updates).then(function (ok) {
      if (!ok) { if (btn) { btn.disabled = false; btn.textContent = "다시 저장"; } return; }
      writeLog({
        noticeId: id, type: existing ? "edit" : "create", by: SESSION.admin || "관리자", at: nowTs(), title: title,
        place: targetShort(target), pushed: save.pushed.length
      });
      closeSheet();
      if (existing) { toast("수정했습니다"); return; }
      toast("등록했습니다 · " + targetShort(target) + " 1번째" +
        (save.pushed.length ? " (기존 " + save.pushed.length + "건 뒤로 밀림)" : ""));
    });
  }

  /* 저장할 update 맵 — 신규면 같은 자리 기존 게시물을 밀어내고 새 게시물을 1번째로 넣는다 */
  function buildNoticeUpdates(id, payload, target, existing) {
    var updates = {}, pushed = [];
    if (!existing) {
      var shift = pushOrdersForNew([target], id);
      updates = shift.updates;
      pushed = shift.pushed;
    }
    updates["board/notices/" + id] = Object.assign({}, existing || {}, payload);
    return { updates: updates, pushed: pushed };
  }

  /* ---------- settings ---------- */
  function openSettings() {
    var html = '<div class="fld"><label>관리자 이름</label><div class="f-row">' +
      '<input class="f-in" id="sAdmin0" value="' + esc((CFG.admins || [])[0] || "") + '">' +
      '<input class="f-in" id="sAdmin1" value="' + esc((CFG.admins || [])[1] || "") + '"></div></div>';
    html += '<div class="fld"><label>조·구역 담당자</label>';
    ["A", "B"].forEach(function (t) {
      html += '<div style="display:grid;grid-template-columns:34px 1fr 1fr 1fr;gap:5px;margin-bottom:5px;align-items:center">' +
        '<div class="team-tag">' + t + "조</div>";
      FAC.zones.forEach(function (z) {
        html += '<input class="f-in" style="padding:8px;font-size:.78rem" data-team="' + t + '" data-zone="' + z.id + '" value="' + esc(guardName(t, z.id)) + '" placeholder="' + esc(z.name) + '">';
      });
      html += "</div>";
    });
    html += '<div class="f-hint">이름을 바꾸면 게시·제거 담당자 표시가 함께 바뀝니다.</div></div>';
    html += '<div class="fld"><label>관리자 PIN 변경 (선택)</label><div class="f-row">' +
      '<input class="f-in" id="sPin1" inputmode="numeric" maxlength="4" placeholder="새 PIN 4자리">' +
      '<input class="f-in" id="sPin2" inputmode="numeric" maxlength="4" placeholder="한 번 더"></div>' +
      '<div class="f-hint">비워두면 그대로 유지됩니다. 기본 PIN은 7554입니다.</div></div>';
    html += '<div class="form-actions"><button class="btn line" data-act="close-sheet" style="flex:1">취소</button>' +
      '<button class="btn solid" data-act="s-save" style="flex:1.3">설정 저장</button></div>';
    html += '<div style="margin-top:18px;border-top:1px dashed var(--line);padding-top:12px">' +
      '<div style="font-size:.76rem;font-weight:800;margin-bottom:6px">데이터</div>' +
      '<button class="btn line wide" data-act="export-json" style="margin-bottom:6px">전체 데이터 내보내기 (JSON 복사)</button>' +
      '<button class="btn danger wide" data-act="del-test">테스트 데이터 일괄 삭제</button>' +
      '<div class="f-hint" style="margin-top:6px">Database: grandfirst-board-default-rtdb (asia-southeast1) · Spark 무료 요금제</div></div>';
    openSheet({ title: "관리자 설정", sub: "담당자·PIN·데이터", html: html, form: true });
  }
  async function saveSettings() {
    var admins = [
      ((document.getElementById("sAdmin0") || {}).value || "").trim(),
      ((document.getElementById("sAdmin1") || {}).value || "").trim()
    ].filter(Boolean);
    var teams = { A: { label: "A조", zones: {} }, B: { label: "B조", zones: {} } };
    document.querySelectorAll("[data-team][data-zone]").forEach(function (inp) {
      var t = inp.getAttribute("data-team"), z = inp.getAttribute("data-zone");
      teams[t].zones[z] = (inp.value || "").trim();
    });
    var p1 = ((document.getElementById("sPin1") || {}).value || "").trim();
    var p2 = ((document.getElementById("sPin2") || {}).value || "").trim();
    var pinHash = CFG.pinHash || DEFAULT_PIN_HASH;
    if (p1 || p2) {
      if (!/^\d{4}$/.test(p1)) { toast("PIN은 숫자 4자리로 입력하세요"); return; }
      if (p1 !== p2) { toast("PIN 확인이 일치하지 않습니다"); return; }
      pinHash = await hashPin(p1);
      if (!pinHash) { toast("이 브라우저에서는 PIN을 저장할 수 없습니다"); return; }
    }
    var next = Object.assign({}, CFG, { admins: admins, teams: teams, pinHash: pinHash, updatedAt: nowTs() });
    fbSet("board/config", next).then(function (ok) {
      if (!ok) return;
      closeSheet();
      toast(p1 ? "설정과 PIN을 저장했습니다" : "설정을 저장했습니다");
    });
  }

  /* ---------- destructive actions ---------- */
  function deleteNotice(id) {
    var n = getNotice(id);
    if (!n) return;
    if (!confirm("'" + n.title + "' 게시물을 완전히 삭제할까요?\n보관함 기록도 사라집니다.")) return;
    // 삭제로 비워진 자리의 남은 게시물 순번을 1,2,3… 으로 다시 이어 붙인다
    var comp = compactOrders(targetsOf(n), [id]);
    var updates = comp.updates;
    updates["board/notices/" + id] = null;
    fbUpdate(updates).then(function (ok) {
      if (!ok) return;
      writeLog({ noticeId: id, type: "delete", by: SESSION.admin || "관리자", at: nowTs(), title: n.title });
      closeSheet();
      toast("삭제했습니다");
    });
  }
  function forceArchive(id) {
    var n = getNotice(id);
    if (!n) return;
    if (!confirm("모든 대상 구역을 제거 완료로 처리하고 보관함으로 옮길까요?")) return;
    var detach = Object.assign({}, n.detach || {});
    applicableZones(n).forEach(function (z) {
      if (!detach[z]) detach[z] = { by: SESSION.admin || "관리자", team: "관리", at: nowTs(), forced: true };
    });
    // 보관함으로 옮긴 뒤 남은 게시물의 순번을 1,2,3… 으로 이어 붙인다
    var comp = compactOrders(targetsOf(n), [id]);
    var updates = comp.updates;
    updates["board/notices/" + id + "/detach"] = detach;
    updates["board/notices/" + id + "/status"] = "archived";
    updates["board/notices/" + id + "/archivedAt"] = TODAY;
    updates["board/notices/" + id + "/updatedAt"] = nowTs();
    fbUpdate(updates).then(function (ok) {
      if (!ok) return;
      writeLog({ noticeId: id, type: "force_archive", by: SESSION.admin || "관리자", at: nowTs(), title: n.title });
      closeSheet();
      toast("보관함으로 옮겼습니다");
    });
  }
  function deleteTestData() {
    var tests = NOTICES.filter(function (n) { return n.isTest; });
    if (!tests.length) { toast("테스트 데이터가 없습니다"); return; }
    if (!confirm("테스트 게시물 " + tests.length + "건을 모두 삭제할까요?\n실제 게시물은 남습니다.")) return;
    var updates = {};
    tests.forEach(function (n) { updates["board/notices/" + n.id] = null; });
    // 테스트 게시물이 덮고 있던 자리의 순번도 다시 이어 붙인다
    var removed = [], ids = [];
    tests.forEach(function (n) { ids.push(n.id); targetsOf(n).forEach(function (t) { removed.push(t); }); });
    var comp = compactOrders(removed, ids);
    Object.keys(comp.updates).forEach(function (k) { updates[k] = comp.updates[k]; });
    fbUpdate(updates).then(function (ok) {
      if (!ok) return;
      writeLog({ type: "delete_test", count: tests.length, by: SESSION.admin || "관리자", at: nowTs() });
      closeSheet();
      toast(tests.length + "건의 테스트 데이터를 삭제했습니다");
    });
  }
  function exportJson() {
    var payload = { exportedAt: TODAY, config: CFG, notices: NOTICES };
    var text = JSON.stringify(payload, null, 2);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast("전체 데이터를 복사했습니다"); })
        .catch(function () { copyFallback(text); });
    } else copyFallback(text);
  }

  /* ---------- copy (카카오톡) ---------- */
  function noticeLine(n, idx, kind) {
    var st = statusOf(n);
    var when = st.key === "permanent" ? "상시"
      : "기한 " + dotDate(n.deadline) + (st.key === "overdue" ? " (" + st.days + "일 경과)" : "");
    var ps = placementsOf(n.id);
    var cnt = ps.length ? " · " + num(ps.length) + "장" : "";
    var zs = applicableZones(n);
    var todo = kind === "attach"
      ? zs.filter(function (z) { return !zoneCheck(n, "attach", z); })
      : zs.filter(function (z) { return !zoneCheck(n, "detach", z); });
    var line = (idx ? idx + ". " : "- ") + n.title + " — " + when + cnt + "\n   " + targetsText(n);
    if (todo.length) line += "\n   " + (kind === "attach" ? "미게시" : "미제거") + ": " + todo.map(zoneShort).join("·");
    return line;
  }
  function copyText(kind) {
    var s = summary();
    var lines = [];
    lines.push("[제일풍경채 그랑퍼스트 1단지] 게시판 게시·제거 안내");
    lines.push(korDate(TODAY) + " (" + weekday(TODAY) + ") 기준");
    lines.push("");

    var attachList = NOTICES.filter(function (n) { return !isArchived(n) && !allAttached(n); }).sort(sortByDeadline);
    var detachList = NOTICES.filter(function (n) { return !isArchived(n); })
      .filter(function (n) { return allAttached(n) && needsRemove(n); }).sort(sortByDeadline);
    var posted = NOTICES.filter(function (n) { return !isArchived(n) && allAttached(n) && !needsRemove(n); });

    function section(title, list, k) {
      lines.push("■ " + title + " " + list.length + "건");
      if (!list.length) lines.push("- 없음");
      list.forEach(function (n, i) { lines.push(noticeLine(n, i + 1, k)); });
      lines.push("");
    }
    if (kind === "today") {
      section("제거 대상", detachList, "detach");
      if (attachList.length) section("게시 필요", attachList, "attach");
    } else {
      section("제거 대상", detachList, "detach");
      section("게시 필요", attachList, "attach");
      lines.push("■ 게시 중 " + posted.length + "건");
      if (!posted.length) lines.push("- 없음");
      posted.sort(function (a, b) {
        if (a.permanent && !b.permanent) return 1;
        if (b.permanent && !a.permanent) return -1;
        return sortByDeadline(a, b);
      });
      posted.forEach(function (n, i) { lines.push(noticeLine(n, i + 1, "posted")); });
      lines.push("");
    }
    lines.push("※ 현재 게시판 " + num(s.sheetsTotal) + "장 게시 중");
    lines.push("※ 상시 게시물은 별도 지시 전까지 제거하지 않습니다.");
    if (hasTest()) lines.push("※ 테스트 데이터가 포함되어 있습니다.");
    return lines.join("\n");
  }
  function copyFallback(text) {
    var wrap = document.createElement("div");
    wrap.className = "copyfallback";
    wrap.innerHTML = '<div class="cf-in"><div class="cf-h">아래 내용을 길게 눌러 복사하세요</div>' +
      '<textarea readonly></textarea><div class="cf-n">카카오톡에 붙여넣기 하시면 됩니다. 확인을 누르면 닫힙니다.</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn soft" data-act="cf-close" style="flex:1">확인</button></div></div>';
    document.getElementById("overlayRoot").appendChild(wrap);
    var ta = wrap.querySelector("textarea");
    ta.value = text;
    ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    wrap.addEventListener("click", function (e) {
      if (e.target.closest("[data-act='cf-close']") || e.target === wrap) wrap.remove();
    });
  }
  function doCopy(kind) {
    var text = copyText(kind);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast("복사했습니다. 카카오톡에 붙여넣기 하세요."); })
        .catch(function () { copyFallback(text); });
    } else copyFallback(text);
  }

  /* ---------- routing ---------- */
  function parseHash() {
    var raw = (location.hash || "").replace(/^#\/?/, "");
    var p = raw.split("/").filter(Boolean);
    if (!p.length) return { name: "home" };
    var k = p[0];
    if (k === "create") return { name: "create", tab: (p[1] === "move" ? "move" : "new") };
    if (k === "deploy" || k === "tasks") return { name: "deploy" };
    if (k === "status") return { name: "status" };
    if (k === "history" || k === "archive" || k === "stats") return { name: "history" };
    if (k === "alerts") return { name: "alerts" };
    if (k === "admin") return { name: "admin" };
    if (k === "info") return { name: "info" };
    if (k === "b") {
      return { name: "building", no: Number(p[1]) || null, core: p[2] || null, loc: p[3] || "f1", slot: p[4] || null };
    }
    return { name: "home" };
  }
  /* 서브 화면에서는 상단에 '← 첫 화면' 버튼을 보이고, 로고는 첫 화면에서만 보인다 */
  function syncChrome() {
    var hb = document.getElementById("homeBtn");
    var br = document.getElementById("brand");
    var sub = VIEW.name !== "home";
    if (hb) hb.hidden = !sub;
    if (br) br.hidden = sub;
    if (document.body) {
      document.body.classList.toggle("bg-home", VIEW.name === "home");
      document.body.classList.toggle("bg-info", VIEW.name === "info");
      document.body.classList.toggle("bg-sub", VIEW.name !== "home" && VIEW.name !== "info");
    }
  }
  /* 시설 데이터와 게시물 응답이 모두 준비되면 첫 화면을 그린다
     (느린 회선에서 게시물이 먼저 오고 data.json 이 늦게 오면 첫 화면이 멈추지 않도록) */
  function tryBoot() {
    if (LOADED || !FAC || !NOTICES_READY) return false;
    LOADED = true;
    VIEW = parseHash();
    route();
    return true;
  }
  function render() {
    if (!FAC || !LOADED) return;
    var view = document.getElementById("view");
    var h = "";
    if (VIEW.name === "home") h = renderPortal();
    else if (VIEW.name === "create") h = renderCreate(VIEW.tab);
    else if (VIEW.name === "deploy") h = renderDeploy();
    else if (VIEW.name === "status") h = renderStatus();
    else if (VIEW.name === "history") h = renderHistory();
    else if (VIEW.name === "alerts") h = renderAlerts();
    else if (VIEW.name === "admin") h = renderAdmin();
    else if (VIEW.name === "info") h = renderInfo();
    else if (VIEW.name === "building") h = renderBuilding();
    view.innerHTML = h;
    syncChrome();
    syncWho();
    syncMenuBadges();
  }
  function syncMenuBadges() {
    var al = null;
    ALERTS.forEach(function (a) { if (a.date === TODAY) al = a; });
    var n = al ? alertItems(al).length : 0;
    var el = document.getElementById("menuAlertBadge");
    if (el) { el.hidden = n === 0; el.textContent = n > 99 ? "99+" : String(n); }
  }
  function route() {
    VIEW = parseHash();
    render();
    window.scrollTo(0, 0);
    if (VIEW.name === "building" && VIEW.slot) openSlotSheet();
    else if (document.getElementById("overlayRoot").querySelector(".sheet") &&
      document.getElementById("overlayRoot").querySelector(".sheet").dataset.form !== "1") {
      document.getElementById("overlayRoot").innerHTML = "";
    }
  }
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  /* ---------- events ---------- */
  function bind() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var act = el.dataset.act;

      if (act === "go") { if (el.dataset.go) go(el.dataset.go); }
      else if (act === "home") { go("#/"); }
      else if (act === "create-tab") { go(el.dataset.v === "move" ? "#/create/move" : "#/create"); }
      else if (act === "move-open") {
        var mvId = el.dataset.id;
        closeSheet();
        setTimeout(function () { openMoveSheet(mvId); }, 200);
      }
      else if (act === "mv-board") {
        moveState.board = el.dataset.v;
        if (moveState.board === "elevator" && moveState.slot > "06") moveState.slot = "01";
        refreshMoveBits();
      }
      else if (act === "mv-loc") {
        var mvv = el.dataset.v;
        if (moveState.board === "elevator") {
          if (mvv === "all") moveState.elevators = "all";
          else {
            if (moveState.elevators === "all") moveState.elevators = [];
            var ei = moveState.elevators.indexOf(mvv);
            if (ei >= 0) moveState.elevators.splice(ei, 1);
            else moveState.elevators.push(mvv);
            if (!moveState.elevators.length) moveState.elevators = "all";
          }
        } else {
          var fi = moveState.floors.indexOf(mvv);
          if (fi >= 0) moveState.floors.splice(fi, 1);
          else moveState.floors.push(mvv);
          if (!moveState.floors.length) moveState.floors = FAC.boards.lobby.floors.slice();
        }
        refreshMoveBits();
      }
      else if (act === "mv-slot") { moveState.slot = el.dataset.v; refreshMoveBits(); }
      else if (act === "mv-order") { moveState.order = Number(el.dataset.v); refreshMoveBits(); }
      else if (act === "mv-save") { saveMove(el.dataset.id); }
      else if (act === "admin-logout") {
        SESSION.role = null; SESSION.admin = "";
        saveSession(); render(); toast("관리자 권한을 해제했습니다");
      }
      else if (act === "hist-tab") {
        HIST.tab = (el.dataset.v === "month" || el.dataset.v === "log") ? el.dataset.v : "cum";
        render();
      }
      else if (act === "hist-prev") { HIST.month = shiftYm(HIST.month, -1); HIST.day = ""; render(); }
      else if (act === "hist-next") { HIST.month = shiftYm(HIST.month, 1); HIST.day = ""; render(); }
      else if (act === "hist-day") {
        HIST.day = (HIST.day === el.dataset.d) ? "" : el.dataset.d;
        render();
      }
      else if (act === "hist-range") {
        var hv = el.dataset.v, hnow = (TODAY || todayStr()).slice(0, 7);
        if (hv === "all") {
          var evs = histEvents(), ms = [];
          evs.forEach(function (e) { var m2 = ymOf(e.date); if (m2) ms.push(m2); });
          ms.sort();
          HIST.from = ms.length ? ms[0] : hnow;
          HIST.to = hnow;
        } else if (hv === "year") { HIST.from = hnow.slice(0, 4) + "-01"; HIST.to = hnow; }
        else { HIST.from = hnow; HIST.to = hnow; }
        render();
      }
      else if (act === "tab") {
        var tb = el.dataset.tab;
        go(tb === "home" ? "#/" : tb === "tasks" ? "#/deploy" : tb === "archive" ? "#/history" : "#/" + tb);
      }
      else if (act === "close-sheet") { closeSheet(); }
      else if (act === "zone") { ZONE = el.dataset.zone; render(); }
      else if (act === "building") { go("#/b/" + el.dataset.no); }
      else if (act === "core") { go("#/b/" + VIEW.no + "/" + el.dataset.core + "/" + (VIEW.loc || "f1")); }
      else if (act === "loc") { go("#/b/" + VIEW.no + "/" + VIEW.core + "/" + el.dataset.loc); }
      else if (act === "slot") { go("#/b/" + VIEW.no + "/" + VIEW.core + "/" + VIEW.loc + "/" + el.dataset.slot); }
      else if (act === "back") { if (history.length > 1) history.back(); else go("#/"); }
      else if (act === "copy") { doCopy(el.dataset.kind || "today"); }
      else if (act === "font") {
        FONT_LG = !FONT_LG;
        document.documentElement.classList.toggle("fs-lg", FONT_LG);
        try { localStorage.setItem("gf.fontLg", FONT_LG ? "1" : "0"); } catch (err) {}
      }
      else if (act === "who") { openWhoSheet(); }
      else if (act === "who-logout") {
        SESSION.role = null; SESSION.name = ""; SESSION.admin = "";
        saveSession(); closeSheet(); render(); toast("조회 모드로 돌아왔습니다");
      }
      else if (act === "pick-guard") { pickGuard(el.dataset.team, el.dataset.zone); }
      else if (act === "admin-login") { closeSheet(); setTimeout(function () { openAdminLogin(); }, 220); }
      else if (act === "pick-admin") {
        SESSION.admin = el.dataset.name;
        document.querySelectorAll('[data-act="pick-admin"]').forEach(function (b) {
          b.classList.toggle("on", b.getAttribute("data-name") === SESSION.admin);
        });
      }
      else if (act === "pin-key") { pinKey(el.dataset.k); }
      else if (act === "pin-submit") { pinSubmit(); }
      else if (act === "chk") {
        toggleZoneCheck(el.dataset.id, el.dataset.kind, el.dataset.zone, el.dataset.team);
      }
      else if (act === "chk-undo") {
        toggleZoneCheck(el.dataset.id, el.dataset.kind, el.dataset.zone, el.dataset.team);
      }
      else if (act === "open-notice") { closeSheet(); setTimeout(function () { openNoticeSheet(el.dataset.id); }, 200); }
      else if (act === "dl-open") { closeSheet(); setTimeout(function () { openDeadlineSheet(el.dataset.id); }, 200); }
      else if (act === "dl-save") { saveDeadline(el.dataset.id); }
      else if (act === "zoom") { openLightbox(el.dataset.src, el.dataset.cap, el.dataset.dl); }
      else if (act === "new-notice") { requireAdmin(function () { openNoticeForm({}); }); }
      else if (act === "edit-notice") {
        var n = getNotice(el.dataset.id);
        closeSheet();
        setTimeout(function () { openNoticeForm(n || {}); }, 200);
      }
      else if (act === "del-notice") { requireAdmin(function () { deleteNotice(el.dataset.id); }); }
      else if (act === "force-archive") { requireAdmin(function () { forceArchive(el.dataset.id); }); }
      else if (act === "repost") {
        var src = getNotice(el.dataset.id);
        closeSheet();
        setTimeout(function () {
          openNoticeForm({
            title: src.title, category: src.category, memo: src.memo,
            postedAt: TODAY, deadline: "", permanent: false,
            targets: src.targets, photo: src.photo
          });
          toast("새 게시물로 다시 등록합니다 · 기한을 확인하세요");
        }, 220);
      }
      else if (act === "ask-admin") { requireAdmin(function () { openNoticeSheet(el.dataset.id); }); }
      else if (act === "settings") { requireAdmin(function () { openSettings(); }); }
      else if (act === "s-save") { saveSettings(); }
      else if (act === "del-test") { requireAdmin(function () { deleteTestData(); }); }
      else if (act === "export-json") { exportJson(); }
      else if (act === "cleanup") { toast("게시·제거 탭에서 체크하세요. 도면은 게시 후 표시됩니다."); }
      else if (act === "arch-date") { ARCH_FILTER.date = el.dataset.v; render(); }
      else if (act === "arch-slot") { ARCH_FILTER.slot = el.dataset.v; render(); }
      else if (act === "alert-tab") {
        AZ.tab = el.dataset.v === "query" ? "query" : "list";
        AZ.open = "";
        render();
      }
      else if (act === "alert-sort") { AZ.sort = AZ.sort === "asc" ? "desc" : "asc"; render(); }
      else if (act === "alert-open") {
        var ad = el.dataset.date;
        AZ.open = AZ.open === ad ? "" : ad;
        var ab = document.getElementById("alertBody");
        if (ab) ab.innerHTML = alertBodyHtml(); else render();
      }
      else if (act === "alert-close") {
        AZ.open = "";
        var ab2 = document.getElementById("alertBody");
        if (ab2) ab2.innerHTML = alertBodyHtml(); else render();
      }
      else if (act === "alert-shift") {
        AZ.shift = (el.dataset.v === "A" || el.dataset.v === "B") ? el.dataset.v : "all";
        AZ.open = "";
        render();
      }
      else if (act === "alert-query") { render(); }
      else if (act === "alert-range-reset") {
        AZ.from = ""; AZ.to = ""; AZ.shift = "all"; AZ.open = "";
        render();
      }
      else if (act === "alert-copy") { copyAlertItem(el.dataset.date, Number(el.dataset.i)); }
      /* ---------- [생성] 탭 ---------- */
      else if (act === "nf-photo") { var npi = document.getElementById("nfPhoto"); if (npi) npi.click(); }
      else if (act === "nf-cam") { var nci = document.getElementById("nfCam"); if (nci) nci.click(); }
      else if (act === "nf-photo-clear") { nfEnsure(); NF.photo = null; refreshCreate(); toast("사진을 지웠습니다"); }
      else if (act === "nf-bld") {
        nfEnsure();
        var nbv = el.dataset.v;
        if (nbv === "all") { NF.scope = "all"; NF.buildings = []; }
        else {
          NF.scope = "pick";
          var nno = Number(nbv), nx = NF.buildings.indexOf(nno);
          if (nx >= 0) NF.buildings.splice(nx, 1); else NF.buildings.push(nno);
        }
        refreshCreate();
      }
      else if (act === "nf-line") { nfEnsure(); NF.lines = togglePick(NF.lines, allLineKeys(), el.dataset.v); refreshCreate(); }
      else if (act === "nf-lobby-on") { nfEnsure(); NF.lobbyOn = !NF.lobbyOn; refreshCreate(); }
      else if (act === "nf-ev-on") { nfEnsure(); NF.evOn = !NF.evOn; refreshCreate(); }
      else if (act === "nf-floor") { nfEnsure(); NF.floors = togglePick(NF.floors, allFloorNames(), el.dataset.v); refreshCreate(); }
      else if (act === "nf-elev") { nfEnsure(); NF.elevators = togglePick(NF.elevators, allElevKeys(), el.dataset.v); refreshCreate(); }
      else if (act === "nf-lslot") { nfEnsure(); NF.lobbySlot = el.dataset.v; refreshCreate(); }
      else if (act === "nf-eslot") { nfEnsure(); NF.evSlot = el.dataset.v; refreshCreate(); }
      else if (act === "nf-nodeadline") { nfEnsure(); NF.noDeadline = !NF.noDeadline; refreshCreate(); }
      else if (act === "nf-save") { saveNewNotice(); }
      else if (act === "nf-pick") { nfEnsure(); NF.picked[el.dataset.id] = !NF.picked[el.dataset.id]; refreshCreate(); }
      else if (act === "nf-pick-all") {
        nfEnsure();
        var allOn = activeSorted().every(function (n) { return !!NF.picked[n.id]; });
        NF.picked = {};
        if (!allOn) activeSorted().forEach(function (n) { NF.picked[n.id] = true; });
        refreshCreate();
      }
      else if (act === "nf-delete") { deleteSelected(); }
      /* ---------- [이동] 탭 ---------- */
      else if (act === "mv-bld" || act === "mv-line" || act === "mv-floor" || act === "mv-elev") {
        mvEnsure();
        var mside = el.dataset.side === "to" ? "to" : "from";
        var ms = MV[mside], mvv = el.dataset.v;
        if (act === "mv-bld") {
          if (mvv === "all") ms.buildings = "all";
          else {
            ms.buildings = (ms.buildings === "all") ? [] : ms.buildings.slice();
            var mbi = ms.buildings.indexOf(Number(mvv));
            if (mbi >= 0) ms.buildings.splice(mbi, 1); else ms.buildings.push(Number(mvv));
            if (!ms.buildings.length) ms.buildings = "all";
          }
        } else if (act === "mv-line") {
          ms.lines = togglePick(ms.lines, allLineKeys(), mvv);
        } else if (act === "mv-floor") {
          if (ms.type !== "lobby") { ms.type = "lobby"; ms.floors = (mvv === "all" ? "all" : [mvv]); }
          else ms.floors = togglePick(ms.floors, allFloorNames(), mvv);
        } else {
          if (ms.type !== "elevator") { ms.type = "elevator"; ms.elevators = (mvv === "all" ? "all" : [String(mvv)]); }
          else ms.elevators = togglePick(ms.elevators, allElevKeys(), mvv);
        }
        MV.picked = {};
        refreshMove();
      }
      else if (act === "mv-lslot" || act === "mv-eslot") {
        mvEnsure();
        var lside = el.dataset.side === "to" ? "to" : "from";
        var ls = MV[lside];
        if (act === "mv-lslot") { ls.type = "lobby"; ls.slot = el.dataset.v; }
        else { ls.type = "elevator"; ls.slot = el.dataset.v; }
        MV.picked = {};
        refreshMove();
      }
      else if (act === "mv-pick") {
        mvEnsure();
        var mpk = el.dataset.id;
        MV.picked[mpk] = MV.picked[mpk] === false;
        refreshMove();
      }
      else if (act === "mv-all") {
        mvEnsure();
        var mrows = mvMatches(MV.from);
        var mAllOn = mrows.every(function (it) { return MV.picked[it.id] !== false; });
        MV.picked = {};
        if (mAllOn) mrows.forEach(function (it) { MV.picked[it.id] = false; });
        refreshMove();
      }
      else if (act === "mv-apply") { applyMassMove(); }
      else if (act === "f-cat") { formDefaults.category = el.dataset.v; markChips("#fCat", el); }
      else if (act === "f-board") {
        formState.board = el.dataset.v;
        formState.slot = formState.board === "elevator" ? "01" : formState.slot;
        markChips("#fBoard", el);
        refreshFormParts();
        var slotBox = document.getElementById("fSlot");
        if (slotBox) {
          var max = formState.board === "elevator" ? 6 : 12;
          var html = "";
          for (var i = 1; i <= max; i++) {
            var s = pad2(i);
            html += '<button class="f-chip' + (formState.slot === s ? " on" : "") + '" data-act="f-slot" data-v="' + s + '">' + s + "</button>";
          }
          slotBox.innerHTML = html;
        }
      }
      else if (act === "f-scope") {
        formState.scope = el.dataset.v;
        if (formState.scope === "all") formState.buildings = [];
        markChips("#fScope", el);
        refreshFormParts();
      }
      else if (act === "f-zone") {
        var z = zoneById(el.dataset.v);
        var all = z.buildings.every(function (b) { return formState.buildings.indexOf(b) >= 0; });
        if (all) formState.buildings = formState.buildings.filter(function (b) { return z.buildings.indexOf(b) < 0; });
        else z.buildings.forEach(function (b) { if (formState.buildings.indexOf(b) < 0) formState.buildings.push(b); });
        refreshFormParts();
      }
      else if (act === "f-bld") {
        var no = Number(el.dataset.v);
        var idx = formState.buildings.indexOf(no);
        if (idx >= 0) formState.buildings.splice(idx, 1);
        else formState.buildings.push(no);
        refreshFormParts();
      }
      else if (act === "f-loc") {
        var v = el.dataset.v;
        if (formState.board === "elevator") {
          if (v === "all") formState.elevators = "all";
          else {
            if (formState.elevators === "all") formState.elevators = [];
            var i2 = formState.elevators.indexOf(v);
            if (i2 >= 0) formState.elevators.splice(i2, 1);
            else formState.elevators.push(v);
            if (!formState.elevators.length) formState.elevators = "all";
          }
        } else {
          if (!formState.floors) formState.floors = FAC.boards.lobby.floors.slice();
          var i3 = formState.floors.indexOf(v);
          if (i3 >= 0) formState.floors.splice(i3, 1);
          else formState.floors.push(v);
          if (!formState.floors.length) formState.floors = FAC.boards.lobby.floors.slice();
        }
        refreshFormParts();
      }
      else if (act === "f-slot") {
        formState.slot = el.dataset.v;
        document.querySelectorAll("#fSlot .f-chip").forEach(function (b) {
          b.classList.toggle("on", b.getAttribute("data-v") === formState.slot);
        });
        refreshFormParts();
      }
      else if (act === "f-order") {
        formState.order = Number(el.dataset.v);
        markChips("#fOrder", el);
      }
      else if (act === "f-perm") {
        formDefaults.permanent = !formDefaults.permanent;
        el.textContent = formDefaults.permanent ? "상시 ∞ (해제)" : "상시 ∞";
        var dl = document.getElementById("fDeadline");
        if (dl) dl.disabled = formDefaults.permanent;
      }
      else if (act === "f-photo-clear") {
        formState.photo = null; formState.photoIsNew = true;
        var prev = document.getElementById("fPhotoPrev");
        if (prev) prev.textContent = "사진 없음";
      }
      else if (act === "f-save") { saveNoticeForm(); }
      else if (act === "cf-close") { var cf = document.querySelector(".copyfallback"); if (cf) cf.remove(); }
    });

    document.addEventListener("input", function (e) {
      if (!e.target) return;
      if (e.target.id === "archQ") {
        ARCH_FILTER.q = e.target.value.trim();
        render();
        var q = document.getElementById("archQ");
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      else if (e.target.id === "nfTitle") { nfEnsure(); NF.title = e.target.value; }
      else if (e.target.id === "mvQ") {
        MV_FILTER.q = e.target.value.trim();
        render();
        var mq = document.getElementById("mvQ");
        if (mq) { mq.focus(); mq.setSelectionRange(mq.value.length, mq.value.length); }
      }
    });

    /* 선택조회 기간(년월) 입력 */
    document.addEventListener("change", function (e) {
      if (!e.target) return;
      if (e.target.id === "nfPhoto" || e.target.id === "nfCam") {
        var nfFile = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!nfFile) return;
        toast("사진 압축 중…");
        compressImage(nfFile, function (data, kb) {
          nfEnsure();
          NF.photo = data;
          var prev = document.getElementById("nfPhotoPrev");
          if (prev) prev.innerHTML = '<img src="' + data + '" alt="">';
          var info = document.getElementById("nfPhotoInfo");
          if (info) info.textContent = "첫 장 저장 · 약 " + kb + "KB";
          toast("사진 준비 완료 (" + kb + "KB)");
        });
        return;
      }
      if (e.target.id === "nfDeadline") { nfEnsure(); NF.deadline = e.target.value || ""; return; }
      if (e.target.id === "alertFromM") {
        AZ.from = (e.target.value || "").slice(0, 7);
        if (AZ.to && AZ.to < AZ.from) AZ.to = AZ.from;
        AZ.open = "";
        return;
      }
      if (e.target.id === "alertToM") {
        AZ.to = (e.target.value || "").slice(0, 7);
        if (AZ.from && AZ.to < AZ.from) AZ.from = AZ.to;
        AZ.open = "";
        return;
      }
      if (e.target.id === "cumFrom") {
        HIST.from = (e.target.value || HIST.from).slice(0, 7);
        if (HIST.to < HIST.from) HIST.to = HIST.from;
        render();
      }
      else if (e.target.id === "cumTo") {
        HIST.to = (e.target.value || HIST.to).slice(0, 7);
        if (HIST.to < HIST.from) HIST.from = HIST.to;
        render();
      }
    });

    window.addEventListener("hashchange", function () {
      var lb = document.querySelector(".lightbox");
      if (lb) lb.remove();
      route();
    });
  }

  function markChips(sel, el) {
    document.querySelectorAll(sel + " .f-chip").forEach(function (b) {
      b.classList.toggle("on", b === el);
    });
  }

  /* ---------- data load ---------- */
  function loadFacility() {
    var inline = null;
    try {
      var t = document.getElementById("data-inline");
      if (t) inline = JSON.parse(t.textContent);
    } catch (e) {}
    if (location.protocol === "file:" && inline) return Promise.resolve(inline);
    return fetch("data.json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (j) { return (j && j.buildings) ? j : inline; })
      .catch(function () { return inline; });
  }

  function setNotices(val) {
    NOTICES = [];
    BYID = {};
    if (val) {
      Object.keys(val).forEach(function (k) {
        var n = val[k];
        if (!n || typeof n !== "object") return;
        n.id = n.id || k;
        NOTICES.push(n);
        BYID[n.id] = n;
      });
    }
    buildIndex();
  }

  function start() {
    TODAY = todayStr();
    loadSession();
    document.documentElement.classList.toggle("fs-lg", FONT_LG);
    Promise.all([loadFacility(), new Promise(function (res) {
      try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        db.ref(".info/connected").on("value", function (s) {
          CONNECTED = !!s.val();
          if (LOADED) render();
        });
        db.ref("board/config").on("value", function (s) {
          var v = s.val();
          if (!v) {
            CFG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            db.ref("board/config").set(CFG).catch(function () {});
          } else {
            CFG = Object.assign({}, DEFAULT_CONFIG, v);
            if (!CFG.teams || !CFG.teams.A) CFG.teams = DEFAULT_CONFIG.teams;
          }
          if (LOADED) render();
        }, function (err) { toast("설정을 읽지 못했습니다: " + err.message); });
        db.ref("board/notices").on("value", function (s) {
          var wasLoaded = LOADED;
          setNotices(s.val());
          NOTICES_READY = true;
          tryBoot();
          if (wasLoaded) {
            var form = document.querySelector('.sheet[data-form="1"]');
            if (!form) render();
          }
        }, function (err) {
          document.getElementById("view").innerHTML =
            '<div class="empty-box">게시판 데이터에 연결하지 못했습니다.<br><b>' + esc(err.message) + '</b><br>인터넷 연결을 확인하고 새로고침해 주세요.</div>';
        });
        db.ref("board/logs").limitToLast(50).on("value", function (s) {
          setMoveLogs(s.val());
          if (LOADED && VIEW.name === "create") render();
        }, function () { /* 이동 기록을 읽지 못해도 화면은 그대로 쓴다 */ });
        db.ref("board/daily_alerts").on("value", function (s) {
          setAlerts(s.val());
          if (!LOADED) return;
          if (VIEW.name === "alerts") renderAlertList();
          else if (!document.querySelector('.sheet[data-form="1"]')) render();
        }, function () { /* 알림 기록을 읽지 못해도 다른 화면은 그대로 쓴다 */ });
      } catch (e) {
        document.getElementById("view").innerHTML = '<div class="empty-box">Firebase 초기화 실패: ' + esc(e.message) + "</div>";
        res();
        return;
      }
      res();
    })]).then(function (arr) {
      FAC = arr[0];
      if (!FAC) {
        document.getElementById("view").innerHTML = '<div class="empty-box">시설 데이터(data.json)를 불러오지 못했습니다.</div>';
        return;
      }
      bind();
      syncWho();
      if (!tryBoot() && LOADED) route();
    });
  }

  var api = {
    start: start, summary: summary, statusOf: statusOf, flowOf: flowOf,
    copyText: copyText, buildIndex: buildIndex, targetText: targetText,
    /* 07시 알림 검증용 */
    alerts: {
      set: setAlerts, rows: alertFiltered, hit: alertHit, table: alertTableHtml,
      detail: alertDetailHtml, body: alertBodyHtml, screen: function () { return renderAlerts(); },
      ui: function () { return AZ; }, setUi: function (o) { Object.keys(o || {}).forEach(function (k) { AZ[k] = o[k]; }); },
      state: function () { return ALERTS; }
    },
    /* 겹침 순번 자동화 검증용 (Node 테스트에서 사용) */
    order: {
      overlaps: targetOverlaps, push: pushOrdersForNew, compact: compactOrders, stacked: stackedHere,
      build: buildNoticeUpdates, move: buildMoveUpdates, same: sameTarget,
      load: function (notices, fac) { FAC = fac; ELEV_KEYS_CACHE = null; setNotices(notices); return NOTICES; }
    },
    /* 게시물 통계 집계 검증용 (순수 함수) */
    stats: {
      events: statEvents, aggregate: statAggregate, byDay: statByDay,
      shiftMonth: shiftYm, monthLabel: ymLabel, dateOfTs: ymdOfTs,
      fixture: function () {
        return {
          events: statEvents(NOTICES, FAC),
          hist: { tab: HIST.tab, from: HIST.from, to: HIST.to, month: HIST.month, day: HIST.day }
        };
      },
      setHist: function (o) { Object.keys(o || {}).forEach(function (k) { HIST[k] = o[k]; }); },
      html: function () { return renderHistory(); }
    },
    /* 게시물 생성·이동 검증용 */
    create: {
      reset: nfReset, ensure: nfEnsure, state: function () { return NF; },
      form: function () { return nfFormHtml(); }, place: function () { return nfPlaceHtml(); },
      list: function () { return createListHtml(true); }, targets: nfBuildTargets,
      specText: specPlaceText, lines: lineList, toggle: togglePick
    },
    move: {
      reset: mvReset, ensure: mvEnsure, state: function () { return MV; },
      matches: mvMatches, apply: massMoveUpdates, screen: function () { return moveTabHtml(true); },
      place: specPlaceText, hits: specHitsTarget, same: sameSpec, logs: setMoveLogs
    },
    state: function () { return { TODAY: TODAY, NOTICES: NOTICES, CFG: CFG, SESSION: SESSION }; },
    setToday: function (d) { TODAY = d; buildIndex(); render(); }
  };
  if (typeof document !== "undefined" && document.getElementById("view")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
  if (typeof globalThis !== "undefined") globalThis.__boardTest = api;
  return api;
})();
