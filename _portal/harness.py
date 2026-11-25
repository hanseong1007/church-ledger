#!/usr/bin/env python3
"""공용 테스트 하네스: 저장소를 http://127.0.0.1:PORT/church-ledger/ 로 서빙한다."""
import os
import threading
import functools
import http.server
import socketserver
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def start_server(port=None):
    tmp = Path(tempfile.mkdtemp(prefix="dkp-serve-"))
    link = tmp / "church-ledger"
    if not link.exists():
        os.symlink(REPO, link)
    handler = functools.partial(QuietHandler, directory=str(tmp))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port or 0), handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, f"http://127.0.0.1:{port}/church-ledger"


if __name__ == "__main__":
    srv, base = start_server(8123)
    print(base)
    import time
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        srv.shutdown()
