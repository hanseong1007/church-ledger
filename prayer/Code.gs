/* 덕신교회 중보기도문 · 전 기기 동기화 API (Google Apps Script 웹앱)

   하는 일
   - 웹앱(https://hanseong1007.github.io/church-ledger/prayer/)이 기도문·배경·글꼴 설정을
     비밀번호에서 뽑은 열쇠로 AES-GCM 암호화한 덩어리(ciphertext)만 주고받습니다.
   - 이 스크립트는 그 암호문을 구글 시트에 그대로 보관·반환만 합니다.
     시트를 열어도 기도문·이름·설정 같은 평문은 보이지 않습니다.
   - 계정(아이디)도 같은 방식입니다. 아이디로 만든 슬롯에 '암호화된 작업 열쇠'만 두고,
     비밀번호를 아는 사람만 그 열쇠를 풀 수 있습니다.

   action
     info                 연결 확인 + 시트 주소
     pull  {slot}         {rows:[{key, data, updatedAt}]}
     push  {slot, rows}   행 전체 교체(키 단위로 조각내 저장)
     list  {prefix}       [{slot, updatedAt}]  (계정 슬롯 찾기용)
     del   {slot}         슬롯 삭제

   시트는 처음 호출될 때 스크립트가 직접 만들고 ID를 스크립트 속성에 저장합니다.
*/

const PROP_ID = 'DP_SHEET_ID';
const TAB = '동기화';
const HEAD = ['slot', 'key', 'idx', 'data', 'updatedAt', 'savedAt', 'device', 'bytes'];
const MAX_CHUNK = 45000;   // 셀 한도(50,000자)보다 여유
const MAX_CHUNKS = 80;     // 슬롯 하나에 최대 80조각(≈3.6MB)
const LOCK_MS = 25000;

/* ---- 2026-11-27 보안 강화 ---- */
const SEC_TAB = '보안계정';
const SEC_HEAD = ['uid', 'salt', 'hash', 'mustChange', 'active', 'fails', 'lockUntil', 'pwSetAt', 'updatedAt'];
const SEC_LOG = '보안로그';
const SEC_LOG_MAX = 3000;
const BACKUP_TAB = '백업';
const BACKUP_DAYS = 7;
const TOKEN_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const PW_PREFIX = 'deoksin-prayer-login:';
/* 포털 계정 문서(portal-acct)는 금전출납부 서버가 발급한 토큰으로도 읽을 수 있습니다(포털 로그인용). */
const LEDGER_URL = 'https://script.google.com/macros/s/AKfycbwyS5AWgCcTvLmvIHcpI_r_AoBE8Xx_mSvz_q_KJyg0nuyqHBP_xBJdhS1V1-F2kaHR/exec';
const DEFAULT_PWS = ['deoksin2026', 'deoksin2026!', 'admin1234', '123456', '12345678', '0000'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  return handle(p.action || 'info', p);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return handle(body.action || 'info', body);
}

