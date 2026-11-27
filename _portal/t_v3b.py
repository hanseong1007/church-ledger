import asyncio, os, json, threading, functools, http.server, socketserver, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8878
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Q, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    threading.Thread(target=socketserver.TCPServer(("127.0.0.1", PORT), h).serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
PW = os.environ.get("DKP_PW", "")   # 관리자 비밀번호는 환경변수로 넘긴다

SEED = r"""
async (pw) => {
  const enc = new TextEncoder();
  const b64e = (b) => { const u = new Uint8Array(b); let s=''; for (let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:210000, hash:'SHA-256'}, km, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  const encObj = async (o) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(o))); return {iv:b64e(iv), ct:b64e(ct)}; };
  const data = { history: [{id:'h1', fileName:'2026 3분기 재정보고.hwpx', at: Date.now()-86400000}, {id:'h2', fileName:'2026 2분기 재정보고.hwpx', at: Date.now()-172800000}], createdAt: Date.now()-999 };
  const v = { v:1, salt: b64e(salt), iters:210000 };
  v.check = await encObj({ok:'deoksin-finance-report-v1'});
  v.data = await encObj(data);
  localStorage.setItem('dfp.vault.v1', JSON.stringify(v));
  return 'seeded';
}
"""

AUTH = r"""
async (pw) => {
  const enc = new TextEncoder();
  const b64d = (s)=>{const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;};
  const raw = JSON.parse(localStorage.getItem('dfp.vault.v1')); if (!raw) return 'no vault';
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:b64d(raw.salt), iterations:raw.iters||210000, hash:'SHA-256'}, km, {name:'AES-GCM', length:256}, false, ['decrypt']);
  try {
    const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64d(raw.check.iv)}, key, b64d(raw.check.ct));
    const d = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64d(raw.data.iv)}, key, b64d(raw.data.ct));
    return {check: JSON.parse(new TextDecoder().decode(pt)), data: JSON.parse(new TextDecoder().decode(d))};
  } catch (e) { return 'FAIL'; }
}
"""

async def main():
    serve()
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))

        # --- PPT 기존 금고(admin1234) 마이그레이션 ---
        await pg.goto(BASE + "/ppt/", wait_until="load")
        print("seed:", await pg.evaluate(SEED, "admin1234"))
        await pg.goto(BASE + "/portal/", wait_until="load")
        await pg.wait_for_timeout(800)
        await pg.fill("#login-id", "phs7604"); await pg.fill("#login-pw", PW)
        await pg.click("#login-btn"); await pg.wait_for_timeout(5000)
        s = await ctx.new_page()
        s.on("pageerror", lambda e: errs.append("ppt:"+str(e)))
        await s.goto(BASE + "/ppt/", wait_until="load")
        await s.wait_for_timeout(8000)
        print("ppt open:", await s.is_visible("#app"), "lock:", await s.is_visible("#lockScreen"))
        print("old pw open now:", json.dumps(await s.evaluate(AUTH, "admin1234"), ensure_ascii=False)[:80])
        r = await s.evaluate(AUTH, PW)
        print("new pw open now:", json.dumps(r, ensure_ascii=False)[:200])
        await s.screenshot(path=str(ROOT/"build/ppt-migrated.png"))

        # --- 권한 없는 앱 막기 ---
        c2 = await b.new_context(viewport={"width":390,"height":844})
        t = await c2.new_page()
        await t.goto(BASE + "/ppt/", wait_until="load")
        await t.evaluate("""() => localStorage.setItem('dkp.sso.v1', JSON.stringify({v:1,userId:'phs7604',name:'관리자',role:'user',apps:['ledger'],keep:false,at:Date.now(),exp:Date.now()+86400000}))""")
        await t.goto(BASE + "/ppt/", wait_until="load")
        await t.wait_for_timeout(2500)
        print("blocked overlay:", await t.is_visible("#dkpOverlay"), (await t.inner_text("#dkpOverlay"))[:50] if await t.is_visible("#dkpOverlay") else "")
        await t.screenshot(path=str(ROOT/"build/blocked.png"))
        print("errors:", errs)
        await b.close()

asyncio.run(main())
