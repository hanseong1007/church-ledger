#!/usr/bin/env python3
"""비루트 환경에서 Chromium(Playwright) 실행용 라이브러리만 받아 로컬에 푼다.
Debian bookworm .deb를 받아 ar/xz를 직접 풀어 LD_LIBRARY_PATH로 쓴다."""
import io
import os
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

BASE = "https://deb.debian.org/debian"
OUT = Path("/workspace/.local/pwlibs")
POOLS = {
    "libnspr4": "pool/main/n/nspr/",
    "libnss3": "pool/main/n/nss/",
    "libxcomposite1": "pool/main/libx/libxcomposite/",
    "libxdamage1": "pool/main/libx/libxdamage/",
    "libxfixes3": "pool/main/libx/libxfixes/",
    "libxrandr2": "pool/main/libx/libxrandr/",
    "libasound2": "pool/main/a/alsa-lib/",
    "libatk1.0-0": "pool/main/a/atk1.0/",
    "libatk-bridge2.0-0": "pool/main/a/at-spi2-atk/",
    "libatspi2.0-0": "pool/main/a/at-spi2-core/",
    "libdbus-1-3": "pool/main/d/dbus/",
    "libxkbcommon0": "pool/main/libx/libxkbcommon/",
}


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def ar_entries(data):
    if not data.startswith(b"!<arch>\n"):
        raise ValueError("not ar")
    off = 8
    while off + 60 <= len(data):
        hdr = data[off:off + 60]
        name = hdr[0:16].decode().strip()
        size = int(hdr[48:58].decode().strip())
        body = data[off + 60:off + 60 + size]
        yield name.rstrip("/"), body
        off += 60 + size + (size % 2)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for pkg, pool in POOLS.items():
        try:
            listing = fetch(f"{BASE}/{pool}").decode("utf-8", "replace")
        except Exception as e:
            print("listing fail", pkg, e)
            continue
        cands = re.findall(r'href="([^"]*' + re.escape(pkg) + r'_[^"]*_amd64\.deb)"', listing)
        # bookworm 것 우선, 이름 순 마지막(최신) 사용
        picks = [c for c in cands if "bookworm" in c or "/" not in c]
        if not picks:
            print("no deb", pkg, cands[:3])
            continue
        url = BASE + "/" + pool + picks[-1] if not picks[-1].startswith("http") else picks[-1]
        try:
            data = fetch(url, 120)
        except Exception as e:
            print("download fail", pkg, url, e)
            continue
        got = 0
        for name, body in ar_entries(data):
            if not name.startswith("data.tar"):
                continue
            mode = "r:xz" if name.endswith("xz") else ("r:gz" if name.endswith("gz") else "r:")
            with tarfile.open(fileobj=io.BytesIO(body), mode=mode) as tf:
                for m in tf.getmembers():
                    if not (m.isfile() or m.issym()):
                        continue
                    if "/lib" not in m.name:
                        continue
                    rel = m.name.lstrip("./")
                    dest = OUT / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if m.issym():
                        continue
                    with open(dest, "wb") as fh:
                        fh.write(tf.extractfile(m).read())
                    got += 1
        print("ok", pkg, picks[-1], got, "files")


if __name__ == "__main__":
    main()
