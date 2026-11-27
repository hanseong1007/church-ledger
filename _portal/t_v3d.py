import asyncio, os, threading, functools, http.server, socketserver, pathlib, json, urllib.request, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8881
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
    tok = api({'action':'login','id':'phs7604','pw':PW})['token']
    # 정리: 이전 시험 계정
    api({'action':'user_delete','token':tok,'id':'dkptest'})
    print('cleanup ledger dkptest:', api({'action':'users_list','token':tok}).get('users'))
    errs=[]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(viewport={"width":1200,"height":950})).new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        print('login admin:', await login(pg,'phs7604',PW))
        # 문서에서도 시험 계정 제거
        st = await pg.evaluate("(()=>{const s=window.__dkp.state();return s.users.map(u=>u.id)})()")
        print('doc users before:', st)
        if 'dkptest' in st:
            row = pg.locator('[data-uid="dkptest"] [data-del]')
            await row.click(); await pg.wait_for_timeout(500); await row.click(); await pg.wait_for_timeout(5000)
            print('deleted old test user, users:', await pg.inner_text("#users-count"))
        # 새로 추가
        await pg.fill("#nu-id","dkptest"); await pg.fill("#nu-name","시험계정"); await pg.fill("#nu-pw","Test1234!")
        await pg.click("#btn-add-user")
        await pg.wait_for_timeout(12000)
        print('toast:', await pg.inner_text("#toast"))
        print('doc users after:', await pg.evaluate("(()=>{const s=window.__dkp.state();return s.users.map(u=>u.id)})()"))
        r = api({'action':'login','id':'dkptest','pw':'Test1234!'})
        print('ledger login after add:', {k:r.get(k) for k in ('ok','error','message','mustChange')})
        print('errors:', errs)
        await b.close()

asyncio.run(main())
