#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""data.json 을 index.html 안의 인라인 데이터(data-inline)에 다시 심는다.

사용법:  python3 build.py
- data.json 이 유일한 원본입니다. 게시물을 고친 뒤 이 스크립트를 실행하면
  index.html 만 열어도(file://) 최신 내용이 보입니다.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.json")
HTML = os.path.join(HERE, "index.html")
MARK_START = '<script type="application/json" id="data-inline">'
MARK_END = "</script>"

def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    with open(HTML, encoding="utf-8") as f:
        html = f.read()

    i = html.index(MARK_START) + len(MARK_START)
    j = html.index(MARK_END, i)
    html = html[:i] + payload + html[j:]

    with open(HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print("inline data embedded:", len(payload), "chars ·",
          len(data["notices"]), "notices ·", len(data["buildings"]), "buildings")

if __name__ == "__main__":
    main()
