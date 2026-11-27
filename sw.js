/* =========================================================
   게시판 관리 시스템 — 서비스 워커 (2026-11-28)
   목적: 홈 화면에 단독 앱(PWA)으로 설치해 크롬 주소창·배지 없이 실행
   원칙: 캐시를 만들지 않는 패스스루 — 항상 네트워크의 최신 app.js/index.html 을 쓴다.
        skipWaiting() + clients.claim() 으로 구버전 워커가 화면을 붙잡지 않게 한다.
   ========================================================= */
const VERSION = "20261128e";   /* 파일이 바뀔 때마다 올린다 — 워커 갱신 신호 */
self.addEventListener("install", function () {
  self.skipWaiting();
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
