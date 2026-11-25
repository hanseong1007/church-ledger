#!/usr/bin/env python3
"""포털 [내 계정 → 앱 비밀번호 설정] 으로 관리자 계정의 앱 비밀번호를 맞추고,
그 상태에서 재정보고·중보기도문이 비밀번호 없이 열리는지 실주소에서 확인한다."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DKP_BASE", "https://hanseong1007.github.io/church-ledger").rstrip("/")
ADMIN = ("admin", "admin1234")
PPT_PW = "deoksin2026"
PRAYER_PW = "deoksin2026"
R = []


def check(n, ok, x=""):
    R.append((n, bool(ok), x))
    print(("PASS  " if ok else "FAIL  ") + n + (("  · " + x) if x else ""), flush=True)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg = ctx.new_page()
            pg.goto(BASE + "/portal/", wait_until="load")
            pg.wait_for_selector("#login-form", state="visible", timeout=30000)
            pg.fill("#login-id", ADMIN[0]); pg.fill("#login-pw", ADMIN[1])
            pg.click("#login-btn")
            pg.wait_for_selector("#dash:not([hidden])", timeout=60000)
            pg.click("#btn-cred-open")
            pg.wait_for_selector("#cred-panel:not([hidden])", timeout=10000)
            pg.fill("#cr-ledger-id", "admin")
            pg.fill("#cr-ledger-pw", ADMIN[1])
            pg.fill("#cr-ppt-id", "admin")
            pg.fill("#cr-ppt-pw", PPT_PW)
            pg.fill("#cr-prayer-id", "admin")
            pg.fill("#cr-prayer-pw", PRAYER_PW)
            pg.fill("#cred-pw-check", ADMIN[1])
            pg.click("#btn-cred-save")
            pg.wait_for_timeout(6000)
            check("앱 비밀번호 저장", pg.is_hidden("#cred-panel"), pg.inner_text("#toast"))
            pg.screenshot(path="shot-account-creds.png", full_page=True)
            ctx.close()

            # 새 기기(새 컨텍스트)에서 관리자로 로그인 → 재정보고·중보기도문 입장
            ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg = ctx.new_page()
            pg.goto(BASE + "/portal/", wait_until="load")
            pg.wait_for_selector("#login-form", state="visible", timeout=30000)
            pg.fill("#login-id", ADMIN[0]); pg.fill("#login-pw", ADMIN[1])
            pg.click("#login-btn")
            pg.wait_for_selector("#dash:not([hidden])", timeout=60000)
            pg.screenshot(path="shot-live-admin-dash.png", full_page=True)

            n0 = len(ctx.pages)
            pg.click('#apps .appcard:has(h3:text-is("재정보고 변환")) [data-open]')
            for _ in range(70):
                if len(ctx.pages) > n0:
                    break
                pg.wait_for_timeout(300)
            p2 = ctx.pages[-1]
            p2.wait_for_timeout(16000)
            ok2 = p2.is_visible("#app")
            check("관리자: 재정보고 비밀번호 없이 입장", ok2, p2.url if ok2 else p2.inner_text("#lockErr"))
            p2.screenshot(path="shot-live-ppt.png")
            p2.close()

            n1 = len(ctx.pages)
            pg.click('#apps .appcard:has(h3:text-is("중보기도문 변환")) [data-open]')
            for _ in range(70):
                if len(ctx.pages) > n1:
                    break
                pg.wait_for_timeout(300)
            p3 = ctx.pages[-1]
            p3.wait_for_timeout(20000)
            ok3 = p3.is_visible("#app")
            check("관리자: 중보기도문 비밀번호 없이 입장", ok3, p3.url if ok3 else p3.inner_text("#lockMsg"))
            if ok3:
                p3.screenshot(path="shot-live-prayer.png")
            ctx.close()
        finally:
            b.close()
    bad = [r for r in R if not r[1]]
    print("\n=== 결과: %d/%d 통과 ===" % (len(R) - len(bad), len(R)))
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
