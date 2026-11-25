/* =========================================================
   🧪 테스트용 카피본 환경 설정
   원본 app.js·data.json·이미지를 그대로 쓰면서 아래만 바꾼다.
     · DB 경로  : board        → board/sandbox  (원본 데이터는 읽기 전용 취급)
     · 권한     : PIN 없이 항상 Admin
     · 기기저장 : gf.*         → gf.sandbox.*   (원본 화면과 섞이지 않게)
   이 파일은 scripts/reset_sandbox.py 가 건드리지 않는다(카피본 전용 설정 유지).
   ========================================================= */
window.GF_ENV = {
  sandbox: true,
  dbRoot: "board/sandbox",
  adminLabel: "Admin",
  lsPrefix: "gf.sandbox."
};
