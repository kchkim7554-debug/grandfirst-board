#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""도시락 관리 — Firebase Realtime Database 초기 데이터(10월·11월 식수) 올리기.

dosirak.html 의 기록 규칙을 그대로 옮겨 놓는다.
  · 근무일(짝수일, 일·공휴일 제외)은 두 사람 중식·석식 = 4식
  · 2026-11-26 은 중식 0 · 석식 2식
저장 위치: /board/dosirak/records  (게시판 관리와 같은 Firebase 프로젝트 안의 별도 경로 —
           이 프로젝트의 접근 규칙이 /board 아래만 열어 두어 그 안에 둔다)

사용: python3 seed_dosirak.py            실제로 올린다
      python3 seed_dosirak.py --dry      올리지 않고 결과만 확인
      python3 seed_dosirak.py --sandbox  /dosirak_app/sandbox 에 올린다
"""
import json
import sys
import urllib.request

DB = "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app"
PRICE = 8250
PEOPLE = ["김기춘", "조명수"]
MEALS = ["중식", "석식"]

OCT_DAYS = [1, 7, 13, 15, 17, 19, 21, 23, 27, 31]
NOV_DAYS = [2, 4, 6, 10, 12, 14, 16, 18, 20, 24]
NOV_26 = ["석식"]          # 11-26 은 점심을 다른 것으로 먹어 석식만
NOV_28 = ["중식", "석식"]  # 11-28 정상 4식


def rec_id(date, person, meal):
    return "%s-%s-%s" % (date.replace("-", ""), person, meal)


def build():
    out = {}
    for day in OCT_DAYS:
        for p in PEOPLE:
            for m in MEALS:
                d = "2026-10-%02d" % day
                out[rec_id(d, p, m)] = {"date": d, "person": p, "mealType": m, "price": PRICE,
                                        "by": "Admin"}
    for day in NOV_DAYS:
        for p in PEOPLE:
            for m in MEALS:
                d = "2026-11-%02d" % day
                out[rec_id(d, p, m)] = {"date": d, "person": p, "mealType": m, "price": PRICE,
                                        "by": "Admin"}
    for p in PEOPLE:
        for m in NOV_26:
            d = "2026-11-26"
            out[rec_id(d, p, m)] = {"date": d, "person": p, "mealType": m, "price": PRICE, "by": "Admin"}
    for p in PEOPLE:
        for m in NOV_28:
            d = "2026-11-28"
            out[rec_id(d, p, m)] = {"date": d, "person": p, "mealType": m, "price": PRICE, "by": "Admin"}
    # 10-29 는 조명수만 중식·석식
    for m in MEALS:
        d = "2026-10-29"
        out[rec_id(d, "조명수", m)] = {"date": d, "person": "조명수", "mealType": m, "price": PRICE,
                                       "by": "Admin"}
    return out


def totals(records):
    out = {}
    for k, r in records.items():
        ym = r["date"][:7]
        t = out.setdefault(ym, {"meals": 0, "amount": 0, "김기춘": 0, "조명수": 0})
        t["meals"] += 1
        t["amount"] += r["price"]
        t[r["person"]] += 1
    return out


def main():
    root = "board/dosirak/sandbox" if "--sandbox" in sys.argv else "board/dosirak"
    records = build()
    print("기록 %d건" % len(records))
    for ym, t in sorted(totals(records).items()):
        print("  %s  %2d식 %s원  (김기춘 %d식 / 조명수 %d식)"
              % (ym, t["meals"], format(t["amount"], ","), t["김기춘"], t["조명수"]))
    if "--dry" in sys.argv:
        return
    body = json.dumps(records, ensure_ascii=False).encode("utf-8")
    url = "%s/%s/records.json" % (DB, root)
    req = urllib.request.Request(url, data=body, method="PUT",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        print("PUT /%s/records.json → %s" % (root, r.status))
    with urllib.request.urlopen("%s/%s/records.json?shallow=true" % (DB, root), timeout=30) as r:
        keys = json.loads(r.read().decode() or "{}")
    print("저장된 키 %d개" % len(keys or {}))


if __name__ == "__main__":
    main()
