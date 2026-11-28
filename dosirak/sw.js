/* =========================================================
   도시락 관리 — 서비스 워커 (2026-11-28)
   목적: 홈 화면에 단독 앱(PWA)으로 설치해 크롬 주소창·배지 없이 실행
   원칙 1: 캐시를 만들지 않는 패스스루 — 항상 네트워크의 최신 app.js/index.html 을 쓴다.
   원칙 2: 새 워커는 화면을 가로채지 않고 **대기(waiting)** 한다.
           화면의 [🆕 새 버전이 준비됐습니다 · 지금 업데이트] 를 눌러
           {type:"SKIP_WAITING"} 을 보낼 때만 넘겨받는다(자동 새로고침 없음).
   ========================================================= */
const VERSION = "20261128a";   /* 배포할 때마다 올린다 — index.html 의 DS_APP_VERSION · version.json 과 같은 값 */

/* 새 워커는 여기서 skipWaiting() 을 부르지 않는다 → waiting 상태로 남는다.
   (부르면 화면이 알기도 전에 구버전 페이지가 새 워커로 바뀌어 버린다) */
self.addEventListener("install", function () {});

/* 화면에서 온 메시지 — [지금 업데이트] 를 누른 순간에만 넘긴다 */
self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  /* 화면이 워커 버전을 물어볼 때 (진단용) */
  if (data.type === "GET_VERSION" && event.source && event.source.postMessage) {
    event.source.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  /* POST 등은 브라우저 기본 동작 — Firebase 쓰기는 건드리지 않는다 */
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  /* 다른 출처(Firebase RTDB·gstatic CDN 등)는 그대로 브라우저에 맡긴다 */
  if (url.origin !== self.location.origin) return;
  /* 같은 출처 GET 은 캐시 없이 네트워크에서 바로 받아온다 (구버전 고착 방지) */
  event.respondWith(fetch(req, { cache: "no-store" }));
});
