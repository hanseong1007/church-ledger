#!/usr/bin/env python3
"""교회 통합 포털 E2E 검증 (Playwright)

  ① 관리자 로그인 → 사용자 추가(앱 일부만 체크)
  ② 그 사용자로 새 컨텍스트(다른 기기)에서 로그인 → 체크된 앱만 표시 + 비밀번호 없이 입장
  ③ 미허용 앱 직접 주소 접근 차단
  ④ 테스트 계정 정리(시트·금전출납부 계정·동기화 슬롯)

컨텍스트를 단계마다 닫아 메모리를 비운다(작은 테스트 환경에서 렌더러가 죽지 않도록).
실행: LD_LIBRARY_PATH=/workspace/.local/pwlibs/usr/lib/x86_64-linux-gnu python3 test_e2e.py
"""
import gc
import hashlib
import json
import os
import urllib.request

from playwright.sync_api import sync_playwright

from harness import start_server

ADMIN_ID, ADMIN_PW = "admin", "admin1234"
U1 = {"id": "tester", "name": "테스트집사", "pw": "test1234", "apps": ["ledger", "ppt"],
      "labels": ["금전출납부", "재정보고 변환"]}
U2 = {"id": "tester2", "name": "테스트권사", "pw": "test1234", "apps": ["ledger", "prayer"],
      "labels": ["금전출납부", "중보기도문 변환"],
      "cred": {"prayer": ("admin", "deoksin2026")}}

LEDGER_URL = ("https://script.google.com/macros/s/AKfycbwyS5AWgCcTvLmvIHcpI_r_AoBE8Xx_mSvz_q_"
              "KJyg0nuyqHBP_xBJdhS1V1-F2kaHR/exec")
SYNC_URL = ("https://script.google.com/macros/s/AKfycbzITQche-urPlVaPyJUGNg4gJlHmK8cUnSSgJS6GKQI"
            "kZpItw6UmY-NSELSV4bjRdwO/exec")
PPT_URL = ("https://script.google.com/macros/s/AKfycbxGfR4B0Em4UcfsIU3A5rMyk2tlCmno5tBUbmnLz_0Xa"
           "kP9OoxcsBgCugvdZrRMdDT7Rg/exec")

RESULTS = []
CHECKED = []


def check(name, ok, extra=""):
    RESULTS.append((name, bool(ok), extra))
    print(("PASS  " if ok else "FAIL  ") + name + (("  · " + extra) if extra else ""), flush=True)


def post(url, payload, timeout=45):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def doc_pull():
    j = post(SYNC_URL, {"action": "pull", "slot": "portal-acct"})
    rows = j.get("rows") or []
    return json.loads(rows[0]["data"]) if rows else None


def ledger_login(i, pw):
    return post(LEDGER_URL, {"action": "login", "id": i, "pw": pw})


def portal_login(ctx, base, uid, pw, shot=None):
    page = ctx.new_page()
    page.goto(base + "/portal/", wait_until="load")
    page.wait_for_selector("html[data-ready='1']", timeout=30000)
    page.wait_for_selector("#login-form", state="visible", timeout=30000)
    page.fill("#login-id", uid)
    page.fill("#login-pw", pw)
    page.click("#login-btn")
    page.wait_for_selector("#dash:not([hidden])", timeout=60000)
    page.wait_for_timeout(700)
    if shot:
        page.screenshot(path=shot, full_page=True)
    return page


def open_card(page, ctx, label):
    n0 = len(ctx.pages)
    page.click(f'#apps .appcard:has(h3:text-is("{label}")) [data-open]')
    for _ in range(70):
        if len(ctx.pages) > n0:
            pg = ctx.pages[-1]
            try:
                pg.wait_for_load_state("domcontentloaded", timeout=20000)
            except Exception:
                pass
            return pg
        page.wait_for_timeout(300)
    raise RuntimeError("앱 탭이 열리지 않았습니다: " + label + " · toast=" + page.inner_text("#toast"))


