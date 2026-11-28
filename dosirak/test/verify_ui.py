#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도시락 관리 — 실제 모바일 뷰포트(390×844) 화면 검증.

    python3 test/verify_ui.py [base_url]

· ?sandbox=1 로 열어 /board/dosirak/sandbox 만 건드린다(실제 데이터 무변경)
· 스크린샷은 /workspace/browser/dosirak-*.png 로 저장
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

# 크롬 실행 파일을 직접 지정할 수 있다(다른 환경의 크로미움으로 검사할 때): PW_CHROME=경로
LAUNCH = {"executable_path": os.environ["PW_CHROME"]} if os.environ.get("PW_CHROME") else {}

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
OUT = "/workspace/browser"
SHOT = "/workspace/downloads/dosirak-test-statement.png"
PW = os.environ.get("DS_PW", "")
problems = []


def check(name, cond, extra=""):
    print(("  ✓ " if cond else "  ✗ ") + name + (("  → " + str(extra)) if extra and not cond else ""))
    if not cond:
        problems.append(name)


def main():
    with sync_playwright() as p:
        bro = p.chromium.launch(**LAUNCH)
        ctx = bro.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True,
                              user_agent="Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 "
                                         "(KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

        url = BASE + "?sandbox=1"
        print("\n[1] 메인 화면", url)
        page.goto(url, wait_until="load")
        page.wait_for_function("document.querySelectorAll('#calGrid .day').length > 20", timeout=20000)
        page.wait_for_function("document.getElementById('sumMeals').textContent !== '0'", timeout=20000)

        check("총 식수 46식", page.inner_text("#sumMeals") == "46", page.inner_text("#sumMeals"))
        check("총 금액 379,500원", page.inner_text("#sumAmount") == "379,500", page.inner_text("#sumAmount"))
        check("김기춘 23식", page.inner_text("#kimMeals") == "23")
        check("조명수 189,750원", page.inner_text("#choAmount") == "189,750")
        check("월말 예상 50식 412,500원",
              page.inner_text("#fxTotalMeals") == "50" and page.inner_text("#fxTotalAmount") == "412,500",
              page.inner_text("#fxTotalMeals") + "/" + page.inner_text("#fxTotalAmount"))
        check("배지 +4식", page.inner_text("#fxBadge") == "+4식", page.inner_text("#fxBadge"))
        check("11-26 메모", "중식0" in page.inner_text("#calGrid"), "메모 없음")
        check("관리자 칩 Admin(샌드박스)", page.inner_text("#admChipText") == "Admin")

        metrics = page.evaluate("""() => {
          const r = el => { const b = el.getBoundingClientRect(); return {t:Math.round(b.top), b:Math.round(b.bottom), h:Math.round(b.height)}; };
          const main = document.getElementById('viewMain');
          return {
            vh: window.innerHeight, vw: window.innerWidth,
            docH: document.documentElement.scrollHeight,
            docW: document.documentElement.scrollWidth,
            mainScroll: main.scrollHeight, mainClient: main.clientHeight,
            head: r(document.querySelector('header.top')),
            sum: r(document.querySelector('.sum')),
            cal: r(document.querySelector('.cal')),
            acts: r(document.querySelector('.acts')),
            dpr: window.devicePixelRatio
          };
        }""")
        print("   ", json.dumps(metrics, ensure_ascii=False))
        check("가로 넘침 없음", metrics["docW"] <= metrics["vw"], metrics["docW"])
        check("한 화면에 들어옴(스크롤 없음)", metrics["mainScroll"] <= metrics["mainClient"] + 1,
              "main %d > %d" % (metrics["mainScroll"], metrics["mainClient"]))
        check("하단 버튼이 화면 안", metrics["acts"]["b"] <= metrics["vh"], metrics["acts"]["b"])
        check("총 식수 카드가 잘리지 않음", metrics["sum"]["t"] >= metrics["head"]["b"] - 1,
              "%s / %s" % (metrics["sum"], metrics["head"]))
        page.screenshot(path=os.path.join(OUT, "dosirak-1-main-390.png"))

        print("\n[2] 정산 화면")
        page.click('button[data-act="settle"]')
        page.wait_for_selector("#viewSettle:not([hidden])")
        check("해시 라우팅 #/settle", page.evaluate("location.hash") == "#/settle", page.evaluate("location.hash"))
        head = [t.strip() for t in page.eval_on_selector_all(
            ".st-row.hd > div", "els => els.map(e => e.textContent)")]
        check("표 헤더 5컬럼", head == ["년월", "거래명세서", "수신일", "대금송금일", "현금영수증"], head)
        rows = page.eval_on_selector_all(".st-row[data-ym]", "els => els.map(e => e.getAttribute('data-ym'))")
        check("월별 행 목록(최신 먼저)", rows == ["2026-11", "2026-10"], rows)
        check("정산 화면에 월 추가 버튼", page.is_visible("#addMonth"))
        page.screenshot(path=os.path.join(OUT, "dosirak-2-settle-390.png"))

        print("\n[3] 정산 등록(관리자)")
        page.click('.st-row[data-ym="2026-11"] .st-c')
        page.wait_for_selector("#ovSettle:not([hidden])")
        check("시트가 열리면 뒤 화면 스크롤 잠금", page.evaluate("document.body.classList.contains('lock')"))
        page.set_input_files("#fileInvoice", SHOT)
        page.wait_for_selector("#up-invoice img.up-thumb", timeout=15000)
        check("거래명세서 사진 미리보기", page.is_visible("#up-invoice img.up-thumb"))
        check("수신일 자동 기록", page.input_value("#stECollect") != "", page.input_value("#stECollect"))
        page.fill("#stERemit", "2026-12-03")
        page.fill("#stEMemo", "테스트 정산")
        page.screenshot(path=os.path.join(OUT, "dosirak-3-upload-390.png"))
        page.click("#stSave")
        page.wait_for_selector("#ovSettle", state="hidden", timeout=15000)
        page.wait_for_function(
            "!!document.querySelector('.st-row[data-ym=\\'2026-11\\'] img.st-thumb')", timeout=15000)
        check("시트를 닫으면 스크롤 잠금 해제", not page.evaluate("document.body.classList.contains('lock')"))
        check("저장 후 행에 사진 표시", page.eval_on_selector_all(
            ".st-row[data-ym='2026-11'] img.st-thumb", "els => els.length") >= 1)
        txt = page.inner_text(".st-row[data-ym='2026-11']")
        check("수신일 표시", "12." in txt, txt)
        check("대금송금일 표시", "12.03" in txt, txt)

        print("\n[4] 사진 팝업")
        page.click(".st-row[data-ym='2026-11'] button[data-kind='invoice']")
        page.wait_for_selector("#lightbox:not([hidden])")
        check("팝업 이미지 로드", page.evaluate(
            "(() => { const i = document.getElementById('lbImg'); return i.complete && i.naturalWidth > 0; })()"))
        check("팝업 캡션", "거래명세서" in page.inner_text("#lbCap"), page.inner_text("#lbCap"))
        page.screenshot(path=os.path.join(OUT, "dosirak-4-photo-390.png"))
        page.click("#lbClose")
        page.wait_for_selector("#lightbox", state="hidden")

        print("\n[5] 조회 모드(관리자 해제)")
        page.click("#admChip")
        page.wait_for_selector("#setSheet:not([hidden])")
        ver_txt = page.inner_text("#setSheet")
        check("설정 시트에 앱 버전", "v2026.11.28" in ver_txt, ver_txt)
        check("설정 시트에 앱 설치 줄", "앱 설치" in page.inner_text("#setSheet"))
        page.click("#setAdminBtn")
        page.wait_for_selector("#setSheet", state="hidden")
        check("관리자 해제 → 조회", page.inner_text("#admChipText") == "조회", page.inner_text("#admChipText"))
        check("관리자 해제 → + 버튼 숨김", page.is_hidden("#fabAdd"))
        page.evaluate("location.hash = '#/'")     # 달력 화면으로
        page.wait_for_selector("#viewMain:not([hidden])")
        page.click('button[data-act="settle"]')
        page.wait_for_selector("#viewSettle:not([hidden])")
        page.click(".st-row[data-ym='2026-11'] .st-c")
        page.wait_for_timeout(300)
        check("조회자는 수정 시트가 안 열림", page.is_hidden("#ovSettle"))
        check("조회자는 월 추가 버튼 숨김", page.is_hidden("#addMonth"))
        page.screenshot(path=os.path.join(OUT, "dosirak-5-settle-nonadmin-390.png"))
        page.click(".st-row[data-ym='2026-11'] button[data-kind='invoice']")
        page.wait_for_selector("#lightbox:not([hidden])")
        check("조회자도 사진 팝업 가능", page.is_visible("#lbImg"))
        page.click("#lbClose")

        print("\n[6] 관리자 암호 인증")
        page.click("#admChip")
        page.wait_for_selector("#setSheet:not([hidden])")
        page.click("#setAdminBtn")
        page.wait_for_selector("#ovAdmin:not([hidden])")
        page.fill("#pwInput", "wrong-password")
        page.click("#pwOk")
        page.wait_for_timeout(400)
        check("틀린 암호는 거절", page.inner_text("#admChipText") == "조회")
        if PW:
            page.fill("#pwInput", PW)
            page.click("#pwOk")
            page.wait_for_timeout(700)
            check("맞는 암호로 관리자 전환", page.inner_text("#admChipText") == "Admin",
                  page.inner_text("#admChipText"))
        else:
            print("  ·DS_PW 가 없어 맞는 암호 입력은 건너뜀")
            page.click("[data-close='ovAdmin']")

        print("\n[7] 앱 설치 · 새 버전 배너")
        page.evaluate("""() => {
          const e = new Event('beforeinstallprompt');
          e.prompt = () => {}; e.userChoice = Promise.resolve({outcome: 'dismissed'});
          window.dispatchEvent(e);
        }""")
        page.wait_for_selector("#pwaPrompt", timeout=5000)
        check("설치 배너 표시", page.is_visible("#pwaPrompt") and "앱 설치" in page.inner_text("#pwaPrompt"),
              page.inner_text("#pwaPrompt"))
        page.screenshot(path=os.path.join(OUT, "dosirak-6-install-banner-390.png"))
        page.click('#pwaPrompt [data-pwa="dismiss"]')

        # 상단 [📲 설치] 칩 · 설치 시트 — beforeinstallprompt 가 없어도 언제든 열린다
        check("상단 설치 칩 보임(브라우저 실행 중)", page.is_visible("#instChip"))
        page.click("#instChip")
        page.wait_for_selector("#ovInstall:not([hidden])", timeout=5000)
        check("설치 시트 열림", page.is_visible("#ovInstall"))
        nsteps = page.eval_on_selector_all("#instSteps li", "e=>e.length")
        check("설치 시트 단계 안내", nsteps >= 2, nsteps)
        check("설치 시트 안내 문구", "설치" in page.inner_text("#instGuide"))
        page.screenshot(path=os.path.join(OUT, "dosirak-10-install-sheet-390.png"))
        page.click("#ovInstall [data-close]")
        page.wait_for_selector("#ovInstall", state="hidden", timeout=5000)
        check("설치 시트 닫힘", page.is_hidden("#ovInstall"))

        # 새 버전 배너 — 실제 배포와 같은 조건(서비스 워커 포함)에서 보려고
        # version.json 을 잠깐 새 버전으로 바꿔 두었다가 되돌린다.
        vpath = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "version.json")
        orig = open(vpath, encoding="utf-8").read()
        data = json.loads(orig)
        data["version"] = "20261128d"      # 지금 버전보다 한 단계 위(가짜 새 버전)
        data["label"] = "v2026.11.28d"
        open(vpath, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2))
        try:
            page2 = ctx.new_page()
            page2.goto(url, wait_until="load")
            page2.wait_for_selector("#pwaPrompt", timeout=12000)
            check("새 버전 배너 표시", "새 버전" in page2.inner_text("#pwaPrompt"), page2.inner_text("#pwaPrompt"))
            check("업데이트 버튼 있음", page2.is_visible('#pwaPrompt [data-pwa="update"]'))
            page2.screenshot(path=os.path.join(OUT, "dosirak-7-update-banner-390.png"))
            page2.close()
        finally:
            open(vpath, "w", encoding="utf-8").write(orig)

        print("\n[8] 리스트 시트")
        page.goto(BASE + "?sandbox=1", wait_until="load")
        page.wait_for_function("document.getElementById('sumMeals').textContent === '46'", timeout=20000)
        page.click('button[data-mode="kim"]')
        page.wait_for_selector("#ovList:not([hidden])")
        check("김기춘 리스트 23건", page.eval_on_selector_all("#ovList .mrow", "e=>e.length") == 23,
              page.eval_on_selector_all("#ovList .mrow", "e=>e.length"))
        page.screenshot(path=os.path.join(OUT, "dosirak-8-list-390.png"))
        page.click("#ovList [data-close]")

        print("\n[9] 오류 점검")
        ignore = ("favicon", "permissions policy violation: unload")
        real = [e for e in errs if not any(k in e.lower() for k in ignore)]
        check("콘솔·페이지 오류 없음", not real, real[:4])
        bro.close()

    print("\n" + "=" * 50)
    if problems:
        print("실패 %d건: %s" % (len(problems), ", ".join(problems)))
        sys.exit(1)
    print("화면 검증 전체 통과")


if __name__ == "__main__":
    main()
