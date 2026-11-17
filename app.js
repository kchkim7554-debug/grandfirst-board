"use strict";
/* =========================================================
   💓💓게시판 관리💓💓 — 풍경채 그랑퍼스트
   실시간 다중 사용자 게시판 (Firebase Realtime Database / Spark 무료)
   프로세스: 1 등록(관리자) → 2 부착 체크 → 3 탈착 체크 → 4 보관함
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
  var BYID = {};                        // id → notice
  var INDEX = {}, PLACE = {}, BSTAT = {};   // 게시판 인덱스
  var TODAY = "";
  var VIEW = { name: "home", no: null, core: null, loc: null, slot: null };
  var ZONE = "all";
  var FONT_LG = false;
  var SESSION = { role: null, team: "A", zone: "front", name: "", admin: "" };
  var ARCH_FILTER = { date: "all", slot: "all", q: "" };
  var CONNECTED = false;
  var LOADED = false;
  var db = null;
  var lastRenderKey = "";

  var STATUS_LABEL = {
    overdue: "기한 경과", today: "오늘 탈착", tomorrow: "내일 탈착",
    soon: "기한 임박", active: "게시 중", permanent: "상시", removed: "탈착 완료"
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
    if (st.key === "removed") return "탈착 완료 " + dotDate(n.archivedAt || "");
    if (st.key === "overdue") return "기한 " + dotDate(n.deadline) + " · " + st.days + "일 경과";
    if (st.key === "today") return "기한 " + dotDate(n.deadline) + " · 오늘 탈착";
    if (st.key === "tomorrow") return "기한 " + dotDate(n.deadline) + " · 내일 탈착";
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

  /* ---------- board index (부착된 구역만 노출) ---------- */
  function floorKey(f) { return f === "1층" ? "f1" : f === "지하1층" ? "fb1" : "fb2"; }
  function locLabel(locKey) { return ({ f1: "1층", fb1: "지하1층", fb2: "지하2층" })[locKey] || locKey; }
  function boardKey(no, core, loc, slot) { return no + "|" + core + "|" + loc + "|" + pad2(slot); }

  function buildIndex() {
    INDEX = Object.create(null);
    PLACE = Object.create(null);
    BSTAT = {};
    FAC.buildings.forEach(function (b) { BSTAT[b.no] = { ids: {}, urgent: {}, sheets: 0, pending: 0 }; });

    NOTICES.forEach(function (n) {
      PLACE[n.id] = PLACE[n.id] || [];
      // 부착 대기 집계 (도면에는 표시하지 않음)
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
          if (placedZones.indexOf(b.zone) < 0) return;  // 부착 완료된 구역만 도면 표시
          b.cores.forEach(function (core) {
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
     order 1 = 맨 앞(가장 나중에 붙인 것), 숫자가 클수록 뒤(아래)로 밀린 것.
     신규 게시물은 1번째로 들어가고, 같은 자리에 이미 붙어 있는 게시물은 한 칸씩 뒤로 밀린다.
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

  /* 탈착·삭제로 자리가 비었을 때 남은 활성 게시물의 순번을 1,2,3… 으로 다시 이어 붙인다.
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

  /* 지금 이 자리에 몇 장이 어떤 순번으로 붙어 있는지 (등록 화면 안내용) */
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

  function openLightbox(src, cap) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = '<button class="lb-close" aria-label="닫기">×</button><img src="' + esc(src) + '" alt=""><div class="lb-cap">' + esc(cap || "") + "</div>";
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
    var html = '<p class="f-hint" style="margin:0 2px 10px">부착·탈착 체크는 담당자 확인 후 기록됩니다. 내 조와 구역을 고르세요. (이 기기에 기억됩니다)</p>';
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
  function toggleZoneCheck(id, kind, zone, team) {
    var n = getNotice(id);
    if (!n) return;
    var existing = zoneCheck(n, kind, zone);
    if (existing) {
      if (SESSION.role !== "admin") {
        toast(kind === "attach"
          ? "이미 " + (existing.by || "담당자") + " 님이 부착 완료했습니다 (해제는 관리자만)"
          : "이미 " + (existing.by || "담당자") + " 님이 탈착 완료했습니다 (해제는 관리자만)");
        return;
      }
      var path = "board/notices/" + id + "/" + kind + "/" + zone;
      fbUpdate({}).then(function () {});
      db.ref(path).remove().then(function () {
        writeLog({ noticeId: id, type: kind + "_undo", zone: zone, by: actor() ? actor().name : "", at: nowTs(), title: n.title });
        toast((kind === "attach" ? "부착" : "탈착") + " 체크를 해제했습니다");
        afterZoneChange(id);
      }).catch(function (e) { toast("저장 실패: " + e.message); });
      return;
    }
    requireGuard(function (a) {
      var updates = {};
      updates["board/notices/" + id + "/" + kind + "/" + zone] =
        { by: a.name, team: a.team, at: nowTs() };
      var status = n.status;
      var attachState = Object.assign({}, n.attach || {});
      var detachState = Object.assign({}, n.detach || {});
      if (kind === "attach") {
        attachState[zone] = { by: a.name, team: a.team, at: nowTs() };
        updates["board/notices/" + id + "/status"] = "posted";
      } else {
        detachState[zone] = { by: a.name, team: a.team, at: nowTs() };
        var zs = applicableZones(n);
        var allDone = zs.every(function (z) { return !!detachState[z]; });
        if (allDone) {
          updates["board/notices/" + id + "/status"] = "archived";
          updates["board/notices/" + id + "/archivedAt"] = TODAY;
        }
      }
      updates["board/notices/" + id + "/updatedAt"] = nowTs();
      // 탈착 완료로 보관함에 들어가면 남은 게시물의 순번을 1,2,3… 으로 이어 붙인다
      if (updates["board/notices/" + id + "/status"] === "archived") {
        var comp = compactOrders(targetsOf(n), [id]);
        Object.keys(comp.updates).forEach(function (k) { updates[k] = comp.updates[k]; });
      }
      fbUpdate(updates).then(function (ok) {
        if (!ok) return;
        writeLog({
          noticeId: id, type: kind, zone: zone, by: a.name, team: a.team, at: nowTs(), title: n.title
        });
        toast((kind === "attach" ? "부착 완료" : "탈착 완료") + " · " + zoneName(zone) + " (" + a.name + ")");
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
    var flowPill = fl === "pending" ? '<span class="pill pending">부착 대기</span>'
      : fl === "attaching" ? '<span class="pill pending">부착 진행</span>'
        : fl === "removing" ? '<span class="pill overdue">탈착 필요</span>'
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

    // 구역별 부착/탈착 기록
    html += '<div style="margin-top:12px"><div class="sec-h" style="margin:0 0 6px"><h3>구역별 기록</h3></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:.7rem">' +
      '<tr style="color:var(--muted)"><th style="text-align:left;padding:3px 2px">구역</th><th style="padding:3px 2px">부착</th><th style="padding:3px 2px">탈착</th></tr>';
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
        btns += '<button class="btn line" data-act="force-archive" data-id="' + esc(id) + '">탈착 완료 처리</button>';
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
  /* 부착 전 게시물은 '게시 중' 대신 '부착 전'으로 표시 */
  function statusPillFor(n) {
    var fl = flowOf(n);
    if (fl === "pending" || fl === "attaching") {
      return '<span class="pill pending">' + (n.permanent ? "상시 · 부착 전" : "부착 전") + "</span>";
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
      '<div class="stat warn"><span class="stat-num">' + s.counts.today + '</span><span class="stat-label">오늘 탈착</span></div>' +
      '<div class="stat info"><span class="stat-num">' + s.pending + '</span><span class="stat-label">부착 대기</span></div>' +
      '<div class="stat ok"><span class="stat-num">' + s.posted + '</span><span class="stat-label">게시 중</span></div>' +
      "</div>";
  }
  function renderHero(s) {
    var cls, title, sub;
    if (s.counts.overdue > 0) {
      cls = "danger";
      title = "오늘 탈착 대상 " + (s.counts.overdue + s.counts.today) + "건";
      sub = "기한이 지난 게시물이 " + s.counts.overdue + "건 그대로 붙어 있습니다." +
        (s.counts.today ? " 오늘 기한 도래 " + s.counts.today + "건." : "") + " 근무 중 바로 탈착해 주세요.";
    } else if (s.counts.today > 0) {
      cls = "warn";
      title = "오늘 탈착 대상 " + s.counts.today + "건";
      sub = "오늘 기한이 끝나는 게시물입니다. 퇴근 전 탈착 확인해 주세요.";
    } else if (s.pending > 0) {
      cls = "warn";
      title = "부착할 게시물 " + s.pending + "건";
      sub = "관리자가 등록한 게시물이 부착을 기다리고 있습니다. 부착 체크 후 게시판에 반영됩니다.";
    } else {
      cls = "ok";
      title = "오늘 탈착 대상 없음";
      sub = "기한이 지났거나 오늘 끝나는 게시물이 없습니다.";
    }
    var extra = s.counts.tomorrow > 0 ? " 내일 탈착 예정 " + s.counts.tomorrow + "건." : "";
    return '<section class="hero ' + cls + '">' +
      '<div class="hero-kicker">' + korDate(TODAY) + " (" + weekday(TODAY) + ") 기준 · 게시판 " + num(s.sheetsTotal) + "장 게시 중</div>" +
      '<div class="hero-title">' + esc(title) + "</div>" +
      '<div class="hero-sub">' + esc(sub + extra) + "</div>" +
      '<div class="hero-actions">' +
      '<button class="btn primary" data-act="copy" data-kind="today">' +
      '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>' +
      "오늘 탈착 목록 복사</button>" +
      '<button class="btn ghost" data-act="tab" data-tab="tasks">체크하러 가기</button>' +
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
        (st.pending ? '<span class="btile-pending">부착 ' + st.pending + "</span>" : "") +
        "</button>";
    });
    h += "</div>";
    h += '<p class="note">동을 누르면 라인·층·엘리베이터별 게시판 그림이 열립니다. 빨간 숫자는 오늘 탈착할 게시물 수입니다. 부착 완료 전 게시물은 그림에 나타나지 않습니다.</p>';
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
      '<button class="mini-btn" data-act="tab" data-tab="tasks">부착·탈착 ' + (summary().pending + summary().removing) + "건</button>" +
      "</div>";
  }
  function renderHome() {
    var s = summary();
    var h = syncBar();
    h += renderHero(s);
    h += renderStats(s);
    h += '<div class="sec-title"><h2>동별 게시판</h2><span class="hint">' + (ZONE === "all" ? "전체 구역" : zoneName(ZONE)) + "</span></div>";
    h += renderZones();
    h += renderBuildingGrid();
    h += renderFacility();
    h += '<p class="note">게시물·담당자 정보는 Firebase에 실시간 저장됩니다. 경비원 8명이 같은 화면을 함께 봅니다.' +
      (hasTest() ? "<br><b>테스트 데이터가 포함되어 있습니다.</b> 등록·관리 탭에서 한 번에 지울 수 있습니다." : "") + "</p>";
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
      '<span><i class="sw tomorrow"></i>내일 탈착</span>' +
      '<span><i class="sw today"></i>오늘 탈착</span>' +
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
      '<div class="board-sum">게시 ' + bs.total + "장<br>" + (bs.urgent ? "<b>탈착 " + bs.urgent + "칸</b>" : "탈착 0칸") + "</div></div>";
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

  /* ---------- tasks view (부착·탈착 체크) ---------- */
  function chkCell(n, kind, zone, team) {
    var zs = applicableZones(n);
    if (zs.indexOf(zone) < 0) {
      return '<div class="chk na" aria-label="대상 아님"><span class="box">–</span><span class="zn">' + esc(zoneShort(zone)) + '</span><span class="nm">대상 아님</span></div>';
    }
    var st = zoneCheck(n, kind, zone);
    var gname = guardName(team, zone);
    if (st) {
      return '<button class="chk on" data-act="chk-undo" data-id="' + esc(n.id) + '" data-kind="' + kind + '" data-zone="' + zone + '">' +
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
      ? '<span class="pill pending">' + (someAttached(n) ? "부착 진행 " + attachedZones(n).length + "/" + applicableZones(n).length : "부착 대기") + "</span>"
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

    var h = '<div class="sec-title"><h2>부착·탈착 체크</h2><span class="hint">' + korDate(TODAY) + " (" + weekday(TODAY) + ")</span></div>";
    h += '<div class="warnbox">부착 완료를 체크하면 그 구역 <b>도면에 바로 게시</b>됩니다. 탈착은 모든 대상 구역이 체크되면 자동으로 <b>보관함</b>으로 이동합니다.</div>';

    h += '<div class="sec-h"><h3>② 부착 필요</h3><span class="count">' + attachList.length + "건</span></div>";
    if (!attachList.length) {
      h += '<div class="empty-box" style="border-style:solid;background:var(--green-bg);color:var(--green);border-color:var(--green-line);font-weight:700">부착할 게시물이 없습니다.</div>';
    } else {
      h += attachList.map(function (n) { return taskCard(n, "attach"); }).join("");
    }

    h += '<div class="sec-h"><h3>③ 탈착 필요</h3><span class="count">' + detachList.length + "건</span></div>";
    if (!detachList.length) {
      h += '<div class="empty-box" style="border-style:solid;background:var(--green-bg);color:var(--green);border-color:var(--green-line);font-weight:700">오늘 탈착할 게시물이 없습니다.</div>';
    } else {
      h += detachList.map(function (n) { return taskCard(n, "detach"); }).join("");
    }

    var upcoming = NOTICES.filter(function (n) {
      return !isArchived(n) && allAttached(n) && !needsRemove(n) && !n.permanent && n.deadline;
    }).sort(sortByDeadline).slice(0, 6);
    h += '<div class="sec-h"><h3>게시 중 (탈착 예정)</h3><span class="count">' + upcoming.length + "건</span>" +
      '<span class="spacer"></span><button class="mini-btn" data-act="copy" data-kind="all">전체 복사</button></div>';
    if (!upcoming.length) {
      h += '<div class="empty-box">예정된 탈착이 없습니다.</div>';
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

  /* ---------- admin view ---------- */
  function renderAdmin() {
    var h = '<div class="sec-title"><h2>등록·관리</h2><span class="hint">관리자 전용</span></div>';
    if (SESSION.role !== "admin") {
      h += '<div class="card" style="padding:16px;text-align:center">' +
        '<div style="font-size:1.5rem">🔒</div>' +
        '<div style="font-size:.92rem;font-weight:800;margin-top:6px">관리자 인증이 필요합니다</div>' +
        '<div style="font-size:.74rem;color:var(--muted);line-height:1.6;margin-top:6px">게시물 등록·수정·삭제, 담당자 설정은 관리자(카일·관리사무소)가 PIN으로 인증한 뒤 사용할 수 있습니다.<br>경비원은 조회와 부착·탈착 체크를 바로 쓰실 수 있습니다.</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn solid" data-act="admin-login" style="flex:1">관리자 인증</button></div></div>';
      h += '<p class="note">PIN을 잊으셨다면 관리자 계정(kchkim7554@gmail.com)의 Firebase 콘솔에서 board/config/pinHash를 지우면 기본 PIN(7554)으로 돌아갑니다.</p>';
      return h;
    }
    h += '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<button class="btn solid" data-act="new-notice" style="flex:1">＋ 새 게시물 등록</button>' +
      '<button class="btn line" data-act="settings" style="flex:0 0 auto">설정</button></div>';

    var live = NOTICES.filter(function (n) { return !isArchived(n); });
    var arch = NOTICES.filter(isArchived);
    live.sort(function (a, b) {
      var fa = flowOf(a), fb = flowOf(b);
      var rank = { removing: 0, attaching: 1, pending: 2, posted: 3 };
      if (rank[fa] !== rank[fb]) return rank[fa] - rank[fb];
      return sortByDeadline(a, b);
    });
    h += '<div class="sec-h"><h3>게시 중·대기</h3><span class="count">' + live.length + "건</span>" +
      '<span class="spacer"></span><button class="mini-btn" data-act="cleanup">정리 안내</button></div>';
    if (!live.length) {
      h += '<div class="empty-box">등록된 게시물이 없습니다.<br><b>＋ 새 게시물 등록</b>으로 시작하세요.</div>';
    } else {
      h += '<div class="list">' + live.map(function (n) {
        var fl = flowOf(n);
        var pill = fl === "pending" ? '<span class="pill pending">부착 대기</span>'
          : fl === "attaching" ? '<span class="pill pending">부착 ' + attachedZones(n).length + "/" + applicableZones(n).length + "</span>"
            : fl === "removing" ? '<span class="pill overdue">탈착 필요</span>'
              : '<span class="pill active">게시 중</span>';
        return '<button class="row" data-act="open-notice" data-id="' + esc(n.id) + '">' +
          '<span class="row-main">' +
          '<span style="display:flex;gap:4px;flex-wrap:wrap">' + (fl === "posted" ? statusPill(n) : pill) + testTag(n) + "</span>" +
          '<span class="row-title">' + esc(n.title) + "</span>" +
          '<span class="row-sub">' + esc(targetsText(n)) + "</span>" +
          '<span class="row-sub">' + esc(statusText(n)) + "</span></span>" +
          '<span class="row-arrow">›</span></button>';
      }).join("") + "</div>";
    }

    h += '<div class="sec-h"><h3>보관함</h3><span class="count">' + arch.length + "건</span></div>";
    h += '<div class="list"><button class="row" data-act="tab" data-tab="archive"><span class="row-main">' +
      '<span class="row-title">보관함 열기</span><span class="row-sub">탈착 완료된 게시물 조회·수정·삭제·재등록</span></span>' +
      '<span class="row-arrow">›</span></button></div>';

    if (hasTest()) {
      h += '<div class="sec-h"><h3>테스트 데이터</h3><span class="count">' + NOTICES.filter(function (n) { return n.isTest; }).length + "건</span></div>";
      h += '<button class="btn danger wide" data-act="del-test">테스트 데이터 일괄 삭제</button>';
      h += '<p class="note">테스트 표시된 게시물(6건 + 보관함 예시)만 지웁니다. 실제 게시물은 남습니다.</p>';
    }
    return h;
  }

  /* ---------- archive view ---------- */
  function renderArchive() {
    var arch = NOTICES.filter(isArchived);
    var h = '<div class="sec-title"><h2>보관함</h2><span class="hint">탈착 완료 ' + arch.length + "건</span></div>";
    if (!arch.length) {
      return h + '<div class="empty-box">아직 탈착 완료된 게시물이 없습니다.<br>모든 구역의 탈착 체크가 끝나면 이곳으로 자동 이동합니다.</div>';
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

    h += '<div class="sec-h"><h3>탈착 기록</h3><span class="count">' + list.length + "건</span></div>";
    if (!list.length) {
      h += '<div class="empty-box">조건에 맞는 보관 기록이 없습니다.</div>';
      return h;
    }
    h += '<div class="list">' + list.map(function (n) {
      return '<button class="row" data-act="open-notice" data-id="' + esc(n.id) + '">' +
        '<span class="row-main">' +
        '<span style="display:flex;gap:4px;flex-wrap:wrap"><span class="pill removed">탈착 ' + mmdd(n.archivedAt || "") + "</span>" + testTag(n) + "</span>" +
        '<span class="row-title">' + esc(n.title) + "</span>" +
        '<span class="row-sub">' + esc(targetsText(n)) + "</span>" +
        '<span class="row-sub">게시 ' + dotDate(n.postedAt) + " · 기한 " + (n.deadline ? dotDate(n.deadline) : "상시") + "</span>" +
        "</span><span class=\"row-arrow\">›</span></button>";
    }).join("") + "</div>";
    h += '<p class="note">탈착 날짜·게시 번호로 찾을 수 있습니다. ' +
      (SESSION.role === "admin" ? "게시물을 누르면 수정·삭제·재등록할 수 있습니다." : "수정·삭제는 관리자 인증 후 가능합니다.") + "</p>";
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
      html = '<div class="empty-box">이 번호는 비어 있습니다.<br>부착 완료 체크 전의 게시물은 이곳에 보이지 않습니다.</div>';
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
      '<div class="f-hint">상시 게시물은 탈착 목록에 오르지 않고, 관리자가 직접 탈착 처리할 때까지 유지됩니다.</div></div>';

    html += '<div class="fld"><label>메모 (선택)</label><textarea class="f-ta" id="fMemo" placeholder="현장 메모">' + esc(formDefaults.memo) + "</textarea></div>";

    html += '<div class="form-actions"><button class="btn line" data-act="close-sheet" style="flex:1">취소</button>' +
      '<button class="btn solid" data-act="f-save" style="flex:1.4">' + (isEdit ? "수정 저장" : "등록 (부착 대기)") + "</button></div>";

    openSheet({
      title: isEdit ? "게시물 수정" : "새 게시물 등록",
      sub: isEdit ? "수정해도 부착 기록은 유지됩니다" : "등록 후 부착 체크 전까지 도면에 표시되지 않습니다",
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
      return '<div class="f-hint">전체 ' + FAC.buildings.length + "개동 · 정문/후문A/후문B 모두 게시 (구역별 부착 체크 필요)</div>";
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
        (n ? ' (지금 ' + n + '장 → 2~' + (n + 1) + '번째로 밀림)' : "") + ".</div>" +
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
    html += '<div class="f-hint">이름을 바꾸면 부착·탈착 담당자 표시가 함께 바뀝니다.</div></div>';
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
    if (!confirm("모든 대상 구역을 탈착 완료로 처리하고 보관함으로 옮길까요?")) return;
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
    if (todo.length) line += "\n   " + (kind === "attach" ? "미부착" : "미탈착") + ": " + todo.map(zoneShort).join("·");
    return line;
  }
  function copyText(kind) {
    var s = summary();
    var lines = [];
    lines.push("[제일풍경채 그랑퍼스트 1단지] 게시판 부착·탈착 안내");
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
      section("탈착 대상", detachList, "detach");
      if (attachList.length) section("부착 필요", attachList, "attach");
    } else {
      section("탈착 대상", detachList, "detach");
      section("부착 필요", attachList, "attach");
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
    if (p[0] === "tasks") return { name: "tasks" };
    if (p[0] === "admin") return { name: "admin" };
    if (p[0] === "archive") return { name: "archive" };
    if (p[0] === "b") {
      return { name: "building", no: Number(p[1]) || null, core: p[2] || null, loc: p[3] || "f1", slot: p[4] || null };
    }
    return { name: "home" };
  }
  function setTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("on", t.dataset.tab === name);
    });
  }
  function render() {
    if (!FAC || !LOADED) return;
    var view = document.getElementById("view");
    var h = "";
    if (VIEW.name === "home") { h = renderHome(); setTab("home"); }
    else if (VIEW.name === "tasks") { h = renderTasks(); setTab("tasks"); }
    else if (VIEW.name === "admin") { h = renderAdmin(); setTab("admin"); }
    else if (VIEW.name === "archive") { h = renderArchive(); setTab("archive"); }
    else if (VIEW.name === "building") { h = renderBuilding(); setTab("home"); }
    view.innerHTML = h;
    syncWho();
    var badge = document.getElementById("taskBadge");
    if (badge) {
      var s = summary();
      var n = s.pending + s.removing;
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? "99+" : String(n);
    }
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

      if (act === "tab") { go(el.dataset.tab === "home" ? "#/" : "#/" + el.dataset.tab); }
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
      else if (act === "zoom") { openLightbox(el.dataset.src, el.dataset.cap); }
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
      else if (act === "cleanup") { toast("부착·탈착 탭에서 체크하세요. 도면은 부착 후 표시됩니다."); }
      else if (act === "arch-date") { ARCH_FILTER.date = el.dataset.v; render(); }
      else if (act === "arch-slot") { ARCH_FILTER.slot = el.dataset.v; render(); }
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
      if (e.target && e.target.id === "archQ") {
        ARCH_FILTER.q = e.target.value.trim();
        render();
        var q = document.getElementById("archQ");
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
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
          setNotices(s.val());
          if (!LOADED) { LOADED = true; VIEW = parseHash(); route(); }
          else {
            var form = document.querySelector('.sheet[data-form="1"]');
            if (!form) render();
          }
        }, function (err) {
          document.getElementById("view").innerHTML =
            '<div class="empty-box">게시판 데이터에 연결하지 못했습니다.<br><b>' + esc(err.message) + '</b><br>인터넷 연결을 확인하고 새로고침해 주세요.</div>';
        });
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
      if (LOADED) route();
    });
  }

  var api = {
    start: start, summary: summary, statusOf: statusOf, flowOf: flowOf,
    copyText: copyText, buildIndex: buildIndex, targetText: targetText,
    /* 겹침 순번 자동화 검증용 (Node 테스트에서 사용) */
    order: {
      overlaps: targetOverlaps, push: pushOrdersForNew, compact: compactOrders, stacked: stackedHere,
      build: buildNoticeUpdates,
      load: function (notices, fac) { FAC = fac; ELEV_KEYS_CACHE = null; setNotices(notices); return NOTICES; }
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