function handle(action, b) {
  let out = {};
  try {
    const slot = String(b.slot || '').trim();
    if (action === 'info') {
      const s = sheet_();
      out = { ok: true, app: 'deoksin-prayer-sync', v: 2, sheet: s.url, time: Date.now() };
    } else if (action === 'auth_state') {
      out = authState_(b);
    } else if (action === 'auth_login') {
      out = authLogin_(b);
    } else if (action === 'auth_adopt') {
      out = authAdopt_(b);
    } else if (action === 'has_accounts') {
      out = hasAccounts_();
    } else if (!/^[a-z0-9][a-z0-9-]{3,63}$/i.test(slot)) {
      out = { ok: false, error: 'bad_slot', message: '슬롯 이름이 올바르지 않습니다' };
    } else {
      /* 보안: 서버 비밀번호가 아직 등록되지 않은 계정 슬롯(acct-…)만 로그인 전에 읽을 수 있습니다.
         그 밖의 슬롯 읽기·쓰기·삭제는 모두 서명 토큰이 있어야 합니다. */
      const tok = secAuth_(b);
      const s0 = sheet_();
      try { secBackupIfDue_(s0.ss); } catch (eB) {}
      const legacyAcct = /^acct-/i.test(slot) && !secFind_(slot);
      const newAcctPush = action === 'push' && /^acct-/i.test(slot) && !slotExists_(slot);
      const portalDoc = action === 'pull' && slot === 'portal-acct' && !tok && ledgerVerify_(String(b.token || ''));
      if (!tok && !(action === 'pull' && legacyAcct) && !newAcctPush && !portalDoc) {
        out = { ok: false, error: 'unauthorized', needLogin: true, message: '로그인이 필요합니다' };
      } else if (tok && tok.mustChange && action !== 'auth_pw') {
        out = { ok: false, error: 'must_change_password', needPwChange: true, message: '처음 받은 비밀번호입니다. 비밀번호를 먼저 바꿔 주세요' };
      } else if (action === 'auth_pw') {
        out = authPw_(b, tok);
      } else if (action === 'pull') {
        out = pull_(slot);
      } else if (action === 'push') {
        out = push_(slot, b);
        if (out && out.ok && tok) secLog_(s0.ss, tok.uid, 'push', '저장', b.device, slot);
      } else if (action === 'del') {
        out = del_(slot);
        if (out && out.ok && tok) secLog_(s0.ss, tok.uid, 'del', '삭제', b.device, slot);
      } else if (action === 'list') {
        out = list_(String(b.prefix || ''));
      } else {
        out = { ok: false, error: 'unknown_action', message: '알 수 없는 요청: ' + action };
      }
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  out.action = action;
  out.serverTime = Date.now();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 시트 준비 ---------- */
function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP_ID);
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('덕신교회 중보기도문 동기화 (암호화)');
    props.setProperty(PROP_ID, ss.getId());
  }
  let sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
    sh.getRange('A:D').setNumberFormat('@');
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      if (s.getName() !== TAB && s.getLastRow() === 0 && sheets.length > 1) {
        try { ss.deleteSheet(s); } catch (e) { }
        break;
      }
    }
  }
  return { ss: ss, sh: sh, url: ss.getUrl() };
}

function rows_(sh) {
  const lr = sh.getLastRow();
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, HEAD.length).getValues();
}

/* ---------- action ---------- */
function pull_(slot) {
  const s = sheet_();
  const all = rows_(s.sh);
  const map = {};
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]) !== slot) continue;
    const key = String(all[i][1] || '');
    if (!map[key]) map[key] = { key: key, idx: [], updatedAt: 0 };
    map[key].idx.push({ i: Number(all[i][2]) || 0, d: String(all[i][3] || '') });
    map[key].updatedAt = Math.max(map[key].updatedAt, Number(all[i][4]) || 0);
  }
  const out = [];
  Object.keys(map).forEach(function (k) {
    const g = map[k];
    g.idx.sort(function (a, b) { return a.i - b.i; });
    out.push({ key: k, data: g.idx.map(function (x) { return x.d; }).join(''), updatedAt: g.updatedAt });
  });
  return { ok: true, rows: out, sheet: s.url };
}

function push_(slot, b) {
  const rows = b.rows || [];
  if (!rows.length) return { ok: false, error: 'empty', message: '보낼 자료가 없습니다' };
  const s = sheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'busy', message: '잠시 뒤 다시 시도해 주세요' };
  try {
    // 이 슬롯의 기존 행 삭제 (아래에서 새로 씀)
    const all = rows_(s.sh);
    const keep = [];
    for (let i = 0; i < all.length; i++) {
      if (String(all[i][0]) !== slot) keep.push(all[i]);
    }
    const now = Date.now();
    const device = String(b.device || '').slice(0, 40);
    rows.forEach(function (r) {
      const data = String(r.data || '');
      const key = String(r.key || 'main');
      const chunks = Math.max(1, Math.ceil(data.length / MAX_CHUNK));
      if (chunks > MAX_CHUNKS) throw new Error('자료가 너무 큽니다 (' + chunks + '조각)');
      for (let c = 0; c < chunks; c++) {
        keep.push([slot, key, c, data.substr(c * MAX_CHUNK, MAX_CHUNK),
          Number(r.updatedAt) || now, now, device, data.length]);
      }
    });
    s.sh.clearContents();
    s.sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    if (keep.length) {
      s.sh.getRange(2, 1, keep.length, HEAD.length).setValues(keep);
    }
    return { ok: true, saved: keep.length, sheet: s.url };
  } finally {
    lock.releaseLock();
  }
}

