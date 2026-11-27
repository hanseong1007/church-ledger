import asyncio, os, threading, functools, http.server, socketserver, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8879
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Q, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    threading.Thread(target=socketserver.TCPServer(("127.0.0.1", PORT), h).serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
PW = os.environ.get("DKP_PW", "")   # 관리자 비밀번호는 환경변수로 넘긴다

async def login(pg, uid, pw):
    await pg.goto(BASE + "/portal/")
    await pg.wait_for_timeout(1200)
    await pg.fill("#login-id", uid); await pg.fill("#login-pw", pw)
    await pg.click("#login-btn")
    try:
        await pg.wait_for_selector("#dash:not([hidden])", timeout=25000)
        return True, ""
    except Exception:
        msg = await pg.inner_text("#login-msg")
        return False, msg

async def main():
    serve()
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1200, "height": 900})
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        ok, msg = await login(pg, "phs7604", PW)
        print("admin login:", ok, msg)

        # 1) 시험 사용자 추가 (금전출납부 권한)
        await pg.fill("#nu-id", "dkptest"); await pg.fill("#nu-name", "시험계정")
        await pg.fill("#nu-pw", "Test1234!")
        # 금전출납부만 체크
        for a in ("ppt", "prayer"):
            pass
        boxes = await pg.query_selector_all("#nu-apps input")
        for bx in boxes:
            on = await bx.is_checked()
            if not on:
                pass
        await pg.click("#btn-add-user")
        await pg.wait_for_timeout(9000)
        print("add toast:", await pg.inner_text("#toast"))
        print("users:", await pg.inner_text("#users-count"))

        # 2) 시험 계정으로 로그인 → 비밀번호 변경
        await pg.click("#btn-logout"); await pg.wait_for_timeout(1500)
        ok, msg = await login(pg, "dkptest", "Test1234!")
        print("test login:", ok, msg)
        await pg.click("#btn-pw-open"); await pg.wait_for_timeout(400)
        await pg.fill("#pw-cur", "Test1234!"); await pg.fill("#pw-new", "Test5678!"); await pg.fill("#pw-new2", "Test5678!")
        await pg.click("#btn-pw-save")
        await pg.wait_for_timeout(9000)
        print("pw change toast:", await pg.inner_text("#toast"))
        print("pw msg:", await pg.inner_text("#pw-msg"))

        # 3) 새 비밀번호로 로그인
        await pg.click("#btn-logout"); await pg.wait_for_timeout(1500)
        ok, msg = await login(pg, "dkptest", "Test5678!")
        print("relogin with new pw:", ok, msg)

        # 4) 관리자로 돌아와 시험 계정 삭제
        await pg.click("#btn-logout"); await pg.wait_for_timeout(1500)
        ok, msg = await login(pg, "phs7604", PW)
        print("admin relogin:", ok, msg)
        row = pg.locator('[data-uid="dkptest"]')
        print("test row:", await row.count())
        if await row.count():
            await row.locator('[data-del]').click()
            await pg.wait_for_timeout(700)
            await row.locator('[data-del]').click()
            await pg.wait_for_timeout(6000)
            print("delete toast:", await pg.inner_text("#toast"))
        print("users after:", await pg.inner_text("#users-count"))
        print("errors:", errs)
        await b.close()

asyncio.run(main())
