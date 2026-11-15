#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Firebase Realtime Database 시드 (테스트 게시물 8건 + 기본 설정).
사용: python3 seed_firebase.py   (board/ 폴더 안에서 실행)
"""
import json, datetime, os, urllib.request

DB = "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app"

def ts(y, mo, d, h=9, mi=0):
    dt = datetime.datetime(y, mo, d, h, mi, tzinfo=datetime.timezone(datetime.timedelta(hours=9)))
    return int(dt.timestamp() * 1000)

PIN_HASH = "280e9599e805b04e6990ecd8a70563e485534485b97cbc93835be8a4bce7965f"
CONFIG = {
    "admins": ["카일", "관리사무소"],
    "pinHash": PIN_HASH,
    "teams": {
        "A": {"label": "A조", "zones": {"front": "염일엽", "backA": "성연무", "backB": "윤주한"}},
        "B": {"label": "B조", "zones": {"front": "황보선희", "backA": "김기춘", "backB": "조명수"}},
    },
}
ALL_FLOORS = ["1층", "지하1층", "지하2층"]

def lobby(slot, order=1, floors=None):
    return {"buildings": "all", "board": "lobby", "floors": floors or ALL_FLOORS, "slot": slot, "order": order}

def elev(slot, order=1):
    return {"buildings": "all", "board": "elevator", "elevators": "all", "slot": slot, "order": order}

def att(name, team, at):
    return {"by": name, "team": team, "at": at}

NOTICES = {
 "N01": {"id":"N01","title":"승강기 정기 점검","category":"안내문","postedAt":"2026-11-10","deadline":"2026-11-30","permanent":False,
   "photo":"images/n01_elevator_inspection.jpg","memo":"승강기 정기 점검 안내 — 공동현관 홀 08번, 3개 층 모두",
   "targets":[lobby("08")],"status":"posted","isTest":True,"archivedAt":None,
   "attach":{"front":att("염일엽","A",ts(2026,11,15,9,5)),"backA":att("김기춘","B",ts(2026,11,15,9,22)),"backB":att("조명수","B",ts(2026,11,15,9,40))},
   "detach":None,"createdAt":ts(2026,11,10,8,30),"createdBy":"관리사무소","updatedAt":ts(2026,11,15,9,40)},
 "N02": {"id":"N02","title":"전기차 충전기 요금 변경","category":"안내문","postedAt":"2026-11-03","deadline":"2026-11-16","permanent":False,
   "photo":"images/n02_ev_charger.jpg","memo":"전기차 충전요금 변경 — 공동현관 홀 02번, 3개 층 모두 (내일 탈착 예시)",
   "targets":[lobby("02")],"status":"posted","isTest":True,"archivedAt":None,
   "attach":{"front":att("염일엽","A",ts(2026,11,14,9,10)),"backA":att("성연무","A",ts(2026,11,14,9,35)),"backB":att("윤주한","A",ts(2026,11,14,10,2))},
   "detach":None,"createdAt":ts(2026,11,3,9,0),"createdBy":"카일","updatedAt":ts(2026,11,14,10,2)},
 "N03": {"id":"N03","title":"계약서 공개","category":"공고문","postedAt":"2026-10-27","deadline":"2026-11-10","permanent":False,
   "photo":"images/n03_contract_disclosure.jpg","memo":"1층만 게시 — 공동현관 홀 12번 (기한 경과 → 탈착 대상 예시)",
   "targets":[lobby("12",1,["1층"])],"status":"posted","isTest":True,"archivedAt":None,
   "attach":{"front":att("황보선희","B",ts(2026,10,27,9,15)),"backA":att("김기춘","B",ts(2026,10,27,9,50)),"backB":att("조명수","B",ts(2026,10,27,10,12))},
   "detach":None,"createdAt":ts(2026,10,27,8,40),"createdBy":"관리사무소","updatedAt":ts(2026,10,27,10,12)},
 "N04": {"id":"N04","title":"주차장 운영규정 제정(안) 입주민 의견청취","category":"공고문","postedAt":"2026-11-13","deadline":"2026-11-20","permanent":False,
   "photo":"images/n04_parking_rules.jpg","memo":"04번 두 번째 겹침 — 후문B는 아직 부착 전(부분 부착 예시)",
   "targets":[lobby("04",2)],"status":"posted","isTest":True,"archivedAt":None,
   "attach":{"front":att("염일엽","A",ts(2026,11,13,9,8)),"backA":att("성연무","A",ts(2026,11,13,9,44))},
   "detach":None,"createdAt":ts(2026,11,13,8,20),"createdBy":"카일","updatedAt":ts(2026,11,13,9,44)},
 "N05": {"id":"N05","title":"세대 내 소방시설 자체 점검 안내","category":"안내문","postedAt":"2026-11-15","deadline":"2026-11-25","permanent":False,
   "photo":"images/n05_fire_safety.jpg","memo":"엘리베이터 내 게시판 우측 03번 — 아직 부착 전(부착 대기 예시)",
   "targets":[elev("03")],"status":"pending_attach","isTest":True,"archivedAt":None,
   "attach":None,"detach":None,"createdAt":ts(2026,11,15,8,10),"createdBy":"관리사무소","updatedAt":ts(2026,11,15,8,10)},
 "N06": {"id":"N06","title":"슬기로운 공동주택 생활","category":"홍보물","postedAt":"2026-09-01","deadline":None,"permanent":True,
   "photo":"images/n06_smart_living.jpg","memo":"상시 게시물 — 공동현관 홀 07번 (별도 지시 전까지 제거하지 않음)",
   "targets":[lobby("07")],"status":"posted","isTest":True,"archivedAt":None,
   "attach":{"front":att("황보선희","B",ts(2026,9,1,9,5)),"backA":att("성연무","A",ts(2026,9,1,9,30)),"backB":att("윤주한","A",ts(2026,9,1,10,0))},
   "detach":None,"createdAt":ts(2026,9,1,8,30),"createdBy":"관리사무소","updatedAt":ts(2026,9,1,10,0)},
 "A01": {"id":"A01","title":"단지 내 수목 전지 작업 안내","category":"안내문","postedAt":"2026-10-20","deadline":"2026-11-05","permanent":False,
   "photo":None,"memo":"보관함 예시 (탈착 완료)",
   "targets":[lobby("05")],"status":"archived","isTest":True,"archivedAt":"2026-11-05",
   "attach":{"front":att("황보선희","B",ts(2026,10,20,9,10)),"backA":att("성연무","A",ts(2026,10,20,9,40)),"backB":att("윤주한","A",ts(2026,10,20,10,5))},
   "detach":{"front":att("황보선희","B",ts(2026,11,5,17,0)),"backA":att("성연무","A",ts(2026,11,5,17,20)),"backB":att("윤주한","A",ts(2026,11,5,17,40))},
   "createdAt":ts(2026,10,20,8,30),"createdBy":"관리사무소","updatedAt":ts(2026,11,5,17,40)},
 "A02": {"id":"A02","title":"관리비 부과 내역 열람 안내","category":"공고문","postedAt":"2026-10-15","deadline":"2026-11-10","permanent":False,
   "photo":None,"memo":"보관함 예시 (탈착 완료, 엘리베이터 05번)",
   "targets":[elev("05")],"status":"archived","isTest":True,"archivedAt":"2026-11-12",
   "attach":{"front":att("염일엽","A",ts(2026,10,15,9,5)),"backA":att("김기춘","B",ts(2026,10,15,9,25)),"backB":att("조명수","B",ts(2026,10,15,9,55))},
   "detach":{"front":att("염일엽","A",ts(2026,11,12,17,5)),"backA":att("김기춘","B",ts(2026,11,12,17,25)),"backB":att("조명수","B",ts(2026,11,12,17,50))},
   "createdAt":ts(2026,10,15,8,30),"createdBy":"카일","updatedAt":ts(2026,11,12,17,50)},
}

def main():
    payload = {"config": CONFIG, "notices": NOTICES}
    req = urllib.request.Request(DB + "/board.json", method="PUT",
                                 data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        print("seed PUT", r.status)
    with urllib.request.urlopen(DB + "/board/notices.json?shallow=true", timeout=30) as r:
        print("keys:", sorted(json.loads(r.read().decode()).keys()))

if __name__ == "__main__":
    main()
