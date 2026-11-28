#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""배포된 실제 주소 확인 — 390×844 모바일 뷰포트.

    DS_PW='…' python3 test/verify_live.py

· 실제 데이터(10월 42식·11월 46식)가 보이는지, 정산 목록·관리자 화면이 뜨는지 본다.
· 저장은 하지 않는다(관리자 화면을 열어 보고 '닫기'만 누른다).
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://kchkim7554-debug.github.io/grandfirst-board/dosirak/"
OUT = "/workspace/browser"
PW = os.environ.get("DS_PW", "")
bad = []


def check(name, cond, extra=""):
    print(("  ✓ " if cond else "  ✗ ") + name + (("  → " + str(extra)) if extra and not cond else ""))
    if not cond:
        bad.append(name)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True,
                            user_agent="Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 "
                                       "(KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        print("[live] " + BASE)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_function("document.getElementById('sumMeals').textContent !== '0'", timeout=30000)
        check("제목 도시락 관리", "도시락 관리" in pg.inner_text("#ttlSub"))
        check("11월 46식", pg.inner_text("#sumMeals") == "46", pg.inner_text("#sumMeals"))
        check("11월 379,500원", pg.inner_text("#sumAmount") == "379,500", pg.inner_text("#sumAmount"))
        check("월말 예상 50식 412,500원",
              pg.inner_text("#fxTotalMeals") == "50" and pg.inner_text("#fxTotalAmount") == "412,500")
        check("처음엔 조회 모드", pg.inner_text("#admChipText") == "조회")
        check("＋ 버튼 숨김(조회자)", pg.is_hidden("#fabAdd"))
        m = pg.evaluate("""() => { const main=document.getElementById('viewMain');
          return {vh:innerHeight, ms:main.scrollHeight, mc:main.clientHeight,
                  actBottom: Math.round(document.querySelector('.acts').getBoundingClientRect().bottom),
                  w:document.documentElement.scrollWidth}; }""")
        check("한 화면에 들어옴", m["ms"] <= m["mc"] + 1 and m["actBottom"] <= m["vh"], m)
        check("가로 넘침 없음", m["w"] <= 390, m["w"])
        pg.screenshot(path=os.path.join(OUT, "dosirak-live-1-main-390.png"))

        pg.click('button[data-act="settle"]')
        pg.wait_for_selector("#viewSettle:not([hidden])")
        rows = pg.eval_on_selector_all(".st-row[data-ym]", "els=>els.map(e=>e.getAttribute('data-ym'))")
        check("정산 목록 2026-11 · 2026-10", rows == ["2026-11", "2026-10"], rows)
        check("정산 화면에 미등록 안내", "미등록" in pg.inner_text("#stTable") or "미입력" in pg.inner_text("#stTable"))
        pg.screenshot(path=os.path.join(OUT, "dosirak-live-2-settle-390.png"))

        if PW:
            pg.click("#admChip")
            pg.wait_for_selector("#setSheet:not([hidden])")
            pg.click("#setAdminBtn")
            pg.wait_for_selector("#ovAdmin:not([hidden])")
            pg.fill("#pwInput", PW)
            pg.click("#pwOk")
            pg.wait_for_selector("#ovAdmin", state="hidden", timeout=8000)
            check("실제 주소에서 관리자 인증", pg.inner_text("#admChipText") == "Admin")
            pg.click(".st-row[data-ym='2026-11'] .st-c")
            pg.wait_for_selector("#ovSettle:not([hidden])")
            check("업로д 화면 열림(저장 안 함)", pg.is_visible("#up-invoice"))
            pg.screenshot(path=os.path.join(OUT, "dosirak-live-3-upload-390.png"))
            pg.click("#ovSettle [data-close]")
            pg.click("#admChip")
            pg.wait_for_selector("#setSheet:not([hidden])")
            pg.click("#setAdminBtn")     # 로그아웃
            pg.wait_for_selector("#setSheet", state="hidden", timeout=8000)
            check("로그아웃 후 조회 모드", pg.inner_text("#admChipText") == "조회", pg.inner_text("#admChipText"))
        else:
            print("  ·DS_PW 없음 — 관리자 화면은 건너뜀")

        check("자바스크립트 오류 없음", not errs, errs[:3])
        b.close()
    print("\n" + ("실패: " + ", ".join(bad) if bad else "배포 주소 확인 통과"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