function list_(prefix) {
  const s = sheet_();
  const all = rows_(s.sh);
  const map = {};
  for (let i = 0; i < all.length; i++) {
    const slot = String(all[i][0] || '');
    if (prefix && slot.indexOf(prefix) !== 0) continue;
    map[slot] = Math.max(map[slot] || 0, Number(all[i][4]) || 0);
  }
  const out = Object.keys(map).map(function (k) { return { slot: k, updatedAt: map[k] }; });
  return { ok: true, slots: out, sheet: s.url };
}

function del_(slot) {
  const s = sheet_();
  const all = rows_(s.sh);
  const keep = [];
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]) !== slot) keep.push(all[i]);
  }
  s.sh.clearContents();
  s.sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  if (keep.length) s.sh.getRange(2, 1, keep.length, HEAD.length).setValues(keep);
  return { ok: true, removed: all.length - keep.length };
}

/* 테스트용: 스크립트 편집기에서 한 번 실행하면 시트를 만들고 주소를 로그에 남깁니다. */
function setup() {
  const s = sheet_();
  Logger.log('sheet: ' + s.url);
  return s.url;
}

/* ============================================================
   2026-11-27 보안 강화 — 서버 로그인 확인 · 서명 토큰 · 잠금 · 감사 · 백업
   · 계정 슬롯(acct-…) 하나가 곧 계정입니다. 비밀번호는 브라우저에서
     h = SHA-256('deoksin-prayer-login:' + 슬롯 + ':' + 비밀번호) 로 바꿔 보내고,
     서버는 salt + h 의 해시만 보관합니다(원문 비밀번호는 서버에 오지 않습니다).
   ============================================================ */