def phase_admin_add(browser, base):
    print("\n=== ① 관리자 로그인 · 사용자 추가 ===", flush=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pa = portal_login(ctx, base, ADMIN_ID, ADMIN_PW, "shot-admin-dash.png")
    cards = pa.eval_on_selector_all("#apps .appcard h3", "els=>els.map(e=>e.textContent)")
    check("관리자 대시보드에 3개 앱 카드", sorted(cards) == sorted(U1["labels"] + ["중보기도문 변환"]), str(cards))

    pa.fill("#nu-id", U1["id"])
    pa.fill("#nu-name", U1["name"])
    pa.fill("#nu-pw", U1["pw"])
    pa.select_option("#nu-role", "user")
    for a in ["ledger", "ppt", "prayer"]:
        box = pa.locator(f'#nu-apps input[value="{a}"]')
        if box.is_checked() != (a in U1["apps"]):
            box.click()
    pa.click("#btn-add-user")
    try:
        pa.wait_for_selector(f'.urow[data-uid="{U1["id"]}"]', timeout=40000)
        check("사용자 tester 추가(금전출납부·재정보고만)", True)
    except Exception:
        check("사용자 tester 추가(금전출납부·재정보고만)", False, pa.inner_text("#toast"))

    pa.fill("#nu-id", U2["id"])
    pa.fill("#nu-name", U2["name"])
    pa.fill("#nu-pw", U2["pw"])
    for a in ["ledger", "ppt", "prayer"]:
        box = pa.locator(f'#nu-apps input[value="{a}"]')
        if box.is_checked() != (a in U2["apps"]):
            box.click()
    pid, ppw = U2["cred"]["prayer"]
    pa.evaluate("document.querySelectorAll('details.adv').forEach(d=>d.open=true)")
    pa.fill('[data-nucred="prayer"]', pid)
    pa.fill('[data-nucred="prayer-pw"]', ppw)
    pa.click("#btn-add-user")
    try:
        pa.wait_for_selector(f'.urow[data-uid="{U2["id"]}"]', timeout=40000)
        check("사용자 tester2 추가(금전출납부·중보기도문만)", True)
    except Exception:
        check("사용자 tester2 추가(금전출납부·중보기도문만)", False, pa.inner_text("#toast"))
    pa.screenshot(path="shot-users-admin.png", full_page=True)
    ctx.close(); gc.collect()


def check_doc_after_add():
    doc = doc_pull() or {}
    ids = [u["id"] for u in doc.get("users", [])]
    check("시트 계정 문서에 두 사용자 반영", "tester" in ids and "tester2" in ids, str(ids))
    u1rec = next((u for u in doc["users"] if u["id"] == "tester"), {})
    check("tester 권한 = 금전출납부·재정보고만", sorted(u1rec.get("apps") or []) == ["ledger", "ppt"], str(u1rec.get("apps")))
    check("시트에 평문 비밀번호 없음", U1["pw"] not in json.dumps(doc))
    lr = ledger_login(U1["id"], U1["pw"])
    check("금전출납부 계정도 같은 비밀번호로 자동 생성", lr.get("ok") is True, str(lr.get("error") or ""))


def phase_user1(browser, base):
    print("\n=== ② 다른 기기(새 컨텍스트)에서 tester 로그인 ===", flush=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    pb = portal_login(ctx, base, U1["id"], U1["pw"], "shot-user-dash-mobile.png")
    cards = pb.eval_on_selector_all("#apps .appcard h3", "els=>els.map(e=>e.textContent)")
    check("권한 있는 앱 2개만 표시", sorted(cards) == sorted(U1["labels"]), str(cards))
    check("중보기도문 카드 없음", "중보기도문 변환" not in cards)
    check("관리자 메뉴 숨김", pb.evaluate("document.getElementById('sec-users').hidden") is True)

    pppt = open_card(pb, ctx, "재정보고 변환")
    pppt.wait_for_timeout(5000)
    check("재정보고: 앱 화면 열림", pppt.is_visible("#app"), pppt.url)
    check("재정보고: 비밀번호 화면 없음", not pppt.is_visible("#lockScreen"))
    check("재정보고: 새 기기에서 금고 자동 생성", pppt.evaluate("!!localStorage.getItem('dfp.vault.v1')"))
    pppt.screenshot(path="shot-user-ppt.png")
    pppt.close()

    pled = open_card(pb, ctx, "금전출납부")
    pled.wait_for_timeout(6000)
    ok_led = pled.is_visible("#appRoot")
    check("금전출납부: 앱 화면 열림", ok_led, pled.url + ("" if ok_led else " · " + pled.inner_text("#loginErr")))
    check("금전출납부: 로그인 화면 아님", not pled.is_visible("#loginScreen"))
    who = (pled.inner_text("#whoName") or "").strip() if ok_led else ""
    check("금전출납부: 계정 표시", who == U1["name"], who)
    if ok_led:
        pled.screenshot(path="shot-user-ledger.png")
    pled.close()

    pblk = ctx.new_page()
    pblk.goto(base + "/prayer/", wait_until="domcontentloaded")
    pblk.wait_for_timeout(3000)
    blocked = pblk.is_visible("#dkpOverlay")
    check("미허용 중보기도문 직접 접근 차단", blocked)
    check("차단 화면에 포털 돌아가기", blocked and "교회포털로 돌아가기" in pblk.inner_text("#dkpOverlay"))
    check("차단 시 기도문 화면 안 보임", not pblk.is_visible("#app"))
    if blocked:
        pblk.screenshot(path="shot-user-blocked.png")
    ctx.close(); gc.collect()


def phase_user2(browser, base):
    print("\n=== ②-b tester2 (중보기도문 입장) ===", flush=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pc = portal_login(ctx, base, U2["id"], U2["pw"], "shot-user2-dash.png")
    cards = pc.eval_on_selector_all("#apps .appcard h3", "els=>els.map(e=>e.textContent)")
    check("tester2: 권한 앱 2개만", sorted(cards) == sorted(U2["labels"]), str(cards))

    ppray = open_card(pc, ctx, "중보기도문 변환")
    ppray.wait_for_timeout(9000)
    ok_pray = ppray.is_visible("#app")
    check("중보기도문: 비밀번호 없이 입장", ok_pray, ppray.url + ("" if ok_pray else " · " + ppray.inner_text("#lockMsg")))
    check("중보기도문: 로그인 화면 아님", not ppray.is_visible("#lock"))
    if ok_pray:
        ppray.screenshot(path="shot-user-prayer.png")
    ppray.close()

    pblk2 = ctx.new_page()
    pblk2.goto(base + "/ppt/", wait_until="domcontentloaded")
    pblk2.wait_for_timeout(3000)
    check("tester2: 미허용 재정보고 직접 접근 차단", pblk2.is_visible("#dkpOverlay"))
    ctx.close(); gc.collect()

    # 포털 세션이 없으면 앱 자체 로그인 화면 그대로
    ctx = browser.new_context()
    pd = ctx.new_page()
    pd.goto(base + "/prayer/", wait_until="domcontentloaded")
    pd.wait_for_timeout(2500)
    check("포털 세션 없으면 앱 자체 로그인 화면", pd.is_visible("#lock") and not pd.is_visible("#dkpOverlay"))
    ctx.close(); gc.collect()


def phase_cleanup(browser, base):
    print("\n=== ④ 테스트 계정 정리 ===", flush=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pa = portal_login(ctx, base, ADMIN_ID, ADMIN_PW, "shot-admin-after-cleanup.png")
    for uid in [U1["id"], U2["id"]]:
        row = pa.locator(f'.urow[data-uid="{uid}"]')
        row.locator("[data-del]").click()
        row.locator("[data-del]").click()
        try:
            pa.wait_for_selector(f'.urow[data-uid="{uid}"]', state="detached", timeout=40000)
        except Exception:
            pass
    ctx.close(); gc.collect()
    doc = doc_pull() or {}
    ids = [u["id"] for u in doc.get("users", [])]
    check("시트에서 테스트 계정 삭제됨", "tester" not in ids and "tester2" not in ids, str(ids))
    check("관리자 계정은 남음", "admin" in ids, str(ids))
    for uid in [U1["id"], U2["id"]]:
        r = ledger_login(uid, "test1234")
        check(f"금전출납부 계정 {uid} 삭제됨", r.get("ok") is False, str(r.get("error")))
    slot = hashlib.sha256(("dfp-sync-v1|" + U1["pw"]).encode()).hexdigest()[:48]
    try:
        d = post(PPT_URL, {"action": "drop", "slot": slot})
        print("  재정보고 테스트 슬롯 정리:", d.get("ok"), "removed=", d.get("removed"))
    except Exception as e:
        print("  재정보고 슬롯 정리 실패:", e)


def main():
    fixed = os.environ.get("DKP_BASE", "").rstrip("/")
    srv = None
    if fixed:
        base = fixed
    else:
        srv, base = start_server()
    print("대상:", base, flush=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                phase_admin_add(browser, base)
                check_doc_after_add()
                phase_user1(browser, base)
                phase_user2(browser, base)
                phase_cleanup(browser, base)
            finally:
                browser.close()
    finally:
        if srv:
            srv.shutdown()
    bad = [r for r in RESULTS if not r[1]]
    print("\n=== 결과: %d/%d 통과 ===" % (len(RESULTS) - len(bad), len(RESULTS)))
    if bad:
        for n, _, e in bad:
            print("  FAILED:", n, e)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
