#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""🧪 카피본 초기화 — "카피본 초기화해" 했을 때 이 한 줄로 끝난다.

하는 일
  1) sandbox/index.html 을 원본 board/index.html 로 다시 만든다
     (🧪 배너·자동 Admin·board/sandbox 설정은 그대로 유지)
  2) 원본 Firebase /board 데이터를 읽어(읽기만) /board/sandbox 에 덮어쓴다
     · 원본 /board 에는 쓰지 않는다 — 읽기만.
     · 카피본 안에 남은 옛 테스트 데이터는 통째로 사라진다.
  3) 결과를 확인해 알려 준다(게시물 수·로그 수·개인 닉네임 잔존 여부).

사용:
  python3 scripts/reset_sandbox.py               # 실제 초기화
  python3 scripts/reset_sandbox.py --dry-run     # 무엇을 할지 확인만
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

sys.path.insert(0, HERE)
import make_sandbox  # noqa: E402  (같은 폴더)

BASE = "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app"
SRC_NODE = "board"          # 원본 (읽기 전용)
DST_NODE = "board/sandbox"  # 카피본 (전부 덮어씀)
ADMIN_LABEL = "Admin"
SCRUB = "\uce74\uc77c"      # 카피본 안에는 남기지 않는 개인 닉네임 (소스에 글자로 남기지 않음)


def http_json(path):
    url = "%s/%s.json" % (BASE, path)
    with urllib.request.urlopen(url, timeout=30) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw) if raw.strip() else None


def http_put(path, obj):
    url = "%s/%s.json" % (BASE, path)
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def scrub(obj):
    """닉네임을 Admin 으로 바꾼 사본을 돌려준다 (원본 데이터는 손대지 않음)."""
    if isinstance(obj, str):
        return obj.replace(SCRUB, ADMIN_LABEL)
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, dict):
        return {scrub(k): scrub(v) for k, v in obj.items()}
    return obj


def count(node):
    if isinstance(node, dict):
        return len(node)
    if isinstance(node, list):
        return len(node)
    return 0


def rebuild_page():
    with open(make_sandbox.SRC, encoding="utf-8") as f:
        html = make_sandbox.build(f.read())
    with open(make_sandbox.OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("✓ sandbox/index.html 재생성 (원본 board/index.html 기준)")


def main() -> int:
    dry = "--dry-run" in sys.argv[1:]

    print("① 원본 %s 읽는 중…" % SRC_NODE)
    src = http_json(SRC_NODE) or {}
    data = {k: v for k, v in src.items() if k != "sandbox"}   # 카피본 자신은 제외
    data = scrub(data)

    cfg = data.get("config") or {}
    admins = cfg.get("admins") or []
    if admins and admins[0] != ADMIN_LABEL:
        admins[0] = ADMIN_LABEL
        cfg["admins"] = admins
    print("   게시물 %d건 · 로그 %d건 · 알림 %d개 · 관리자 %s"
          % (count(data.get("notices")), count(data.get("logs")),
             count(data.get("daily_alerts")), " · ".join(cfg.get("admins") or [])))

    if dry:
        print("② --dry-run: /%s 에는 쓰지 않았습니다." % DST_NODE)
        print("   (실행하면 위 데이터로 /%s 를 통째로 덮어씁니다)" % DST_NODE)
        return 0

    print("② 카피본 /%s 덮어쓰는 중…" % DST_NODE)
    status = http_put(DST_NODE, data)
    if status not in (200, 204):
        print("✗ 쓰기 실패 (HTTP %s)" % status)
        return 1

    back = http_json(DST_NODE) or {}
    ok_n = count(back.get("notices"))
    ok_l = count(back.get("logs"))
    leftover = SCRUB in json.dumps(back, ensure_ascii=False)
    print("③ 확인: /%s 게시물 %d건 · 로그 %d건 · 닉네임 잔존 %s"
          % (DST_NODE, ok_n, ok_l, "있음 ⚠" if leftover else "없음 ✓"))

    rebuild_page()
    print("✅ 카피본 초기화 완료 — https://kchkim7554-debug.github.io/grandfirst-board/sandbox/")
    return 0 if (ok_n == count(data.get("notices")) and not leftover) else 1


if __name__ == "__main__":
    sys.exit(main())
