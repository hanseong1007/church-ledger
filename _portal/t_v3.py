import asyncio, os, json, os, sys, threading, functools, http.server, socketserver, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8877

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Q, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

BASE = f"http://127.0.0.1:{PORT}"
PW = os.environ.get("DKP_PW", "")   # 관리자 비밀번호는 환경변수로 넘긴다

async def main():
    serve()
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        pg = await ctx.new_page()
        pg.on("console", lambda m: errs.append(("console", m.type, m.text)) if m.type in ("error",) else None)
        pg.on("pageerror", lambda e: errs.append(("pageerror", str(e))))

        # 1) 포털 열기
        await pg.goto(BASE + "/portal/", wait_until="load")
        await pg.wait_for_timeout(1500)
        print("portal url:", pg.url)
        print("body has 앱 비밀번호:", "앱 비밀번호" in await pg.inner_text("body"))
        print("login form visible:", await pg.is_visible("#login-form"))
        await pg.fill("#login-id", "phs7604")
        await pg.fill("#login-pw", PW)
        await pg.click("#login-btn")
        await pg.wait_for_timeout(6000)
        print("after login url:", pg.url)
        print("dash visible:", await pg.is_visible("#dash"))
        body = await pg.inner_text("body")
        print("dash has 앱 비밀번호:", "앱 비밀번호" in body)
        print("dash user:", await pg.inner_text("#who-name"))
        print("pass exists:", await pg.evaluate("!!localStorage.getItem('dkp.pass.v1')"))
        print("seal old exists:", await pg.evaluate("!!localStorage.getItem('dkp.seal.v1')"))
        print("sso:", await pg.evaluate("localStorage.getItem('dkp.sso.v1')"))
        await pg.screenshot(path=str(ROOT / "build/portal-dash.png"))

        # 2) 금전출납부
        q = await ctx.new_page()
        q.on("pageerror", lambda e: errs.append(("pageerror-ledger", str(e))))
        q.on("console", lambda m: errs.append(("console-ledger", m.type, m.text)) if m.type == "error" else None)
        await q.goto(BASE + "/", wait_until="load")
        await q.wait_for_timeout(6000)
        print("\nledger appRoot visible:", await q.is_visible("#appRoot"), "login visible:", await q.is_visible("#loginScreen"))
        txt = await q.inner_text("#appRoot") if await q.is_visible("#appRoot") else ""
        print("ledger has 20,000:", "20,000" in txt, "| 10,000:", "10,000" in txt)
        print("ledger who:", await q.inner_text("#whoName") if await q.is_visible("#whoName") else "-")
        await q.screenshot(path=str(ROOT / "build/ledger.png"))

        # 3) 중보기도문
        r = await ctx.new_page()
        r.on("pageerror", lambda e: errs.append(("pageerror-prayer", str(e))))
        await r.goto(BASE + "/prayer/", wait_until="load")
        await r.wait_for_timeout(9000)
        print("\nprayer app visible:", await r.is_visible("#app"), "lock visible:", await r.is_visible("#lock"))
        print("prayer pages:", await r.evaluate("(function(){try{return document.querySelectorAll('#stage .slide, .slide').length}catch(e){return -1}})()"))
        ptxt = await r.inner_text("#app") if await r.is_visible("#app") else ""
        print("prayer has 2026년 11월:", "2026년 11월" in ptxt)
        await r.screenshot(path=str(ROOT / "build/prayer.png"))

        # 4) 재정보고
        s = await ctx.new_page()
        s.on("pageerror", lambda e: errs.append(("pageerror-ppt", str(e))))
        await s.goto(BASE + "/ppt/", wait_until="load")
        await s.wait_for_timeout(9000)
        print("\nppt app visible:", await s.is_visible("#app"), "lock visible:", await s.is_visible("#lockScreen"))
        await s.screenshot(path=str(ROOT / "build/ppt.png"))

        # 5) 새 브라우저(포털 세션 없는 기기)에서 앱 주소로 바로
        ctx2 = await b.new_context(viewport={"width": 390, "height": 844})
        t = await ctx2.new_page()
        await t.goto(BASE + "/", wait_until="load")
        await t.wait_for_timeout(2500)
        print("\ndirect ledger url after 2.5s:", t.url)
        print("overlay text:", (await t.inner_text("#dkpOverlay"))[:60] if await t.is_visible("#dkpOverlay") else "(none)")
        await t.screenshot(path=str(ROOT / "build/gate.png"))
        # portal login then return
        await t.fill("#login-id", "phs7604")
        await t.fill("#login-pw", PW)
        await t.click("#login-btn")
        await t.wait_for_timeout(9000)
        print("after portal login url:", t.url)
        print("ledger open:", await t.is_visible("#appRoot"))
        await t.screenshot(path=str(ROOT / "build/after-return.png"))

        print("\nERRORS:")
        for e in errs[:40]:
            print(" ", e)
        await b.close()

asyncio.run(main())
