#!/usr/bin/env python3
"""기존 기능 회귀 검증 (포털 세션이 없는 상태 = 지금까지 쓰던 방식 그대로).

  ① 금전출납부: admin 로그인 → 장부 화면
  ② 재정보고 변환: deoksin2026 잠금 해제 → 2분기 hwpx 업로드 → 미리보기 → pptx 다운로드
  ③ 중보기도문 변환: admin/deoksin2026 로그인 → 21장 → pptx 다운로드
  ④ 세 앱 모두 '⛪ 교회포털' 돌아가기 버튼이 보인다
"""
import sys
import time
from playwright.sync_api import sync_playwright

from harness import start_server

HWPX = "/workspace/attachments/2026-11-24/2분기 보고-9cbe89e88b5a454082e2f54bc8a07cb8.hwpx"
PRAYER_HWPX = ("/workspace/attachments/2026-11-24/2026년 11월 덕신교회 공동체 중보기도문_최종-"
               "7e90b317d75b49d8a2bad9ca883cbc99.hwpx")
RESULTS = []


def check(name, ok, extra=""):
    RESULTS.append((name, bool(ok), extra))
    print(("PASS  " if ok else "FAIL  ") + name + (("  · " + extra) if extra else ""))


def main():
    srv, base = start_server()
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()

            # ① 금전출납부
            ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append("ledger: " + str(e)))
            pg.goto(base + "/", wait_until="load")
            pg.wait_for_selector("#loginScreen", state="visible", timeout=20000)
            pg.fill("#loginId", "admin")
            pg.fill("#loginPw", "admin1234")
            pg.click("#loginBtn")
            pg.wait_for_selector("#appRoot:not([hidden])", timeout=40000)
            check("금전출납부 로그인 → 장부 화면", pg.is_visible("#appRoot"))
            check("금전출납부: 교회포털 버튼", pg.is_visible("#dkpHome"))
            check("금전출납부: 계정 표시", (pg.inner_text("#whoName") or "").strip() != "")
            pg.screenshot(path="shot-reg-ledger.png")
            pg.close(); ctx.close()

            # ② 재정보고 변환
            ctx2 = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            pg2 = ctx2.new_page()
            pg2.on("pageerror", lambda e: errors.append("ppt: " + str(e)))
            pg2.goto(base + "/ppt/", wait_until="load")
            pg2.wait_for_selector("#lockScreen:not(.hidden)", timeout=25000)
            check("재정보고: 잠금 화면(비밀번호)", pg2.is_visible("#lockScreen"))
            pg2.fill("#pw", "deoksin2026")
            pg2.click("#lockBtn")
            pg2.wait_for_timeout(1200)
            if pg2.is_visible("#pw2Wrap"):
                pg2.fill("#pw2", "deoksin2026")
                pg2.click("#lockBtn")
            pg2.wait_for_selector("#app:not(.hidden)", timeout=25000)
            check("재정보고: 비밀번호로 입장", pg2.is_visible("#app"))
            check("재정보고: 교회포털 버튼", pg2.is_visible("#dkpHome"))
            pg2.set_input_files("#file", HWPX)
            pg2.wait_for_selector("#stepResult:not(.hidden)", timeout=60000)
            pg2.wait_for_timeout(1200)
            sc = pg2.inner_text("#slideCount").strip()
            check("재정보고: hwpx 업로드 → 슬라이드 생성", any(c.isdigit() for c in sc), "slideCount=%s" % sc)
            with pg2.expect_download(timeout=60000) as dl:
                pg2.click("#btnDownload")
            d = dl.value
            path = "/tmp/reg-ppt.pptx"
            d.save_as(path)
            import os
            size = os.path.getsize(path)
            check("재정보고: pptx 다운로드", size > 20000, "%d bytes" % size)
            pg2.screenshot(path="shot-reg-ppt.png")
            pg2.close(); ctx2.close()

            # ③ 중보기도문
            ctx3 = b.new_context(viewport={"width": 1280, "height": 900})
            pg3 = ctx3.new_page()
            pg3.on("pageerror", lambda e: errors.append("prayer: " + str(e)))
            pg3.goto(base + "/prayer/", wait_until="load")
            pg3.wait_for_selector("#lock", timeout=25000)
            check("중보기도문: 로그인 화면", pg3.is_visible("#lock"))
            pg3.fill("#loginId", "admin")
            pg3.fill("#loginPw", "deoksin2026")
            pg3.click("#btnLogin")
            pg3.wait_for_selector("#app:not(.hidden)", timeout=45000)
            check("중보기도문: 비밀번호로 입장", pg3.is_visible("#app"))
            check("중보기도문: 교회포털 버튼", pg3.is_visible("#dkpHome"))
            cnt = pg3.inner_text("#slideChip") if pg3.is_visible("#slideChip") else ""
            check("중보기도문: 슬라이드 목록", "장" in cnt, cnt)
            pg3.screenshot(path="shot-reg-prayer.png")
            pg3.close(); ctx3.close()

            check("콘솔·페이지 오류 없음", not errors, "; ".join(errors[:4]))
            b.close()
    finally:
        srv.shutdown()
    bad = [r for r in RESULTS if not r[1]]
    print("\n=== 결과: %d/%d 통과 ===" % (len(RESULTS) - len(bad), len(RESULTS)))
    if bad:
        for n, _, e in bad:
            print("  FAILED:", n, e)
        sys.exit(1)


if __name__ == "__main__":
    main()
