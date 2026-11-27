import asyncio, os, threading, functools, http.server, socketserver, pathlib, json, urllib.request
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8882
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Q, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    threading.Thread(target=socketserver.TCPServer(("127.0.0.1", PORT), h).serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
PW = os.environ.get("DKP_PW", "")   # 관리자 비밀번호는 환경변수로 넘긴다
U='https://script.google.com/macros/s/AKfycbwyS5AWgCcTvLmvIHcpI_r_AoBE8Xx_mSvz_q_KJyg0nuyqHBP_xBJdhS1V1-F2kaHR/exec'
class NR(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
def api(payload):
    req=urllib.request.Request(U,data=json.dumps(payload).encode(),headers={'Content-Type':'text/plain;charset=utf-8'})
    try: r=urllib.request.build_opener(NR).open(req)
    except urllib.error.HTTPError as e:
        loc=e.headers.get('Location')
        if not loc: raise
        r=urllib.request.urlopen(loc)
    return json.loads(r.read().decode())

async def login(pg, uid, pw):
    await pg.goto(BASE + "/portal/")
    await pg.wait_for_timeout(1500)
    await pg.fill("#login-id", uid); await pg.fill("#login-pw", pw)
    await pg.click("#login-btn")
    try:
        await pg.wait_for_selector("#dash:not([hidden])", timeout=25000)
        return True, ""
    except Exception:
        return False, await pg.inner_text("#login-msg")

async def main():
    serve()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(viewport={"width":1200,"height":950})).new_page()
        print('test user login:', await login(pg,'dkptest','Test1234!'))
        print('who:', await pg.inner_text('#who-name'))
        await pg.click('#btn-pw-open'); await pg.wait_for_timeout(300)
        await pg.fill('#pw-cur','Test1234!'); await pg.fill('#pw-new','Test5678!'); await pg.fill('#pw-new2','Test5678!')
        await pg.click('#btn-pw-save')
        await pg.wait_for_timeout(12000)
        print('toast:', await pg.inner_text('#toast'))
        print('msg:', await pg.inner_text('#pw-msg'))
        print('relogin new pw:', await login(pg,'dkptest','Test5678!'))
        print('ledger login api:', {k:v for k,v in api({'action':'login','id':'dkptest','pw':'Test5678!'}).items() if k in ('ok','error','message','mustChange')})
        # 정리
        await pg.click('#btn-logout'); await pg.wait_for_timeout(1200)
        print('admin back:', await login(pg,'phs7604',PW))
        row = pg.locator('[data-uid="dkptest"] [data-del]')
        await row.click(); await pg.wait_for_timeout(600); await row.click()
        await pg.wait_for_timeout(8000)
        print('users now:', await pg.inner_text('#users-count'))
        print('doc users:', await pg.evaluate("(()=>{const s=window.__dkp.state();return s.users.map(u=>u.id)})()"))
        print('errors: none?')
        await b.close()
    print('ledger users:', [u['id'] for u in api({'action':'users_list','token':api({'action':'login','id':'phs7604','pw':PW})['token']}).get('users',[])])

asyncio.run(main())
