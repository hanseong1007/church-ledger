#!/usr/bin/env python3
"""남은 Chromium 프로세스를 정리한다(테스트 반복 실행 시 자원 고갈 방지)."""
import os
import signal
import glob

PAT = "headless-s" + "hell/chrome"
CRASH = "crashpad" + "_handler"
me = os.getpid()
# 부모 프로세스(sh)도 죽이지 않도록 조상 목록은 건드리지 않는다.
skip = set()
pid = me
for _ in range(6):
    skip.add(pid)
    try:
        stat = open(f"/proc/{pid}/stat").read().split()
        pid = int(stat[3])
    except Exception:
        break
killed = 0
for d in glob.glob("/proc/[0-9]*"):
    try:
        p = int(d.split("/")[-1])
    except Exception:
        continue
    if p in skip or p == 1:
        continue
    try:
        cmd = open(d + "/cmdline", "rb").read().decode("utf-8", "replace").replace("\0", " ")
    except Exception:
        continue
    if PAT in cmd or CRASH in cmd:
        try:
            os.kill(p, signal.SIGKILL)
            killed += 1
        except Exception:
            pass
print("killed", killed)
