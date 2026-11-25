#!/usr/bin/env python3
"""교회 통합 포털 연동 코드를 세 앱(금전출납부·재정보고 변환·중보기도문 변환)에 넣는다.

앱마다 하는 일은 같다.
  1) 위쪽에 `⛪ 교회포털` 돌아가기 버튼을 붙인다.
  2) 포털 통합 로그인 표(dkp.sso.v1)가 있으면
       - 이 앱이 권한 목록에 없을 때 → '권한 없음' 화면으로 막는다.
       - 권한이 있을 때 → 포털이 이 기기에 남긴 봉인을 풀어 앱 비밀번호를 얻고,
         앱 자신의 로그인 함수(__dkpEnter)를 대신 불러 비밀번호 화면 없이 연다.
  3) 포털 세션이 없으면 아무 것도 하지 않는다(앱 자체 로그인 그대로).

사용: python3 _portal/inject_portal.py <저장소 루트>
"""
import re
import sys
from pathlib import Path

BRIDGE = r"""
<!-- DKP-BRIDGE-START ══════════ 교회 통합 포털 연동 (자동 생성: _portal/inject_portal.py) ══════════ -->
<style>
  #dkpHome{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 10px;border-radius:9px;
    border:1px solid rgba(128,128,128,.45);background:rgba(128,128,128,.14);color:inherit;font-size:12px;
    font-weight:800;text-decoration:none;white-space:nowrap;opacity:.92}
  #dkpHome:hover{opacity:1}
  #dkpHome .ic{font-size:13px;line-height:1}
  @media (max-width:560px){
    #dkpHome{padding:0;width:34px;justify-content:center;gap:0}
    #dkpHome .lbl{display:none}
  }
  .dkp-link-foot{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:12.5px;font-weight:700;
    color:#7a6a45;text-decoration:none}
  .dkp-ov{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;padding:24px;
    background:rgba(16,27,49,.97);color:#f7f4ea}
  .dkp-ov .dkp-box{max-width:400px;width:100%;background:#fffdf6;color:#1b2434;border-radius:18px;padding:26px;
    text-align:center;box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}
  .dkp-ov .dkp-ico{font-size:30px;line-height:1;margin-bottom:8px}
  .dkp-ov h3{margin:0 0 8px;font-size:17px;letter-spacing:-.01em}
  .dkp-ov p{margin:0 0 18px;font-size:13px;line-height:1.65;color:#535b6c}
  .dkp-ov .dkp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:46px;
    border-radius:12px;background:#101b31;color:#f7f4ea;font-size:14px;font-weight:800;text-decoration:none}
  .dkp-ov .dkp-spin{width:22px;height:22px;border-radius:50%;border:3px solid #e3dccb;border-top-color:#a8863f;
    margin:0 auto 12px;animation:dkpspin .9s linear infinite}
  @keyframes dkpspin{to{transform:rotate(360deg)}}
</style>
<script>
(function () {
  'use strict';
  var APP = '__APP__';                 /* ledger | ppt | prayer */
  var PORTAL = '__PORTAL__';           /* 포털 주소(상대) */
  var K_SSO = 'dkp.sso.v1', K_SEAL = 'dkp.seal.v1';

  function jget(k, d) {
    try { var r = localStorage.getItem(k); return r === null ? d : JSON.parse(r); } catch (e) { return d; }
  }
  function sso() {
    var s = jget(K_SSO, null);
    if (!s || !s.userId) return null;
    if (s.exp && s.exp < Date.now()) return null;
    return s;
  }
  function allowed(s) {
    if (!s || !Array.isArray(s.apps)) return false;
    return s.apps.indexOf(APP) >= 0;
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function overlay(inner) {
    var old = document.getElementById('dkpOverlay');
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.id = 'dkpOverlay';
    d.className = 'dkp-ov';
    d.innerHTML = '<div class="dkp-box">' + inner + '</div>';
    document.body.appendChild(d);
    return d;
  }
  function closeOverlay() {
    var d = document.getElementById('dkpOverlay');
    if (d) d.parentNode.removeChild(d);
  }
  function blockDkp(s) {
    overlay('<div class="dkp-ico">⛪</div><h3>이 도구를 쓸 권한이 없습니다</h3>' +
      '<p>' + (s && s.name ? esc(s.name) + '님은' : '지금 로그인한 계정은') +
      ' 이 도구를 쓰도록 지정되어 있지 않습니다.<br>필요하면 교회 관리자에게 요청하세요.</p>' +
      '<a class="dkp-btn" href="' + PORTAL + '">⛪ 교회포털로 돌아가기</a>');
  }

  /* ── 이 기기 전용 열쇠로 봉인을 푼다 (포털이 로그인 때 만들어 둔 것) ── */
  function b64dec(str) {
    var s = atob(String(str || '')), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function dbOpen() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('dkp-dev', 1);
      rq.onupgradeneeded = function () {
        if (!rq.result.objectStoreNames.contains('k')) rq.result.createObjectStore('k');
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function devKey() {
    return dbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('k', 'readonly');
        var rq = tx.objectStore('k').get('dev');
        rq.onsuccess = function () { res((rq.result && rq.result.key) || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function sealPayload() {
    var s = jget(K_SEAL, null);
    if (!s || !s.iv || !s.ct) return Promise.resolve(null);
    if (s.exp && s.exp < Date.now()) return Promise.resolve(null);
    return devKey().then(function (key) {
      if (!key) return null;
      return crypto.subtle.decrypt({ name:'AES-GCM', iv:b64dec(s.iv) }, key, b64dec(s.ct))
        .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); })
        .catch(function () { return null; });
    });
  }

  /* ── 위쪽 '⛪ 교회포털' 버튼 ── */
  function addHeaderLink() {
    if (document.getElementById('dkpHome')) return;
    var hosts = ['.topbar-in .top-actions', '.topbar-actions', '.top-right', '.topbar-in'];
    var host = null;
    for (var i = 0; i < hosts.length; i++) {
      var el = document.querySelector(hosts[i]);
      if (el) { host = el; break; }
    }
    var a = document.createElement('a');
    a.id = 'dkpHome';
    a.href = PORTAL;
    a.title = '교회 통합 포털로 돌아가기';
    a.innerHTML = '<span class="ic">⛪</span><span class="lbl">교회포털</span>';
    if (host) host.insertBefore(a, host.firstChild);
  }
  function addLockLink() {
    var cards = document.querySelectorAll('.lock-card, .login-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('.dkp-link-foot')) continue;
      var a = document.createElement('a');
      a.className = 'dkp-link-foot';
      a.href = PORTAL;
      a.innerHTML = '⛪ 교회포털로 돌아가기';
      cards[i].appendChild(a);
    }
  }

  function waitFor(fn, ms) {
    var t0 = Date.now();
    return new Promise(function (res) {
      (function tick() {
        var v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return res(v);
        if (Date.now() - t0 > (ms || 4000)) return res(null);
        setTimeout(tick, 120);
      })();
    });
  }

  function boot() {
    addHeaderLink();
    addLockLink();
    var s = sso();
    if (!s) return;                                  /* 포털 세션 없음 → 앱 자체 로그인 */
    if (!allowed(s)) { blockDkp(s); return; }        /* 권한 없는 앱 → 막는다 */
    var openNow = false;
    try { openNow = !!(window.__dkpOpen && window.__dkpOpen()); } catch (e) { openNow = false; }
    if (openNow) return;                             /* 이미 열려 있음 */

    sealPayload().then(function (p) {
      var c = p && p.creds ? p.creds[APP] : null;
      if (!c || !c.pw) return;
      var box = overlay('<div class="dkp-spin"></div><h3>교회포털에서 여는 중…</h3>' +
        '<p>' + esc(s.name || '') + '님 · 비밀번호 없이 바로 들어갑니다.</p>');
      waitFor(function () { return window.__dkpEnter; }, 6000).then(function (enter) {
        if (!enter) { closeOverlay(); return; }
        Promise.resolve(enter(c)).then(function (ok) {
          if (ok) {
            closeOverlay();
            var again = false;
            try { again = !!(window.__dkpOpen && window.__dkpOpen()); } catch (e) { again = false; }
            if (!again) closeOverlayForce();
          } else {
            closeOverlay();
          }
        }, function () { closeOverlay(); });
      });
    });
  }
  function closeOverlayForce() {
    setTimeout(closeOverlay, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 30); });
  else setTimeout(boot, 30);
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) setTimeout(boot, 60); });
})();
</script>
<!-- DKP-BRIDGE-END -->
"""

