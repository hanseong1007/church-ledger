#!/usr/bin/env python3
"""포털 관리 기능 점검(실주소): 사용자 추가 → 사용 중지/다시 켜기 → 비밀번호 재설정 →
내 비밀번호 변경 후 되돌리기 → 삭제. 계정 문서는 마지막에 관리자만 남긴다."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DKP_BASE", "https://hanseong1007.github.io/church-ledger").rstrip("/")
ADMIN = ("admin", "admin1234")
T = {"id": "opstest", "name": "점검용", "pw": "ops12345"}
T2 = {"id": "opstest2", "name": "점검관리", "pw": "ops12345"}
R = []


def check(n, ok, x=""):
    R.append((n, bool(ok), x))
    print(("PASS  " if ok else "FAIL  ") + n + (("  · " + x) if x else ""), flush=True)


def login(ctx, uid, pw, expect_ok=True):
    pg = ctx.new_page()
    pg.goto(BASE + "/portal/", wait_until="load")
    pg.wait_for_selector("#login-form", state="visible", timeout=30000)
    pg.fill("#login-id", uid)
    pg.fill("#login-pw", pw)
    pg.click("#login-btn")
    try:
        pg.wait_for_selector("#dash:not([hidden])", timeout=25000)
        ok = True
    except Exception:
        ok = False
    return pg, ok


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg, ok = login(ctx, ADMIN[0], ADMIN[1])
            check("관리자 로그인", ok)

            # 사용자 추가
            pg.fill("#nu-id", T["id"]); pg.fill("#nu-name", T["name"]); pg.fill("#nu-pw", T["pw"])
            pg.click('#nu-apps input[value="ppt"]')          # 금전출납부 해제, 재정보고 체크
            pg.click('#nu-apps input[value="ledger"]')
            pg.click("#btn-add-user")
            pg.wait_for_selector(f'.urow[data-uid="{T["id"]}"]', timeout=40000)
            check("사용자 추가(재정보고만)", True)

            pg.fill("#nu-id", T2["id"]); pg.fill("#nu-name", T2["name"]); pg.fill("#nu-pw", T2["pw"])
            pg.select_option("#nu-role", "admin")
            pg.click("#btn-add-user")
            pg.wait_for_selector(f'.urow[data-uid="{T2["id"]}"]', timeout=40000)
            check("관리자 역할 사용자 추가", True)
            ctx.close()

            # 새 사용자로 로그인 + 재정보고만 보이는지
            ctx = b.new_context()
            pg2, ok2 = login(ctx, T["id"], T["pw"])
            check("새 사용자 로그인", ok2)
            cards = pg2.eval_on_selector_all("#apps .appcard h3", "e=>e.map(x=>x.textContent)")
            check("권한 앱 1개(재정보고)", cards == ["재정보고 변환"], str(cards))
            ctx.close()

            # 사용 중지
            ctx = b.new_context()
            pa, _ = login(ctx, ADMIN[0], ADMIN[1])
            pa.locator(f'.urow[data-uid="{T["id"]}"] [data-toggle]').click()
            pa.wait_for_timeout(6000)
            check("사용 중지 표시", "사용 중지" in pa.inner_text("#users-list"))
            ctx.close()

            ctx = b.new_context()
            pg3, ok3 = login(ctx, T["id"], T["pw"])
            msg = pg3.inner_text("#login-msg") if not ok3 else ""
            check("중지된 계정 로그인 차단", (not ok3) and "중지" in msg, msg)
            ctx.close()

            # 다시 켜기 + 비밀번호 재설정
            ctx = b.new_context()
            pa, _ = login(ctx, ADMIN[0], ADMIN[1])
            pa.locator(f'.urow[data-uid="{T["id"]}"] [data-toggle]').click()
            pa.wait_for_timeout(5000)
            pa.locator(f'.urow[data-uid="{T["id"]}"] [data-reset]').click()
            pa.fill(f'[data-rpw="{T["id"]}"]', "new12345")
            pa.locator(f'.urow[data-uid="{T["id"]}"] [data-rok]').click()
            pa.wait_for_timeout(6000)
            ctx.close()

            ctx = b.new_context()
            _, old_ok = login(ctx, T["id"], T["pw"])
            check("예전 비밀번호 거부", not old_ok)
            ctx.close()
            ctx = b.new_context()
            _, new_ok = login(ctx, T["id"], "new12345")
            check("새 비밀번호로 로그인", new_ok)
            ctx.close()

            # 내 비밀번호 변경 — 임시 관리자 계정에서만(실제 관리자 비밀번호는 건드리지 않는다)
            ctx = b.new_context()
            pt, _ = login(ctx, T2["id"], T2["pw"])
            pt.click("#btn-pw-open")
            pt.fill("#pw-cur", T2["pw"]); pt.fill("#pw-new", "tmppass12"); pt.fill("#pw-new2", "tmppass12")
            pt.click("#btn-pw-save")
            pt.wait_for_timeout(7000)
            ctx.close()
            ctx = b.new_context()
            _, changed = login(ctx, T2["id"], "tmppass12")
            check("내 비밀번호 변경 반영", changed)
            ctx.close()
            ctx = b.new_context()
            _, old_pw = login(ctx, T2["id"], T2["pw"])
            check("변경 전 비밀번호 거부", not old_pw)
            ctx.close()

            # 정리: 점검용 계정 삭제
            ctx = b.new_context()
            pa, _ = login(ctx, ADMIN[0], ADMIN[1])
            gone = True
            for uid in [T["id"], T2["id"]]:
                row = pa.locator(f'.urow[data-uid="{uid}"]')
                row.locator("[data-del]").click()
                row.locator("[data-del]").click()
                try:
                    pa.wait_for_selector(f'.urow[data-uid="{uid}"]', state="detached", timeout=40000)
                except Exception:
                    gone = False
            check("점검용 계정 2개 삭제", gone)
            ctx.close()
        finally:
            b.close()
    bad = [r for r in R if not r[1]]
    print("\n=== 결과: %d/%d 통과 ===" % (len(R) - len(bad), len(R)))
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
