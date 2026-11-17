#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Firebase Realtime Database — 실제 게시물 시드.

notices_real.json(현장 사진 19장 판독 결과)을 읽어
/board/notices.json 만 PUT 으로 교체합니다.
/board/config (관리자 PIN 해시·담당자) 는 건드리지 않습니다.

사용: python3 seed_firebase.py            (board/ 폴더 안에서 실행)
      python3 seed_firebase.py --dry     (DB에 쓰지 않고 결과만 출력)
"""
import json, datetime, os, sys, urllib.request, urllib.error

DB = "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app"
HERE = os.path.dirname(os.path.abspath(__file__))

# 구역별 담당자 (DB /board/config 의 B조 기준). 부착 기록은 등록 시점 기준 일괄 입력값입니다.
ZONE_GUARD = {
    "front": {"by": "염일엽", "team": "A"},
    "backA": {"by": "김기춘", "team": "B"},
    "backB": {"by": "조명수", "team": "B"},
}
ALL_FLOORS = ["1층", "지하1층", "지하2층"]


def ts(y, mo, d, h=9, mi=0):
    dt = datetime.datetime(y, mo, d, h, mi,
                           tzinfo=datetime.timezone(datetime.timedelta(hours=9)))
    return int(dt.timestamp() * 1000)


def build():
    with open(os.path.join(HERE, "notices_real.json"), encoding="utf-8") as f:
        src = json.load(f)["notices"]

    now = int(datetime.datetime.now().timestamp() * 1000)
    attach_at = {"front": ts(2026, 11, 16, 17, 20),
                 "backA": ts(2026, 11, 16, 17, 25),
                 "backB": ts(2026, 11, 16, 17, 30)}

    out = {}
    for nid, n in src.items():
        attach = {z: {"by": g["by"], "team": g["team"], "at": attach_at[z]}
                  for z, g in ZONE_GUARD.items()}
        board = n.get("board") or "lobby"
        if board == "lobby":
            floors = n.get("floors") if n.get("floors") else ALL_FLOORS
            target = {
                "buildings": "all",
                "board": "lobby",
                "floors": floors,
                "slot": n["slot"],
                "order": n["order"],
            }
        else:
            target = {
                "buildings": "all",
                "board": "elevator",
                "elevators": "all",
                "slot": n["slot"],
                "order": n["order"],
            }
        out[nid] = {
            "id": nid,
            "title": n["title"],
            "category": n["category"],
            "postedAt": n["postedAt"],
            "deadline": n["deadline"],
            "permanent": bool(n["permanent"]),
            "photo": n["photo"],
            "memo": n["memo"],
            "targets": [target],
            "status": "posted",
            "isTest": False,
            "archivedAt": None,
            "attach": attach,
            "detach": None,
            "createdAt": now,
            "createdBy": "카일",
            "updatedAt": now,
        }
    return out


def main():
    notices = build()
    body = json.dumps(notices, ensure_ascii=False).encode("utf-8")
    print("게시물 %d건 · %.1f KB" % (len(notices), len(body) / 1024))
    if "--dry" in sys.argv:
        print(json.dumps(notices, ensure_ascii=False, indent=1)[:2000])
        return
    req = urllib.request.Request(DB + "/board/notices.json", data=body, method="PUT",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        print("PUT /board/notices.json →", r.status)
    with urllib.request.urlopen(DB + "/board/notices.json?shallow=true", timeout=30) as r:
        keys = sorted(json.loads(r.read().decode()).keys())
    print("저장된 키 %d개: %s" % (len(keys), ", ".join(keys)))
    with urllib.request.urlopen(DB + "/board/config/pinHash.json", timeout=30) as r:
        print("config 확인 — pinHash:", json.loads(r.read().decode()))


if __name__ == "__main__":
    main()