PORTAL_FOR = {
    "ledger": "portal/",        # /church-ledger/  → /church-ledger/portal/
    "ppt": "../portal/",        # /church-ledger/ppt/
    "prayer": "../portal/",     # /church-ledger/prayer/
}

HOOKS = {
    "ledger": r"""
  /* DKP-HOOK-START ── 교회 통합 포털 연동 (자동 생성) ── */
  window.__dkpOpen = function(){ return !!CURRENT_USER; };
  window.__dkpEnter = function(cred){
    if (!cred || !cred.id || !cred.pw) return Promise.resolve(false);
    return syncFetch(null, { action:"login", id:cred.id, pw:cred.pw }).then(function(d){
      if (d && d.ok === true && d.user && d.token){
        storeAuth({ id:d.user.id, name:d.user.name, role:d.user.role,
          token:d.token, authKey:d.authKey, expiresAt:d.expiresAt });
        enterApp();
        return true;
      }
      return false;
    }).catch(function(){ return false; });
  };
  /* DKP-HOOK-END */
""",
    "ppt": r"""
  /* DKP-HOOK-START ── 교회 통합 포털 연동 (자동 생성) ── */
  window.__dkpOpen = function(){ return !state.locked; };
  window.__dkpEnter = async function (cred) {
    if (!cred || !cred.pw) return false;
    const pw = String(cred.pw);
    try {
      if (localStorage.getItem(VAULT_KEY)) {
        const r = await tryUnlock(pw);
        if (!r.ok) return false;
        state.key = r.key; state.vault = r.vault; state.data = r.data || { history: [] };
        if (!state.data.history) state.data.history = [];
        await enterApp(pw);
        return true;
      }
      const made = await createVault(pw);
      state.key = made.key; state.vault = made.vault; state.data = made.data;
      await enterApp(pw);
      return true;
    } catch (e) { return false; }
  };
  /* DKP-HOOK-END */
""",
    "prayer": r"""
  /* DKP-HOOK-START ── 교회 통합 포털 연동 (자동 생성) ── */
  window.__dkpOpen = function(){ return !!(state.user && state.wk); };
  window.__dkpEnter = async function (cred) {
    if (!cred || !cred.id || !cred.pw) return false;
    try {
      const idEl = $('#loginId'), pwEl = $('#loginPw');
      if (idEl) idEl.value = String(cred.id);
      if (pwEl) pwEl.value = String(cred.pw);
      await doLogin();
      return !!(state.user && state.wk);
    } catch (e) { return false; }
  };
  /* DKP-HOOK-END */
""",
}

