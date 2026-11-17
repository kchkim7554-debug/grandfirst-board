#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""겹침 순번(order) 자동화 로직 검증 — Node 없이 QuickJS 로 app.js 를 돌린다.

실행: python3 test/run_quickjs.py     (board/ 폴더에서)
DB에는 아무것도 쓰지 않습니다. (test/live-snapshot.json = 2026-11-18 실 DB 읽기 스냅샷)
"""
import json, os, sys

try:
    import quickjs
except ImportError:
    sys.exit("quickjs 모듈이 필요합니다: pip install quickjs")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


ctx = quickjs.Context()
lines = []
ctx.add_callable("__log", lambda s: lines.append(str(s)))
ctx.eval("""
var console = { log: function () {
  var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
  __log(a.join(" "));
} };
var document = { getElementById: function () { return null; } };
var window = globalThis;
""")
ctx.eval(read("app.js"))
ctx.eval("globalThis.__BOARD_FAC = " + read("data.json") + ";\n"
         "globalThis.__BOARD_LIVE = " + read("test/live-snapshot.json") + ";")
ctx.eval(read("test/order.test.js"))

print("\n".join(lines))
fail = ctx.eval("globalThis.__BOARD_TEST_FAIL")
sys.exit(1 if fail else 0)
