#!/usr/bin/env python3
"""교회 통합 포털 연동 코드를 세 앱(금전출납부·재정보고 변환·중보기도문 변환)에 넣는다.

2026-11-28 v3 — '앱별 아이디·비밀번호'를 없애고 통합 로그인 하나로만 연다.

앱마다 하는 일은 같다.
  1) 위쪽에 `⛪ 교회포털` 돌아가기 버튼을 붙인다.
  2) 포털 통합 로그인 표(dkp.sso.v1)가 있고 이 앱 권한이 있으면,
     포털이 이 기기에 남긴 '통합 비밀번호 봉인'(dkp.pass.v1)을 풀어
     앱 자신의 입장 함수(__dkpEnter)를 비밀번호 화면 없이 부른다.
  3) 포털 세션·봉인이 없거나 입장에 실패하면 앱 자체 로그인 화면을 띄우지 않고
     통합포털(portal/?from=<앱>)로 보낸다. 두 번 넘게 되돌아오면(무한 되돌이 방지)
     자동 이동을 멈추고 '포털 열기' 단추만 보여 준다.

사용: python3 _portal/inject_portal.py <저장소 루트>
"""
import re
import sys
from pathlib import Path

BRIDGE = r"""
<!-- DKP-BRIDGE-START ══════════ 교회 통합 포털 연동 v3 (자동 생성: _portal/inject_portal.py) ══════════ -->
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
  /* 앱 자체 로그인 화면은 통합 로그인으로 대신하므로 보이지 않게 둔다 */
  html[data-dkp="gate"] #loginScreen,
  html[data-dkp="gate"] #pwChangeScreen,
  html[data-dkp="gate"] #lockScreen,
  html[data-dkp="gate"] #lock,
  html[data-dkp="gate"] .lock-card{visibility:hidden !important}
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
  var K_SSO = 'dkp.sso.v1', K_PASS = 'dkp.pass.v1';
  var K_NAV = 'dkp.nav.n';

  function jget(k, d) {
    try { var r = localStorage.getItem(k); return r === null ? d : JSON.parse(r); } catch (e) { return d; }
  }
  function sget(k, d) { try { var r = sessionStorage.getItem(k); return r === null ? d : r; } catch (e) { return d; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
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
  function gateMode(on) {
    try {
      if (on) document.documentElement.setAttribute('data-dkp', 'gate');
      else document.documentElement.removeAttribute('data-dkp');
    } catch (e) {}
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
    gateMode(true);
    overlay('<div class="dkp-ico">⛪</div><h3>이 도구를 쓸 권한이 없습니다</h3>' +
      '<p>' + (s && s.name ? esc(s.name) + '님은' : '지금 로그인한 계정은') +
      ' 이 도구를 쓰도록 지정되어 있지 않습니다.<br>필요하면 교회 관리자에게 요청하세요.</p>' +
      '<a class="dkp-btn" href="' + PORTAL + '">⛪ 교회포털로 돌아가기</a>');
  }

  /* 통합포털로 보낸다. 포털에서 로그인하면 ?from= 덕분에 이 앱으로 바로 돌아온다. */
  function goPortal(why) {
    gateMode(true);
    var from = '';
    try { from = new URLSearchParams(location.search).get('from') || ''; } catch (e) {}
    var n = Number(sget(K_NAV, '0')) || 0;
    overlay('<div class="dkp-ico">⛪</div><h3>통합 포털에서 로그인합니다</h3>' +
      '<p>교회 도구는 <b>통합 아이디·비밀번호 하나</b>로 열립니다.<br>' +
      (from === 'portal' || n >= 2 ? '아래 단추를 눌러 포털에서 로그인해 주세요.' : '포털로 이동합니다…') + '</p>' +
      '<a class="dkp-btn" href="' + PORTAL + '?from=' + APP + '">⛪ 통합 포털 열기</a>');
    if (from === 'portal' || n >= 2) return;      /* 무한 되돌이 방지 */
    sset(K_NAV, String(n + 1));
    setTimeout(function () { location.replace(PORTAL + '?from=' + APP); }, 600);
  }
  function needPw() {
    gateMode(true);
    overlay('<div class="dkp-ico">🔑</div><h3>포털에서 비밀번호를 바꿔 주세요</h3>' +
      '<p>처음 받은 기본 비밀번호입니다.<br>통합포털의 <b>내 계정 → 통합 비밀번호 변경</b>에서 바꾸면 모든 도구가 함께 바뀝니다.</p>' +
      '<a class="dkp-btn" href="' + PORTAL + '">⛪ 통합 포털 열기</a>');
  }

  /* 이 기기 전용 열쇠로 '통합 비밀번호 봉인'을 푼다 (포털이 로그인 때 만들어 둔 것) */
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
  function passPayload() {
    var s = jget(K_PASS, null);
    if (!s || !s.iv || !s.ct) return Promise.resolve(null);
    if (s.exp && s.exp < Date.now()) return Promise.resolve(null);
    return devKey().then(function (key) {
      if (!key) return null;
      return crypto.subtle.decrypt({ name:'AES-GCM', iv:b64dec(s.iv) }, key, b64dec(s.ct))
        .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); })
        .catch(function () { return null; });
    });
  }

  /* 위쪽 '⛪ 교회포털' 버튼 */
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
  function isOpen() {
    try { return !!(window.__dkpOpen && window.__dkpOpen()); } catch (e) { return false; }
  }

  function boot() {
    addHeaderLink();
    addLockLink();
    if (isOpen()) { gateMode(false); return; }          /* 이미 열려 있음 */
    gateMode(true);                                     /* 앱 자체 로그인 화면은 숨긴다 */
    var s = sso();
    if (s && !allowed(s)) { blockDkp(s); return; }      /* 권한 없는 앱 */
    if (!s) { goPortal('no-sso'); return; }             /* 포털에 로그인한 적이 없다 */
    passPayload().then(function (p) {
      if (!p || !p.pw) { goPortal('no-pass'); return; }
      overlay('<div class="dkp-spin"></div><h3>교회포털에서 여는 중…</h3>' +
        '<p>' + esc(p.name || s.name || '') + '님 · 비밀번호 화면 없이 바로 들어갑니다.</p>');
      waitFor(function () { return window.__dkpEnter; }, 8000).then(function (enter) {
        if (!enter) { goPortal('no-enter'); return; }
        Promise.resolve(enter({ id: p.userId, pw: p.pw, pwPrev: p.pwPrev || '' })).then(function (ok) {
          if (isOpen()) { closeOverlay(); gateMode(false); return; }
          goPortal(ok ? 'not-open' : 'enter-failed');
        }, function () { goPortal('enter-error'); });
      });
    });
  }

  window.__dkpGate = goPortal;
  window.__dkpNeedPw = needPw;

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
  /* DKP-HOOK-START ── 교회 통합 포털 연동 v3 (자동 생성) ── */
  window.__dkpOpen = function(){ return !!CURRENT_USER; };
  window.__dkpEnter = function(cred){
    if (!cred || !cred.id || !cred.pw) return Promise.resolve(false);
    return syncFetch(null, { action:"login", id:cred.id, pw:cred.pw }).then(function(d){
      if (d && d.ok === true && d.user && d.token){
        storeAuth({ id:d.user.id, name:d.user.name, role:d.user.role,
          token:d.token, authKey:d.authKey, expiresAt:d.expiresAt });
        if (d.mustChange){ if (window.__dkpNeedPw) window.__dkpNeedPw(); return false; }
        enterApp();
        return true;
      }
      return false;
    }).catch(function(){ return false; });
  };
  /* DKP-HOOK-END */
""",
    "ppt": r"""
  /* DKP-HOOK-START ── 교회 통합 포털 연동 v3 (자동 생성) ── */
  window.__dkpOpen = function(){ return !state.locked; };
  /* 포털이 넘겨준 통합 비밀번호로 금고를 연다.
     예전에 이 기기에서 쓰던 비밀번호(admin1234 등)면 한 번만 조용히 열고,
     바로 통합 비밀번호로 다시 잠가 둔다 — 앱마다 따로 비밀번호를 두지 않는다. */
  window.__dkpEnter = async function (cred) {
    if (!cred) return false;
    const tries = [];
    const add = (p) => { p = String(p || '').trim(); if (p && tries.indexOf(p) < 0) tries.push(p); };
    add(cred.pw); add(cred.pwPrev); add('admin1234'); add('deoksin2026');
    if (!tries.length) return false;
    for (let i = 0; i < tries.length; i++) {
      const pw = tries[i];
      try {
        if (!localStorage.getItem(VAULT_KEY)) {
          const made = await createVault(String(cred.pw || pw));
          state.key = made.key; state.vault = made.vault; state.data = made.data;
          await enterApp(String(cred.pw || pw));
          return true;
        }
        const r = await tryUnlock(pw);
        if (!r.ok || !r.key) continue;
        state.key = r.key; state.vault = r.vault; state.data = r.data || { history: [] };
        if (!state.data.history) state.data.history = [];
        await enterApp(pw);
        if (String(cred.pw || '') && pw !== String(cred.pw)) {
          try { await dkpRekey(String(cred.pw)); } catch (e) { }
        }
        return true;
      } catch (e) { }
    }
    return false;
  };
  async function dkpRekey(newPw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(newPw, salt, ITERS);
    const nv = { v: 1, salt: b64.fromBytes(salt), iters: ITERS };
    nv.check = await aesEnc(key, { ok: CHECK });
    nv.data = await aesEnc(key, state.data);
    localStorage.setItem(VAULT_KEY, JSON.stringify(nv));
    state.key = key; state.vault = nv; state.pw = newPw;
    if (SYNC_ON) {
      try { syncSlotId = await syncSlotFor(newPw); } catch (e) { syncSlotId = null; }
      state.syncSalt = null;
      try { syncKeys.clear(); } catch (e) { }
      try { scheduleSyncPush(400); } catch (e) { }
    }
    toast('통합 비밀번호로 금고를 다시 잠갔습니다');
  }
  /* 잠금(자동·수동) 뒤에는 앱 자체 비밀번호 화면 대신 통합포털로 보낸다. */
  var __dkpLock0 = lockApp;
  lockApp = function () {
    try { __dkpLock0(); } catch (e) { }
    try { setTimeout(function () { location.replace('__PORTAL__'); }, 30); } catch (e) { }
  };
  /* DKP-HOOK-END */
""",
    "prayer": r"""
  /* DKP-HOOK-START ── 교회 통합 포털 연동 v3 (자동 생성) ── */
  window.__dkpOpen = function(){ return !!(state.user && state.wk); };
  window.__dkpEnter = async function (cred) {
    if (!cred || !cred.id || !cred.pw) return false;
    const tries = [];
    const add = (p) => { p = String(p || ''); if (p && tries.indexOf(p) < 0) tries.push(p); };
    add(cred.pw); add(cred.pwPrev);
    for (let i = 0; i < tries.length; i++) {
      const idEl = $('#loginId'), pwEl = $('#loginPw');
      if (idEl) idEl.value = String(cred.id);
      if (pwEl) pwEl.value = tries[i];
      try { await doLogin(); } catch (e) { }
      if (state.user && state.wk) return true;
    }
    return false;
  };
  /* 잠금(자동·수동)·세션 만료 뒤에는 앱 자체 비밀번호 화면 대신 통합포털로 보낸다. */
  var __dkpLock0 = doLock;
  doLock = function () {
    try { __dkpLock0(); } catch (e) { }
    try { setTimeout(function () { location.replace('__PORTAL__'); }, 30); } catch (e) { }
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
    hook = HOOKS[app].strip().replace("__PORTAL__", PORTAL_FOR[app])
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