function secProps_() { return PropertiesService.getScriptProperties(); }
function secKey_() {
  const p = secProps_();
  let k = p.getProperty('SEC_TOKEN_KEY');
  if (!k) {
    const b = [];
    for (let i = 0; i < 32; i++) { b.push(Math.floor(Math.random() * 256)); }
    k = Utilities.base64Encode(b);
    p.setProperty('SEC_TOKEN_KEY', k);
  }
  return k;
}
function secMac_(payload64) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload64, secKey_(), Utilities.Charset.UTF_8));
}
function secMakeToken_(uid, hashHex) {
  const now = Date.now();
  const payload = { u: uid, pv: String(hashHex || '').slice(0, 16), iat: now, exp: now + TOKEN_HOURS * 3600 * 1000 };
  const p64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return { token: p64 + '.' + secMac_(p64), exp: payload.exp };
}
function secReadToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (secMac_(parts[0]) !== parts[1]) return null;
  let p = null;
  try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { return null; }
  if (!p || !p.u || !p.exp || Number(p.exp) < Date.now()) return null;
  return p;
}
function secHex_(str) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < d.length; i++) { const b = (d[i] + 256) % 256; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}
function secHash_(salt, h) { return secHex_(String(salt) + ':' + String(h)); }
function secSalt_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function secIsDefault_(slot, h) {
  for (let i = 0; i < DEFAULT_PWS.length; i++) {
    if (String(h) === secHex_(PW_PREFIX + String(slot) + ':' + DEFAULT_PWS[i])) return true;
  }
  return false;
}
function secSheet_() {
  const s = sheet_();
  let sh = s.ss.getSheetByName(SEC_TAB);
  if (!sh) {
    sh = s.ss.insertSheet(SEC_TAB);
    sh.getRange(1, 1, 1, SEC_HEAD.length).setValues([SEC_HEAD]);
    sh.setFrozenRows(1);
    sh.getRange('A:I').setNumberFormat('@');
  }
  return sh;
}
function secRows_() {
  const sh = secSheet_();
  const lr = sh.getLastRow();
  if (lr < 2) return [];
  const vals = sh.getRange(2, 1, lr - 1, SEC_HEAD.length).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i], uid = String(r[0] == null ? '' : r[0]).trim();
    if (!uid) continue;
    out.push({ uid: uid, salt: String(r[1] || ''), hash: String(r[2] || ''),
      mustChange: String(r[3]) === '1' || Number(r[3]) === 1,
      active: !(String(r[4]) === '0' || r[4] === false),
      fails: Number(r[5]) || 0, lockUntil: Number(r[6]) || 0, pwSetAt: Number(r[7]) || 0, row: i + 2 });
  }
  return out;
}
function secFind_(slot) {
  const list = secRows_();
  for (let i = 0; i < list.length; i++) { if (list[i].uid === String(slot)) return list[i]; }
  return null;
}
function secWrite_(o) {
  const sh = secSheet_();
  const vals = [o.uid, o.salt || '', o.hash || '', o.mustChange ? 1 : 0, o.active === false ? 0 : 1,
    Number(o.fails) || 0, Number(o.lockUntil) || 0, Number(o.pwSetAt) || 0, Date.now()];
  if (o.row) sh.getRange(o.row, 1, 1, SEC_HEAD.length).setValues([vals]);
  else sh.appendRow(vals);
  return o;
}
function slotExists_(slot) {
  const s = sheet_();
  const all = rows_(s.sh);
  for (let i = 0; i < all.length; i++) { if (String(all[i][0]) === String(slot)) return true; }
  return false;
}
function secLog_(ss, uid, action, result, device, note) {
  try {
    let sh = ss.getSheetByName(SEC_LOG);
    if (!sh) {
      sh = ss.insertSheet(SEC_LOG);
      sh.appendRow(['시각', '아이디', '작업', '결과', '기기', '비고']);
      sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#e7f4ec');
      sh.setFrozenRows(1);
    }
    sh.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      String(uid || ''), String(action || ''), String(result || ''), String(device || '').slice(0, 90), String(note || '').slice(0, 200)]);
    const extra = sh.getLastRow() - 1 - SEC_LOG_MAX;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { }
}
function secBackupIfDue_(ss) {
  const p = secProps_();
  if (Date.now() - Number(p.getProperty('LAST_BACKUP') || 0) < 24 * 3600 * 1000) return;
  let sh = ss.getSheetByName(BACKUP_TAB);
  if (!sh) {
    sh = ss.insertSheet(BACKUP_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['시각', '탭', '조각', '데이터']]);
    sh.setFrozenRows(1);
    sh.getRange('A:D').setNumberFormat('@');
  }
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const rows = [];
  const names = [TAB, SEC_TAB];
  for (let n = 0; n < names.length; n++) {
    const t = ss.getSheetByName(names[n]);
    if (!t) continue;
    const lr = t.getLastRow();
    if (lr < 1) continue;
    const json = JSON.stringify(t.getRange(1, 1, lr, Math.max(1, t.getLastColumn())).getValues());
    for (let i = 0; i < json.length; i += 45000) rows.push([stamp, names[n], Math.floor(i / 45000), json.substr(i, 45000)]);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  const total = sh.getLastRow() - 1;
  if (total > 0) {
    const all = sh.getRange(2, 1, total, 4).getValues();
    const stamps = {};
    for (let i = 0; i < all.length; i++) stamps[String(all[i][0])] = 1;
    const list = Object.keys(stamps).sort();
    if (list.length > BACKUP_DAYS) {
      const drop = {};
      for (let i = 0; i < list.length - BACKUP_DAYS; i++) drop[list[i]] = 1;
      const keep = [];
      for (let i = 0; i < all.length; i++) { if (!drop[String(all[i][0])]) keep.push(all[i]); }
      sh.getRange(2, 1, total, 4).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, 4).setValues(keep);
    }
  }
  p.setProperty('LAST_BACKUP', String(Date.now()));
}
function secAuth_(b) {
  const token = String((b && b.token) || '').trim();
  if (!token) return null;
  const p = secReadToken_(token);
  if (!p) return null;
  const sec = secFind_(p.u);
  if (!sec || !sec.hash || sec.active === false) return null;
  if (String(sec.hash).slice(0, 16) !== String(p.pv || '')) return null;
  return { uid: p.u, exp: Number(p.exp) || 0, mustChange: !!sec.mustChange };
}
function hasAccounts_() {
  const s = sheet_();
  const all = rows_(s.sh);
  let n = 0;
  for (let i = 0; i < all.length; i++) { if (/^acct-/i.test(String(all[i][0] || ''))) n++; }
  return { ok: true, count: n };
}
function authState_(b) {
  const slot = String(b.uid || '').trim();
  if (!/^acct-[a-z0-9-]{4,60}$/i.test(slot)) return { ok: false, error: 'bad_uid' };
  const sec = secFind_(slot);
  const now = Date.now();
  return { ok: true, exists: slotExists_(slot), has: !!(sec && sec.hash),
    active: !sec || sec.active !== false, mustChange: !!(sec && sec.mustChange),
    locked: !!(sec && sec.lockUntil && sec.lockUntil > now),
    lockLeftMs: sec && sec.lockUntil && sec.lockUntil > now ? sec.lockUntil - now : 0 };
}
function authLogin_(b) {
  const slot = String(b.uid || '').trim();
  const h = String(b.h || '').trim();
  const s = sheet_();
  if (!/^acct-[a-z0-9-]{4,60}$/i.test(slot) || !/^[0-9a-f]{64}$/.test(h)) return { ok: false, error: 'bad_request', message: '로그인 정보가 올바르지 않습니다' };
  let sec = secFind_(slot);
  if (!sec || !sec.hash) return { ok: false, error: 'no_password', message: '아직 서버에 비밀번호가 등록되지 않았습니다' };
  const now = Date.now();
  if (sec.lockUntil && sec.lockUntil > now) {
    const left = Math.max(1, Math.ceil((sec.lockUntil - now) / 60000));
    secLog_(s.ss, slot, 'login', '잠김', b.device, left + '분 남음');
    return { ok: false, error: 'locked', message: '비밀번호를 ' + MAX_FAILS + '번 연속 틀어 ' + LOCK_MINUTES + '분 동안 잠겼습니다. ' + left + '분 뒤에 다시 시도해 주세요.' };
  }
  if (secHash_(sec.salt, h) !== sec.hash) {
    sec.fails = (Number(sec.fails) || 0) + 1;
    let msg = '아이디 또는 비밀번호가 맞지 않습니다.', res = '실패';
    if (sec.fails >= MAX_FAILS) { sec.lockUntil = now + LOCK_MINUTES * 60000; sec.fails = 0; res = '잠금'; msg = '비밀번호를 ' + MAX_FAILS + '번 연속 틀어 ' + LOCK_MINUTES + '분 동안 잠깁니다.'; }
    secWrite_(sec);
    secLog_(s.ss, slot, 'login', res, b.device, '');
    return { ok: false, error: res === '잠금' ? 'locked' : 'bad_credentials', message: msg };
  }
  if (sec.active === false) return { ok: false, error: 'disabled', message: '사용이 중지된 계정입니다' };
  if (!sec.mustChange && secIsDefault_(slot, h)) sec.mustChange = true;
  sec.fails = 0; sec.lockUntil = 0;
  secWrite_(sec);
  const tk = secMakeToken_(slot, sec.hash);
  secLog_(s.ss, slot, 'login', '성공', b.device, sec.mustChange ? '기본 비밀번호 · 변경 필요' : '');
  return { ok: true, token: tk.token, expiresAt: tk.exp, mustChange: !!sec.mustChange };
}
function authAdopt_(b) {
  const slot = String(b.uid || '').trim();
  const h = String(b.h || '').trim();
  const s = sheet_();
  if (!/^acct-[a-z0-9-]{4,60}$/i.test(slot) || !/^[0-9a-f]{64}$/.test(h)) return { ok: false, error: 'bad_request', message: '로그인 정보가 올바르지 않습니다' };
  if (!slotExists_(slot)) return { ok: false, error: 'not_found', message: '계정을 찾지 못했습니다' };
  let sec = secFind_(slot);
  if (sec && sec.hash) return { ok: false, error: 'exists', message: '이미 등록된 계정입니다. 다시 로그인해 주세요' };
  const salt = secSalt_();
  const o = sec || { uid: slot };
  o.salt = salt; o.hash = secHash_(salt, h); o.active = true; o.fails = 0; o.lockUntil = 0;
  o.pwSetAt = Date.now(); o.mustChange = secIsDefault_(slot, h);
  secWrite_(o);
  const tk = secMakeToken_(slot, o.hash);
  secLog_(s.ss, slot, 'adopt', '성공', b.device, '서버 비밀번호 등록');
  return { ok: true, token: tk.token, expiresAt: tk.exp, mustChange: !!o.mustChange };
}
function authPw_(b, tok) {
  if (!tok) return { ok: false, error: 'unauthorized', needLogin: true };
  const slot = tok.uid;
  const oldH = String(b.oldH || '').trim(), newH = String(b.newH || '').trim();
  const s = sheet_();
  if (!/^[0-9a-f]{64}$/.test(newH)) return { ok: false, error: 'bad_request', message: '새 비밀번호가 올바르지 않습니다' };
  if (secIsDefault_(slot, newH)) return { ok: false, error: 'weak_password', message: '처음 받은 기본 비밀번호는 쓸 수 없습니다' };
  let sec = secFind_(slot);
  if (!sec) return { ok: false, error: 'not_found' };
  if (secHash_(sec.salt, oldH) !== sec.hash) return { ok: false, error: 'bad_credentials', message: '지금 쓰는 비밀번호가 맞지 않습니다' };
  sec.salt = secSalt_(); sec.hash = secHash_(sec.salt, newH); sec.mustChange = false; sec.pwSetAt = Date.now();
  sec.fails = 0; sec.lockUntil = 0;
  secWrite_(sec);
  const tk = secMakeToken_(slot, sec.hash);
  secLog_(s.ss, slot, 'change_password', '성공', b.device, '');
  return { ok: true, token: tk.token, expiresAt: tk.exp, message: '비밀번호를 바꿨습니다. 다른 기기에서는 다시 로그인해야 합니다.' };
}


/* 금전출납부 서버에 이 토큰이 살아 있는지 묻습니다 (포털 계정 문서 읽기용, 5분 기억) */
function ledgerVerify_(token) {
  token = String(token || '').trim();
  if (!token) return false;
  try {
    const cache = CacheService.getScriptCache();
    const ck = 'lv_' + token.slice(-40);
    const hit = cache.get(ck);
    if (hit) return hit === '1';
    const res = UrlFetchApp.fetch(LEDGER_URL, {
      method: 'post', muteHttpExceptions: true, contentType: 'application/json',
      payload: JSON.stringify({ action: 'verify', token: token })
    });
    const j = JSON.parse(res.getContentText() || '{}');
    const okv = !!(j && j.ok === true);
    try { cache.put(ck, okv ? '1' : '0', 300); } catch (e) { }
    return okv;
  } catch (e) { return false; }
}
