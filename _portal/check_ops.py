import os
from playwright.sync_api import sync_playwright
BASE="https://hanseong1007.github.io/church-ledger"
with sync_playwright() as p:
    b=p.chromium.launch()
    try:
        ctx=b.new_context(viewport={"width":1200,"height":900})
        pg=ctx.new_page()
        pg.goto(BASE+"/portal/", wait_until="load")
        pg.wait_for_selector("#login-form", state="visible", timeout=30000)
        pg.fill("#login-id","opstest"); pg.fill("#login-pw","new12345"); pg.click("#login-btn")
        pg.wait_for_timeout(9000)
        print("dash?", pg.is_visible("#dash"), "msg:", pg.inner_text("#login-msg"), "view:", pg.evaluate("document.body.getAttribute('data-view')"))
        ctx.close()
        # 정리
        ctx=b.new_context(viewport={"width":1200,"height":900})
        pg=ctx.new_page()
        pg.goto(BASE+"/portal/", wait_until="load")
        pg.wait_for_selector("#login-form", state="visible", timeout=30000)
        pg.fill("#login-id","admin"); pg.fill("#login-pw","admin1234"); pg.click("#login-btn")
        pg.wait_for_selector("#dash:not([hidden])", timeout=40000)
        for uid in ["opstest","opstest2"]:
            row=pg.locator(f'.urow[data-uid="{uid}"]')
            if row.count()==0: print("no row", uid); continue
            row.locator("[data-del]").click(); row.locator("[data-del]").click()
            pg.wait_for_timeout(5000)
        print("users now:", pg.inner_text("#users-count"), [x.inner_text()[:20].replace("\n","|") for x in pg.locator(".urow").all()])
        ctx.close()
    finally:
        b.close()