ANCHORS = {
    # 훅을 넣을 자리(앱 소스 안, 함수 범위 안)
    "ledger": '  window.LedgerApp = {',
    "ppt": "  window.__dkpOpen =",   # 아래에서 다시 계산
    "prayer": "  window.__dkpOpen =",
}


START = "<!-- DKP-BRIDGE-START"
END = "<!-- DKP-BRIDGE-END -->"


def inject_bridge(html: str, app: str) -> str:
    block = BRIDGE.replace("__APP__", app).replace("__PORTAL__", PORTAL_FOR[app])
    i, j = html.find(START), html.find(END)
    if i >= 0 and j > i:
        return html[:i] + block.strip() + html[j + len(END):]
    idx = html.rfind("</body>")
    if idx < 0:
        raise SystemExit("</body> 없음: " + app)
    return html[:idx] + block + html[idx:]


HS, HE = "/* DKP-HOOK-START", "/* DKP-HOOK-END */"


def inject_hook(html: str, app: str) -> str:
    hook = HOOKS[app].strip()
    i, j = html.find(HS), html.find(HE)
    if i >= 0 and j > i:
        return html[:i] + hook + html[j + len(HE):]
    if app == "ledger":
        anchor = "  window.LedgerApp = {"
        if anchor not in html:
            raise SystemExit("ledger anchor 없음")
        return html.replace(anchor, hook + anchor, 1)
    if app == "ppt":
        anchor = "  function lockApp() {"
        if anchor not in html:
            raise SystemExit("ppt anchor 없음")
        return html.replace(anchor, hook + anchor, 1)
    if app == "prayer":
        anchor = "function enterApp() {"
        if anchor not in html:
            raise SystemExit("prayer anchor 없음")
        return html.replace(anchor, hook + anchor, 1)
    raise SystemExit("unknown app " + app)


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    targets = [
        (root / "index.html", "ledger"),
        (root / "ppt" / "index.html", "ppt"),
        (root / "prayer" / "index.html", "prayer"),
    ]
    for path, app in targets:
        html = path.read_text(encoding="utf-8")
        before = html
        html = inject_hook(html, app)
        html = inject_bridge(html, app)
        if html != before:
            path.write_text(html, encoding="utf-8")
            print("patched", path)
        else:
            print("unchanged", path)


if __name__ == "__main__":
    main()
