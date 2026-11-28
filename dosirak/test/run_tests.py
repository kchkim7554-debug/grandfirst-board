#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도시락 관리 — 단위 테스트 (Node 없이 QuickJS 로 core.js 를 돌린다).

    python3 test/run_tests.py            전체 검사
    python3 test/run_tests.py --verbose  통과 항목도 모두 출력

검사 범위
  1. core.js 순수 계산 — 돈·날짜·집계·월말 예상·정산 행
  2. 배포 데이터(10월 42식 346,500원 · 11월 46식 379,500원) 재현
  3. index.html 껍데기 — 앱 이름·5컬럼 정산 표·버튼·스크립트 순서
  4. 버전 일치( index.html · pwa.js · sw.js · version.json · manifest.json )
  5. 관리자 암호 해시(평문 미포함) 확인
  6. app.js · pwa.js 문법 검사
"""
import hashlib
import json
import os
import re
import sys

try:
    import quickjs
except ImportError:
    sys.exit("quickjs 모듈이 필요합니다: pip install quickjs")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERBOSE = "--verbose" in sys.argv

PASS = 0
FAIL = 0
FAILED = []


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        if VERBOSE:
            print("  ✓ " + name)
    else:
        FAIL += 1
        FAILED.append(name + (("  → " + str(extra)) if extra else ""))
        print("  ✗ " + name + (("  → " + str(extra)) if extra else ""))


def eq(name, got, want):
    ok(name, got == want, "기대 %r / 실제 %r" % (want, got))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def section(title):
    print("\n[" + title + "]")


# ---------------------------------------------------------------- 준비
ctx = quickjs.Context()
ctx.eval(read("core.js"))
ctx.eval("""
var SEED = (function(){
  var out = [];
  var OCT = [1,7,13,15,17,19,21,23,27,31], NOV = [2,4,6,10,12,14,16,18,20,24];
  function add(d, p, m){ out.push({id:d+"-"+p+"-"+m, date:d, person:p, mealType:m, price:8250}); }
  var P = ["김기춘","조명수"], M = ["중식","석식"];
  function pad(n){ return (n<10?"0":"")+n; }
  OCT.forEach(function(day){ P.forEach(function(p){ M.forEach(function(m){ add("2026-10-"+pad(day), p, m); }); }); });
  NOV.forEach(function(day){ P.forEach(function(p){ M.forEach(function(m){ add("2026-11-"+pad(day), p, m); }); }); });
  P.forEach(function(p){ add("2026-11-26", p, "석식"); });
  P.forEach(function(p){ M.forEach(function(m){ add("2026-11-28", p, m); }); });
  M.forEach(function(m){ add("2026-10-29", "조명수", m); });
  return out;
})();
var C = DS_CORE;
""")

# ---------------------------------------------------------------- 1. 기본 계산
section("1. 돈 · 날짜")
eq("won(0)", ctx.eval("C.won(0)"), "0")
eq("won(8250)", ctx.eval("C.won(8250)"), "8,250")
eq("won(379500)", ctx.eval("C.won(379500)"), "379,500")
eq("won(1234567)", ctx.eval("C.won(1234567)"), "1,234,567")
eq("won 문자열 숫자", ctx.eval("C.won('346500')"), "346,500")
eq("ymLabel(2026-11)", ctx.eval("C.ymLabel('2026-11')"), "2026년 11월")
eq("ymLabel(2027-01)", ctx.eval("C.ymLabel('2027-01')"), "2027년 1월")
eq("shiftYm +1", ctx.eval("C.shiftYm('2026-11', 1)"), "2026-12")
eq("shiftYm +2 해 넘김", ctx.eval("C.shiftYm('2026-12', 1)"), "2027-01")
eq("shiftYm -1", ctx.eval("C.shiftYm('2026-01', -1)"), "2025-12")
eq("validYm 정상", ctx.eval("C.validYm('2026-11')"), True)
eq("validYm 13월", ctx.eval("C.validYm('2026-13')"), False)
eq("validYm 빈 값", ctx.eval("C.validYm('')"), False)
eq("daysInMonth 2026-11", ctx.eval("C.daysInMonth('2026-11')"), 30)
eq("daysInMonth 2026-12", ctx.eval("C.daysInMonth('2026-12')"), 31)
eq("daysInMonth 2028-02(윤년)", ctx.eval("C.daysInMonth('2028-02')"), 29)
eq("dateParts", ctx.eval("JSON.stringify(C.dateParts('2026-11-30'))"), '{"y":"2026","md":"11.30"}')
eq("dateParts 빈 값", ctx.eval("C.dateParts('')"), None)
eq("isoDate 점 표기", ctx.eval("C.isoDate('2026.12.3')"), "2026-12-03")
eq("isoDate 슬래시", ctx.eval("C.isoDate('2026/12/03')"), "2026-12-03")
eq("isoDate 이상값", ctx.eval("C.isoDate('12월')"), "")
eq("dotDate", ctx.eval("C.dotDate('2026-11-30')"), "2026.11.30")
eq("korDate", ctx.eval("C.korDate('2026-11-28')"), "2026년 11월 28일")
eq("weekdayKo 2026-11-28", ctx.eval("C.weekdayKo('2026-11-28')"), "토")

# ---------------------------------------------------------------- 2. 집계
section("2. 식수 집계 (10월·11월 실제 데이터)")
eq("전체 기록 수", ctx.eval("SEED.length"), 88)
eq("10월 식수", ctx.eval("C.monthStats(SEED,'2026-10').meals"), 42)
eq("10월 금액", ctx.eval("C.monthStats(SEED,'2026-10').amount"), 346500)
eq("10월 김기춘", ctx.eval("C.monthStats(SEED,'2026-10').byPerson['김기춘'].meals"), 20)
eq("10월 조명수", ctx.eval("C.monthStats(SEED,'2026-10').byPerson['조명수'].meals"), 22)
eq("11월 식수", ctx.eval("C.monthStats(SEED,'2026-11').meals"), 46)
eq("11월 금액", ctx.eval("C.monthStats(SEED,'2026-11').amount"), 379500)
eq("11월 김기춘", ctx.eval("C.monthStats(SEED,'2026-11').byPerson['김기춘'].meals"), 23)
eq("11월 조명수 금액", ctx.eval("C.monthStats(SEED,'2026-11').byPerson['조명수'].amount"), 189750)
eq("11-26 하루 2식", ctx.eval("C.dayStats(SEED,'2026-11-26').meals"), 2)
eq("11-26 금액", ctx.eval("C.dayStats(SEED,'2026-11-26').amount"), 16500)
eq("11-26 메모", ctx.eval("C.dayNote(SEED,'2026-11-26')"), "중식0·석식2")
eq("11-28 메모 없음(정상 4식)", ctx.eval("C.dayNote(SEED,'2026-11-28')"), "")
eq("기록 없는 날 메모 없음", ctx.eval("C.dayNote(SEED,'2026-11-27')"), "")
eq("11-27 3식이면 메모", ctx.eval("C.dayNote([{date:'2026-11-27',person:'김기춘',mealType:'중식',price:8250},"
                                "{date:'2026-11-27',person:'김기춘',mealType:'석식',price:8250},"
                                "{date:'2026-11-27',person:'조명수',mealType:'중식',price:8250}],'2026-11-27')"),
   "중식2·석식1")
eq("이상한 기록은 무시", ctx.eval("C.monthStats([null, 1, {date:'2026-11-02',person:'김기춘',mealType:'중식',price:8250},'x'],'2026-11').meals"), 1)

# ---------------------------------------------------------------- 3. 월말 예상
section("3. 월말 예상")
eq("11-28 기준 남은 짝수 근무일", ctx.eval("JSON.stringify(C.remainingWorkDays('2026-11',SEED,'2026-11-28'))"), "[30]")
eq("11-28 예상 합계 식수", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').total.meals"), 50)
eq("11-28 예상 합계 금액", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').total.amount"), 412500)
eq("11-28 예상 조명수 금액", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').cho.amount"), 206250)
eq("11-28 추가 식수", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').addedMeals"), 4)
eq("11-28 배지 문구", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').addedMeals > 0 ? '+' + C.forecast(SEED,'2026-11','2026-11-28').addedMeals + '식' : '확정'"), "+4식")
eq("기준 문구에 남은 날짜", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').basis.indexOf('30일 근무') >= 0"), True)
eq("기준 문구에 4식", ctx.eval("C.forecast(SEED,'2026-11','2026-11-28').basis.indexOf('1일 × 4식 = +4식') >= 0"), True)
eq("지난 달은 확정", ctx.eval("C.forecast(SEED,'2026-10','2026-11-28').confirmed"), True)
eq("지난 달 예상 = 현재", ctx.eval("C.forecast(SEED,'2026-10','2026-11-28').total.amount"), 346500)
eq("11-30 기록 후엔 확정", ctx.eval("C.forecast(SEED.concat([{date:'2026-11-30',person:'김기춘',mealType:'중식',price:8250}]),'2026-11','2026-11-30').addedMeals"), 0)
eq("일요일은 근무일 아님(2026-11-29)", ctx.eval("C.remainingWorkDays('2026-11',[],'2026-11-27').indexOf(29) < 0"), True)
eq("공휴일 제외(2026-12-25)", ctx.eval("C.remainingWorkDays('2026-12',[],'2026-12-23').indexOf(25) < 0"), True)
eq("짝수일만(2026-12)", ctx.eval("JSON.stringify(C.remainingWorkDays('2026-12',[],'2026-12-01'))"), "[2,4,8,10,12,14,16,18,22,24,26,28,30]")
eq("단가 기본값", ctx.eval("C.forecast([],'2026-11','2026-11-01').avgUnit"), 8250)

# ---------------------------------------------------------------- 4. 정산
section("4. 도시락 대금 정산")
eq("settleRow 빈 값", ctx.eval("JSON.stringify(C.settleRow('2026-11',null))"),
   json.dumps({"ym": "2026-11", "invoiceImg": "", "invoiceAt": "", "invoiceBy": "",
               "receiptImg": "", "receiptAt": "", "receiptBy": "",
               "collectDate": "", "remitDate": "", "memo": "", "updatedAt": 0,
               "hasInvoice": False, "hasReceipt": False}, ensure_ascii=False, separators=(",", ":")))
row = {"collectDate": "2026.12.02", "remitDate": "2026-12-03",
       "invoice": {"img": "data:image/jpeg;base64,AAA", "at": "2026-12-02T01:00:00Z", "by": "Admin"},
       "receipt": {"img": "data:image/jpeg;base64,BBB", "at": "2026-12-03T01:00:00Z"}}
eq("settleRow 년월", ctx.eval("C.settleRow('2026-11',%s).ym" % json.dumps(row)), "2026-11")
eq("settleRow 수신일 정규화", ctx.eval("C.settleRow('2026-11',%s).collectDate" % json.dumps(row)), "2026-12-02")
eq("settleRow 사진 있음", ctx.eval("C.settleRow('2026-11',%s).hasInvoice" % json.dumps(row)), True)
eq("settleRow 현금영수증 있음", ctx.eval("C.settleRow('2026-11',%s).hasReceipt" % json.dumps(row)), True)
eq("옛 형식(문자열) 사진도 읽기", ctx.eval("C.settleRow('2026-11',{invoice:'data:image/png;base64,ZZZ'}).invoiceImg"), "data:image/png;base64,ZZZ")
eq("정산 완료 판정", ctx.eval("C.settleState(C.settleRow('2026-11',%s))" % json.dumps(row)), "done")
eq("진행 중 판정", ctx.eval("C.settleState(C.settleRow('2026-11',{invoice:{img:'x'}}))"), "part")
eq("미등록 판정", ctx.eval("C.settleState(C.settleRow('2026-11',{}))"), "none")
eq("미등록 문구", ctx.eval("C.settleStateLabel(C.settleRow('2026-11',{}))"), "미등록")
eq("월 목록(최신 먼저)", ctx.eval("JSON.stringify(C.monthList(SEED,{'2026-12':{}}))"), '["2026-12","2026-11","2026-10"]')
eq("월 목록 — 기록만 있어도 포함", ctx.eval("JSON.stringify(C.monthList(SEED,{}))"), '["2026-11","2026-10"]')
eq("월 목록 — 이상한 키 제외", ctx.eval("JSON.stringify(C.monthList([],{'2026-13':{}, 'x':{}, '2026-01':{}}))"), '["2026-01"]')
eq("사진 크기 계산(빈 값)", ctx.eval("C.dataUrlBytes('')"), 0)
ok("사진 크기 계산(base64)", 70000 < ctx.eval("C.dataUrlBytes('data:image/jpeg;base64,' + 'A'.repeat(100000))") < 76000,
   ctx.eval("C.dataUrlBytes('data:image/jpeg;base64,' + 'A'.repeat(100000))"))
eq("긴 변 줄이기(가로)", ctx.eval("JSON.stringify(C.fitSize(2400,1200,1200))"), '{"w":1200,"h":600}')
eq("긴 변 줄이기(세로)", ctx.eval("JSON.stringify(C.fitSize(800,3200,1200))"), '{"w":300,"h":1200}')
eq("작은 사진은 그대로", ctx.eval("JSON.stringify(C.fitSize(800,600,1200))"), '{"w":800,"h":600}')
eq("크기 0 은 그대로", ctx.eval("JSON.stringify(C.fitSize(0,0,1200))"), '{"w":0,"h":0}')

# ---------------------------------------------------------------- 5. index.html 껍데기
section("5. index.html 껍데기")
html = read("index.html")
ok("앱 이름 '도시락 관리' (title)", "<title>도시락 관리</title>" in html)
ok("상단 제목 '도시락 관리'", 'id="ttlSub"' in html and '>도시락 관리<' in html)
ok("manifest 연결", 'rel="manifest" href="manifest.json"' in html)
ok("테마 컬러", 'name="theme-color"' in html)
ok("viewport-fit(안전영역)", "viewport-fit=cover" in html)
for bid in ["sumMeals", "sumAmount", "kimMeals", "kimAmount", "choMeals", "choAmount",
            "fxKimMeals", "fxChoMeals", "fxTotalMeals", "fxTotalAmount", "fxBasis",
            "calGrid", "stTable", "addMonth", "admChip", "fabAdd", "setSheet", "lightbox"]:
    ok("요소 #" + bid, ('id="%s"' % bid) in html)
ok("김기춘 리스트 버튼", 'data-mode="kim"' in html and "김기춘 리스트" in html)
ok("조명수 리스트 버튼", 'data-mode="cho"' in html and "조명수 리스트" in html)
ok("총 리스트 버튼", 'data-mode="total"' in html and "총 리스트" in html)
ok("정산 버튼 문구", "거래명세서, 도시락대금 정산 결과" in html)
ok("정산 화면 제목", "도시락 대금 정산" in html)
ok("내역 추가 시트 순서 — 날짜 → 선택 날짜 등록 내역 → 입력 폼(이름·구분·단가)",
   html.index('id="mDate"') < html.index('id="mExisting"') < html.index('id="mPerson"') < html.index('id="mPrice"'))
ok("정산 표 그리드 5칸", "grid-template-columns:26% 18% 20% 20% 16%" in html)
ok("모달 스크롤 잠금 CSS", "html.lock,body.lock{overflow:hidden" in html)
ok("PWA 배너 CSS", ".pwap{" in html and ".pwaset{" in html)
ok("CDN 의존 없음(Tailwind·FontAwesome 없음)", "tailwindcss" not in html and "font-awesome" not in html)
ok("스크립트 순서 core → pwa → app",
   html.index('<script src="core.js') < html.index('<script src="pwa.js') < html.index('<script src="app.js'))
ok("관리자 암호 입력란", 'id="pwInput"' in html and 'type="password"' in html)
ok("관리자에게만 보이는 FAB", 'id="fabAdd"' in html)
ok("문서 lang=ko", '<html lang="ko">' in html)

# ---------------------------------------------------------------- 6. 버전 일치
section("6. 버전 일치")
v_html = re.search(r'DS_APP_VERSION = "([^"]+)"', html).group(1)
v_pwa = re.search(r'FALLBACK_VERSION = "([^"]+)"', read("pwa.js")).group(1)
v_sw = re.search(r'const VERSION = "([^"]+)"', read("sw.js")).group(1)
v_json = json.loads(read("version.json"))["version"]
mani = json.loads(read("manifest.json"))
eq("index.html = version.json", v_html, v_json)
eq("pwa.js = version.json", v_pwa, v_json)
eq("sw.js = version.json", v_sw, v_json)
ok("manifest 아이콘에 버전 쿼리", all(v_json in i["src"] for i in mani["icons"]))
ok("manifest 이름", mani["name"] == "도시락 관리" and mani["short_name"] == "도시락 관리")
ok("manifest standalone", mani["display"] == "standalone")
for f in ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
          "icons/apple-touch-icon-180.png", "icons/favicon-32.png", "icons/favicon-16.png"]:
    ok("아이콘 파일 " + f, os.path.exists(os.path.join(ROOT, f)))
ok("아이콘 512 실제 크기", open(os.path.join(ROOT, "icons/icon-512.png"), "rb").read(24)[16:24] ==
   (512).to_bytes(4, "big") + (512).to_bytes(4, "big"))

# ---------------------------------------------------------------- 7. 관리자 암호
section("7. 관리자 암호")
appjs = read("app.js")
m_hash = re.search(r'DEFAULT_PW_HASH = "([0-9a-f]{64})"', appjs)
ok("해시 상수 형식", bool(m_hash))
m_salt = re.search(r'ADMIN_PW_SALT = "([^"]+)"', appjs)
ok("salt 는 이 앱 전용", bool(m_salt) and m_salt.group(1) != "grandfirst-board|")
# 게시판 관리와 같은 암호를 쓰되 salt 가 달라 해시가 달라야 한다
board_hash = "36c3d0d67a8be4415b438ec9121fade6f2fdb8e5ea4d79df4560dadcf9458fdb"
ok("게시판 관리와 다른 해시", bool(m_hash) and m_hash.group(1) != board_hash)
# 평문은 저장소에 두지 않는다 — 확인이 필요할 때만 환경변수로 넘긴다(커밋되는 파일에는 남기지 않음)
pw_env = os.environ.get("DOSIRAK_PW")
if pw_env and m_hash:
    calc = hashlib.sha256((m_salt.group(1) + pw_env).encode()).hexdigest()
    eq("암호 해시 일치(환경변수로 확인)", calc, m_hash.group(1))
else:
    print("  ·암호 대조는 DOSIRAK_PW=… python3 test/run_tests.py 로 확인합니다(평문 미저장)")
ok("소스에 비밀번호 같은 리터럴 없음",
   not re.search(r'(password|passwd|pw)\s*[:=]\s*["\'][^"\']{4,}["\']', appjs, re.I))
saves = re.findall(r'localStorage\.setItem\(([^;]+);', appjs)
ok("입력값은 기기에 저장하지 않음(세션 플래그만)",
   bool(saves) and all(('"admin"' in s) or ("demoRecords" in s) for s in saves), saves)

# ---------------------------------------------------------------- 8. 앱 문법 · 동작
section("8. app.js · pwa.js 문법과 권한 흐름")
def syntax_ok(src, label):
    try:
        r = ctx.eval("(typeof (function(){\n" + src + "\n}))")
        return r == "function"
    except Exception as e:  # quickjs 는 문법 오류를 예외로 올린다
        print("   문법 오류(%s): %s" % (label, e))
        return False


ok("app.js 문법", syntax_ok(appjs, "app.js"))
ok("pwa.js 문법", syntax_ok(read("pwa.js"), "pwa.js"))
ok("관리자만 식수 추가", "function addMeal()" in appjs and 'if (!S.admin) { toast("관리자만 기록할 수 있습니다")' in appjs)
ok("관리자만 삭제", 'if (!S.admin) { toast("관리자만 삭제할 수 있습니다")' in appjs)
ok("관리자만 정산 저장", 'if (!S.admin) { toast("관리자만 저장할 수 있습니다")' in appjs)
ok("정산 표 헤더 5컬럼", all(('>' + h + '<') in appjs for h in ["년월", "거래명세서", "수신일", "대금송금일", "현금영수증"]))
ok("'수금' 옛 표기가 화면에 남지 않음(수신일로 통일)",
   ("수금" not in appjs) and ("수금" not in html) and ("수금" not in read("core.js")))
ok("정산 시트 라벨도 수신일", '<label>수신일</label>' in appjs)
ok("상단 안내 문구 수신·송금일", "수신·송금일" in html)
ok("사진 업로드 input(거래명세서·현금영수증)", 'id="fileInvoice"' in appjs and 'id="fileReceipt"' in appjs)
ok("행별 월 목록(최신 먼저)", "C.monthList(S.records, S.settles)" in appjs and "months.forEach" in appjs)
ok("일반 사용자 사진 보기 허용", 'else if (act === "st-doc")' in appjs)
ok("일반 사용자 정산 수정은 안내만", 'if (S.admin) openSettleSheet(ym); else toast("관리자만 등록·수정할 수 있습니다")' in appjs)
ok("일반 사용자 날짜 탭은 조회", 'if (S.admin) openMealSheet(d); else openList(null, d);' in appjs)
ok("수신일 자동 기록", 'if (e.invoiceImg && !collect) collect = todayStr();' in appjs)
ok("사진 리사이즈(1200px, q0.72)", "readImage(file, 1200, 0.72)" in appjs)
ok("실시간 구독(records·settlements)", 'ROOT + "/records"' in appjs and 'ROOT + "/settlements"' in appjs)
ok("샌드박스 분리(?sandbox=1)", 'q.get("sandbox") === "1"' in appjs and 'ROOT = ROOT + "/sandbox"' in appjs)
ok("삭제 전 확인창", "confirm(" in appjs)

# ---------------------------------------------------------------- 9. swift: 합계
print("\n" + "=" * 62)
print("통과 %d · 실패 %d" % (PASS, FAIL))
if FAIL:
    print("\n실패 목록:")
    for f in FAILED:
        print("  - " + f)
    sys.exit(1)
print("전체 통과 — 배포 가능")
