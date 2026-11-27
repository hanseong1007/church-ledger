/* 덕신교회 부서업무 · 전 기기 동기화 API (Google Apps Script 웹앱)

   하는 일
   - 웹앱(https://hanseong1007.github.io/church-ledger/edu/)이 부서·반·학생·출석·주일보고·
     알림장·피드·일정을 AES-256-GCM 으로 암호화한 덩어리만 주고받습니다.
   - 이 스크립트는 그 암호문을 구글 시트에 그대로 보관·반환만 합니다.
     시트를 열어도 이름·출석·보고 내용 같은 평문은 보이지 않습니다.
   - 계정도 같은 방식입니다. 아이디를 해시한 행에 '암호화된 계정 열쇠(wrap)'와
     '암호화된 계정 정보(rec)'만 두고, 비밀번호를 아는 사람만 열 수 있습니다.

   action
     info                          연결 확인 + 시트 주소
     acct_get   {uid}              {ok, row}
     acct_list  {}                 {ok, rows:[…]}   (암호문만)
     acct_save  {row}              {ok, row}
     acct_del   {uid}              {ok}
     doc_pull   {rev?}             {ok, rev, chunks:[…], savedAt, updated}
     doc_push   {baseRev, chunks, device}  {ok, rev} | {ok:false, error:'conflict', rev, chunks}
     doc_list   {}                 {ok, versions:[{rev, savedAt, device}]}

   시트는 처음 호출될 때 스크립트가 직접 만들고, 그 ID를 스크립트 속성에 저장합니다.
*/

const PROP_ID = 'EDU_SHEET_ID';
const T_ACCT = '계정';
const T_DOC = '동기화';
const A_HEAD = ['uid', 'salt', 'wrap', 'rec', 'rev', 'updated', 'deleted'];
const D_HEAD = ['slot', 'rev', 'idx', 'data', 'savedAt', 'device'];
const SLOT = 'main';
const MAX_CHUNK = 45000;   // 셀 한도(50,000자)보다 여유
const MAX_CHUNKS = 80;     // 조각 80개 ≒ 3.6MB
const KEEP_REVS = 5;       // 최근 5개 판본만 보관
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
const PW_PREFIX = 'deoksin-edu-login:';
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
    if (action === 'info') {
      const s = sheet_();
      out = { ok: true, app: 'deoksin-edu-sync', v: 2, sheet: s.url, time: Date.now() };
    } else if (action === 'auth_state') {
      out = authState_(b);
    } else if (action === 'auth_login') {
      out = authLogin_(b);
    } else if (action === 'auth_adopt') {
      out = authAdopt_(b);
    } else if (action === 'setup_state') {
      out = { ok: true, exists: !acctTabEmpty_() };
    } else if (action === 'signup_check') {
      out = signupCheck_(b);
    } else if (action === 'acct_get') {
      /* 서버 비밀번호가 아직 등록되지 않은 계정만 로그인 전에 자기 줄을 읽을 수 있습니다
         (그 기기에서 열쇠가 풀리는지 확인한 뒤 auth_adopt 로 등록합니다). */
      const uid0 = String(b.uid || '').trim();
      const sec0 = secFind_(uid0);
      const tok0 = secAuth_(b);
      if (!tok0 && sec0 && sec0.hash) {
        out = { ok: false, error: 'unauthorized', needLogin: true, message: '로그인이 필요합니다' };
      } else {
        out = acctGet_(uid0);
      }
    } else {
      const tok = secAuth_(b);
      const sheetReady = (function () { try { return sheet_().ss; } catch (e) { return null; } })();
      if (sheetReady) { try { secBackupIfDue_(sheetReady); } catch (eB) {} }
      if (!tok) {
        /* 첫 관리자 계정을 만드는 순간에만 토큰 없이 계정 저장을 허용합니다 (계정 탭이 비어 있을 때). */
        if (action === 'acct_save' && (acctTabEmpty_() || acctMayCreate_(String((b.row || {}).uid || '')))) {
          out = acctSave_(b.row || {});
        } else {
          out = { ok: false, error: 'unauthorized', needLogin: true, message: '로그인이 필요합니다' };
        }
      } else if (tok.mustChange && action !== 'auth_pw') {
        out = { ok: false, error: 'must_change_password', needPwChange: true, message: '처음 받은 비밀번호입니다. 비밀번호를 먼저 바꿔 주세요' };
      } else if (action === 'auth_pw') {
        out = authPw_(b, tok);
      } else if (action === 'acct_list') {
        out = acctList_();
      } else if (action === 'acct_save') {
        out = acctSave_(b.row || {});
        if (out && out.ok) secLog_(sheetReady, tok.uid, 'acct_save', '저장', b.ua, String((b.row || {}).uid || ''));
      } else if (action === 'acct_del') {
        out = acctDel_(String(b.uid || ''));
        if (out && out.ok) secLog_(sheetReady, tok.uid, 'acct_del', '삭제', b.ua, String(b.uid || ''));
      } else if (action === 'doc_pull') {
        out = docPull_(b.rev);
      } else if (action === 'doc_push') {
        out = docPush_(b);
      } else if (action === 'doc_list') {
        out = docList_();
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
    ss = SpreadsheetApp.create('덕신교회 부서업무 동기화 (암호화)');
    props.setProperty(PROP_ID, ss.getId());
  }
  const acct = tab_(ss, T_ACCT, A_HEAD);
  tab_(ss, T_DOC, D_HEAD);
  // 기본 시트(Sheet1) 정리
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    const n = s.getName();
    if (n !== T_ACCT && n !== T_DOC && s.getLastRow() === 0 && sheets.length > 2) {
      try { ss.deleteSheet(s); } catch (e) { }
      break;
    }
  }
  return { ss: ss, acct: acct, url: ss.getUrl() };
}

function tab_(ss, name, head) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    sh.getRange('A:F').setNumberFormat('@');
  }
  return sh;
}
function rows_(sh, head) {
  const lr = sh.getLastRow();
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, head.length).getValues();
}

/* 셀 값이 '=' '+' '-' 로 시작하면 시트가 수식으로 해석해 #ERROR! 가 됩니다.
   저장할 때 '~' 를 붙이고 읽을 때 떼어, 어떤 값도 수식이 되지 않게 합니다. */
function enc_(v) { return '~' + String(v == null ? '' : v); }
function dec_(v) { const s = String(v == null ? '' : v); return s.charAt(0) === '~' ? s.slice(1) : s; }

function obj_(head, row) {
  const o = {};
  for (let i = 0; i < head.length; i++) o[head[i]] = row[i];
  return o;
}

/* ---------- 계정 ---------- */
function acctIndex_(sh, uid) {
  const rows = rows_(sh, A_HEAD);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === uid) return { i: i + 2, row: rows[i] };
  }
  return null;
}

function acctGet_(uid) {
  const s = sheet_();
  if (!/^[0-9a-f]{8,64}$/.test(uid)) return { ok: false, error: 'bad_uid', message: '아이디 형식이 올바르지 않습니다' };
  const hit = acctIndex_(s.acct, uid);
  if (!hit) return { ok: true, row: null };
  const o = obj_(A_HEAD, hit.row);
  if (String(o.deleted) === '1') return { ok: true, row: null };
  o.salt = dec_(o.salt); o.wrap = dec_(o.wrap); o.rec = dec_(o.rec);
  return { ok: true, row: o };
}

function acctList_() {
  const s = sheet_();
  const rows = rows_(s.acct, A_HEAD).map(function (r) {
    const o = obj_(A_HEAD, r);
    o.salt = dec_(o.salt); o.wrap = dec_(o.wrap); o.rec = dec_(o.rec);
    return o;
  });
  return { ok: true, rows: rows };
}

function acctSave_(row) {
  const s = sheet_();
  const uid = String(row.uid || '');
  if (!/^[0-9a-f]{8,64}$/.test(uid)) return { ok: false, error: 'bad_uid', message: '아이디 형식이 올바르지 않습니다' };
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    const vals = [uid, enc_(row.salt), enc_(row.wrap), enc_(row.rec), Number(row.rev) || Date.now(), Number(row.updated) || Date.now(), String(row.deleted || '')];
    const hit = acctIndex_(s.acct, uid);
    if (hit) s.acct.getRange(hit.i, 1, 1, A_HEAD.length).setValues([vals]);
    else s.acct.appendRow(vals);
    const out = obj_(A_HEAD, vals);
    out.salt = dec_(out.salt); out.wrap = dec_(out.wrap); out.rec = dec_(out.rec);
    return { ok: true, row: out };
  } finally {
    try { lock.releaseLock(); } catch (e) { }
  }
}

function acctDel_(uid) {
  const s = sheet_();
  const hit = acctIndex_(s.acct, uid);
  if (!hit) return { ok: true, removed: false };
  s.acct.getRange(hit.i, A_HEAD.indexOf('deleted') + 1).setValue('1');
  s.acct.getRange(hit.i, A_HEAD.indexOf('rev') + 1).setValue(Date.now());
  return { ok: true, removed: true };
}

/* ---------- 업무 자료 (암호문 덩어리) ---------- */
function docRows_(sh) {
  return rows_(sh, D_HEAD).filter(function (r) { return String(r[0]) === SLOT; });
}

function maxRev_(sh) {
  const rows = docRows_(sh);
  let rev = 0;
  for (let i = 0; i < rows.length; i++) rev = Math.max(rev, Number(rows[i][1]) || 0);
  return rev;
}

function docPull_(wantRev) {
  return docPull2_(sheet_(), wantRev);
}

function docPull2_(s, wantRev) {
  const sh = s.ss.getSheetByName(T_DOC);
  const rows = docRows_(sh);
  if (!rows.length) return { ok: true, rev: 0, chunks: [], savedAt: 0, updated: 0 };
  const top = maxRev_(sh);
  const rev = wantRev ? Number(wantRev) : top;
  const picked = rows.filter(function (r) { return (Number(r[1]) || 0) === rev; });
  if (!picked.length) return { ok: false, error: 'no_rev', message: '해당 판본이 없습니다' };
  picked.sort(function (a, b) { return (Number(a[2]) || 0) - (Number(b[2]) || 0); });
  return {
    ok: true, rev: rev, top: top,
    chunks: picked.map(function (r) { return dec_(r[3]); }),
    savedAt: Number(picked[0][4]) || 0,
    updated: Number(picked[0][4]) || 0,
    device: String(picked[0][5] || '')
  };
}

function docPush_(b) {
  const s = sheet_();
  const sh = s.ss.getSheetByName(T_DOC);
  const chunks = b.chunks || [];
  if (!chunks.length) return { ok: false, error: 'empty', message: '보낼 자료가 없습니다' };
  if (chunks.length > MAX_CHUNKS) return { ok: false, error: 'too_big', message: '자료가 너무 큽니다' };
  for (let i = 0; i < chunks.length; i++) {
    if (String(chunks[i]).length > MAX_CHUNK + 100) return { ok: false, error: 'chunk_big', message: '조각이 너무 큽니다' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    const top = maxRev_(sh);
    const base = Number(b.baseRev) || 0;
    if (base !== top) {
      const cur = docPull2_(s, top);
      cur.ok = false;
      cur.error = 'conflict';
      cur.message = '다른 기기에서 먼저 저장했습니다';
      return cur;
    }
    const rev = top + 1;
    const now = Date.now();
    const device = String(b.device || '').slice(0, 60);
    const vals = chunks.map(function (c, i) { return [SLOT, rev, i, enc_(c), now, device]; });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, D_HEAD.length).setValues(vals);
    docPrune_(sh);
    return { ok: true, rev: rev, top: rev, savedAt: now, chunks: chunks.length };
  } finally {
    try { lock.releaseLock(); } catch (e) { }
  }
}

function docPrune_(sh) {
  const rows = docRows_(sh);
  const revs = {};
  for (let i = 0; i < rows.length; i++) revs[Number(rows[i][1]) || 0] = 1;
  const sorted = Object.keys(revs).map(Number).sort(function (a, b) { return b - a; });
  if (sorted.length <= KEEP_REVS) return;
  const drop = {};
  for (let i = KEEP_REVS; i < sorted.length; i++) drop[sorted[i]] = 1;
  const lr = sh.getLastRow();
  if (lr < 2) return;
  const all = sh.getRange(2, 1, lr - 1, D_HEAD.length).getValues();
  const keep = [];
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]) !== SLOT) { keep.push(all[i]); continue; }
    if (!drop[Number(all[i][1]) || 0]) keep.push(all[i]);
  }
  sh.getRange(2, 1, lr - 1, D_HEAD.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, D_HEAD.length).setValues(keep);
}

function docList_() {
  const s = sheet_();
  const sh = s.ss.getSheetByName(T_DOC);
  const rows = docRows_(sh);
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    const rev = Number(rows[i][1]) || 0;
    if (!map[rev]) map[rev] = { rev: rev, savedAt: Number(rows[i][4]) || 0, device: String(rows[i][5] || ''), chunks: 0 };
    map[rev].chunks++;
  }
  return { ok: true, versions: Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.rev - a.rev; }) };
}

/* ============================================================
   2026-11-27 보안 강화 — 서버 로그인 확인 · 서명 토큰 · 잠금 · 감사 · 백업
   · 비밀번호는 브라우저에서 h = SHA-256('deoksin-edu-login:' + 아이디 + ':' + 비밀번호) 로
     바꿔 보내고, 서버는 salt + h 의 해시만 보관합니다(원문 비밀번호는 서버에 오지 않습니다).
   · 로그인에 성공하면 12시간 만료 HMAC-SHA256 토큰을 발급하고, 자료를 다루는 모든 요청은
     이 토큰이 있어야 합니다.
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
function secHash_(salt, h) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(h), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < d.length; i++) { const b = (d[i] + 256) % 256; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}
function secSalt_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function secHex_(str) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < d.length; i++) { const b = (d[i] + 256) % 256; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}
function secIsDefault_(uid, h) {
  for (let i = 0; i < DEFAULT_PWS.length; i++) {
    if (String(h) === secHex_(PW_PREFIX + String(uid) + ':' + DEFAULT_PWS[i])) return true;
  }
  return false;
}

/* 보안계정 탭 */
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
    const r = vals[i];
    const uid = String(r[0] == null ? '' : r[0]).trim();
    if (!uid) continue;
    out.push({
      uid: uid, salt: String(r[1] || ''), hash: String(r[2] || ''),
      mustChange: String(r[3]) === '1' || Number(r[3]) === 1,
      active: !(String(r[4]) === '0' || r[4] === false),
      fails: Number(r[5]) || 0, lockUntil: Number(r[6]) || 0,
      pwSetAt: Number(r[7]) || 0, updatedAt: Number(r[8]) || 0, row: i + 2
    });
  }
  return out;
}
function secFind_(uid) {
  const list = secRows_();
  for (let i = 0; i < list.length; i++) { if (list[i].uid === String(uid)) return list[i]; }
  return null;
}
function secWrite_(o) {
  const sh = secSheet_();
  const vals = [o.uid, o.salt || '', o.hash || '', o.mustChange ? 1 : 0, o.active === false ? 0 : 1,
    Number(o.fails) || 0, Number(o.lockUntil) || 0, Number(o.pwSetAt) || 0, Date.now()];
  if (o.row) { sh.getRange(o.row, 1, 1, SEC_HEAD.length).setValues([vals]); }
  else { sh.appendRow(vals); }
  return o;
}

/* 계정 행(계정 탭) — 있는지만 확인 */
function acctExists_(uid) {
  const s = sheet_();
  const hit = acctIndex_(s.acct, uid);
  if (!hit) return false;
  return String(hit.row[6]) !== '1';
}

/* 감사 로그 */
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

/* 하루 1회 스냅샷 (계정 탭 + 동기화 판본 표시) */
function secBackupIfDue_(ss) {
  const p = secProps_();
  const last = Number(p.getProperty('LAST_BACKUP') || 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  let sh = ss.getSheetByName(BACKUP_TAB);
  if (!sh) {
    sh = ss.insertSheet(BACKUP_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['시각', '탭', '조각', '데이터']]);
    sh.setFrozenRows(1);
    sh.getRange('A:D').setNumberFormat('@');
  }
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const rows = [];
  const names = [T_ACCT, SEC_TAB];
  for (let n = 0; n < names.length; n++) {
    const t = ss.getSheetByName(names[n]);
    if (!t) continue;
    const lr = t.getLastRow();
    if (lr < 1) continue;
    const json = JSON.stringify(t.getRange(1, 1, lr, Math.max(1, t.getLastColumn())).getValues());
    for (let i = 0; i < json.length; i += 45000) rows.push([stamp, names[n], Math.floor(i / 45000), json.substr(i, 45000)]);
  }
  const doc = ss.getSheetByName(T_DOC);
  if (doc) rows.push([stamp, T_DOC, 0, '판본 보관: 최근 ' + KEEP_REVS + '개 (doc_pull rev 로 복원)']);
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

/* ---------- 인증 action ---------- */
function authState_(b) {
  const uid = String(b.uid || '').trim();
  if (!/^[0-9a-f]{8,64}$/.test(uid)) return { ok: false, error: 'bad_uid' };
  const exists = acctExists_(uid);
  const sec = secFind_(uid);
  const now = Date.now();
  return {
    ok: true, exists: exists, has: !!(sec && sec.hash),
    active: exists && (!sec || sec.active !== false),
    mustChange: !!(sec && sec.mustChange),
    locked: !!(sec && sec.lockUntil && sec.lockUntil > now),
    lockLeftMs: sec && sec.lockUntil && sec.lockUntil > now ? sec.lockUntil - now : 0
  };
}

function authLogin_(b) {
  const uid = String(b.uid || '').trim();
  const h = String(b.h || '').trim();
  const now = Date.now();
  const s = sheet_();
  if (!/^[0-9a-f]{8,64}$/.test(uid) || !/^[0-9a-f]{64}$/.test(h)) {
    return { ok: false, error: 'bad_request', message: '로그인 정보가 올바르지 않습니다' };
  }
  let sec = secFind_(uid);
  if (!sec || !sec.hash) return { ok: false, error: 'no_password', message: '이 계정은 아직 서버에 비밀번호가 등록되지 않았습니다' };
  if (sec.lockUntil && sec.lockUntil > now) {
    const left = Math.max(1, Math.ceil((sec.lockUntil - now) / 60000));
    secLog_(s.ss, uid, 'login', '잠김', b.ua, left + '분 남음');
    return { ok: false, error: 'locked', message: '비밀번호를 ' + MAX_FAILS + '번 연속 틀어 ' + LOCK_MINUTES + '분 동안 잠겼습니다. ' + left + '분 뒤에 다시 시도해 주세요.', retryAfterMs: sec.lockUntil - now };
  }
  const good = secHash_(sec.salt, h) === sec.hash;
  if (!good) {
    sec.fails = (Number(sec.fails) || 0) + 1;
    let msg = '아이디 또는 비밀번호가 맞지 않습니다.';
    let res = '실패';
    if (sec.fails >= MAX_FAILS) {
      sec.lockUntil = now + LOCK_MINUTES * 60000; sec.fails = 0; res = '잠금';
      msg = '비밀번호를 ' + MAX_FAILS + '번 연속 틀어 ' + LOCK_MINUTES + '분 동안 잠깁니다.';
    }
    secWrite_(sec);
    secLog_(s.ss, uid, 'login', res, b.ua, '');
    return { ok: false, error: res === '잠금' ? 'locked' : 'bad_credentials', message: msg };
  }
  if (sec.active === false) { secLog_(s.ss, uid, 'login', '중지', b.ua, ''); return { ok: false, error: 'disabled', message: '사용이 중지된 계정입니다' }; }
  if (!sec.mustChange && secIsDefault_(uid, h)) { sec.mustChange = true; }
  sec.fails = 0; sec.lockUntil = 0;
  secWrite_(sec);
  const tk = secMakeToken_(uid, sec.hash);
  secLog_(s.ss, uid, 'login', '성공', b.ua, sec.mustChange ? '기본 비밀번호 · 변경 필요' : '');
  return { ok: true, token: tk.token, expiresAt: tk.exp, mustChange: !!sec.mustChange };
}

function authAdopt_(b) {
  const uid = String(b.uid || '').trim();
  const h = String(b.h || '').trim();
  const s = sheet_();
  if (!/^[0-9a-f]{8,64}$/.test(uid) || !/^[0-9a-f]{64}$/.test(h)) {
    return { ok: false, error: 'bad_request', message: '로그인 정보가 올바르지 않습니다' };
  }
  if (!acctExists_(uid)) return { ok: false, error: 'not_found', message: '계정을 찾지 못했습니다' };
  let sec = secFind_(uid);
  if (sec && sec.hash) return { ok: false, error: 'exists', message: '이미 등록된 계정입니다. 다시 로그인해 주세요' };
  if (sec && sec.lockUntil && sec.lockUntil > Date.now()) {
    return { ok: false, error: 'locked', message: '잠시 뒤에 다시 시도해 주세요' };
  }
  const salt = secSalt_();
  const o = sec || { uid: uid };
  o.salt = salt; o.hash = secHash_(salt, h); o.active = true; o.fails = 0; o.lockUntil = 0;
  o.pwSetAt = Date.now();
  o.mustChange = secIsDefault_(uid, h);
  secWrite_(o);
  const tk = secMakeToken_(uid, o.hash);
  secLog_(s.ss, uid, 'adopt', '성공', b.ua, '서버 비밀번호 등록');
  return { ok: true, token: tk.token, expiresAt: tk.exp, mustChange: !!o.mustChange };
}

function authPw_(b, tok) {
  const uid = tok.uid || tok.u;
  const oldH = String(b.oldH || '').trim();
  const newH = String(b.newH || '').trim();
  const s = sheet_();
  if (!/^[0-9a-f]{64}$/.test(newH)) return { ok: false, error: 'bad_request', message: '새 비밀번호가 올바르지 않습니다' };
  if (secIsDefault_(uid, newH)) return { ok: false, error: 'weak_password', message: '처음 받은 기본 비밀번호는 쓸 수 없습니다' };
  let sec = secFind_(uid);
  if (!sec) return { ok: false, error: 'not_found' };
  if (secHash_(sec.salt, oldH) !== sec.hash) {
    secLog_(s.ss, uid, 'change_password', '실패', b.ua, '지금 비밀번호 불일치');
    return { ok: false, error: 'bad_credentials', message: '지금 쓰는 비밀번호가 맞지 않습니다' };
  }
  sec.salt = secSalt_(); sec.hash = secHash_(sec.salt, newH); sec.mustChange = false;
  sec.pwSetAt = Date.now(); sec.fails = 0; sec.lockUntil = 0;
  secWrite_(sec);
  const tk = secMakeToken_(uid, sec.hash);
  secLog_(s.ss, uid, 'change_password', '성공', b.ua, '');
  return { ok: true, token: tk.token, expiresAt: tk.exp, message: '비밀번호를 바꿨습니다. 다른 기기에서는 다시 로그인해야 합니다.' };
}

/* 토큰 확인 — 없거나 위조·만료·중지면 null */
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

/* 계정 탭이 완전히 비었는지 (첫 관리자 만들기 판단) */
function acctTabEmpty_() {
  try {
    const s = sheet_();
    const lr = s.acct.getLastRow();
    if (lr < 2) return true;
    const vals = s.acct.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0] == null ? '' : vals[i][0]).trim()) return false;
    }
    return true;
  } catch (e) { return false; }
}


/* 가입 신청 확인 — 로그인 전에도 쓸 수 있지만, 평문 신청서의 이름·아이디·역할만 돌려줍니다.
   (비밀번호 해시·salt·암호문·계정 암호문은 절대 내려주지 않습니다) */
function signupCheck_(b) {
  const uid = String(b.uid || '').trim();
  if (!/^[0-9a-f]{8,64}$/.test(uid)) return { ok: false, error: 'bad_uid' };
  const s = sheet_();
  let mine = null;
  const pending = [];
  const rows = rows_(s.acct, A_HEAD);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const u = String(r[0] == null ? '' : r[0]).trim();
    const del = String(r[6] == null ? '' : r[6]);
    let rec = null;
    try { rec = JSON.parse(dec_(r[3]) || 'null'); } catch (e) { rec = null; }
    const kind = (function () {
      if (del === '1') return 'deleted';
      if (del === 'R' || (rec && rec.app && rec.status === 'rejected')) return 'rejected';
      if (rec && rec.app) return rec.status === 'approved' ? 'approved' : 'pending';
      return 'active';
    })();
    if (u === uid) { mine = kind; continue; }
    if (!rec || !rec.app) continue;                 // 암호화된 일반 계정은 이름을 볼 수 없습니다
    if (kind !== 'pending' && kind !== 'approved') continue;
    pending.push({ id: String(rec.app.id || ''), name: String(rec.app.name || ''), roles: rec.app.roles || [], approved: kind === 'approved' });
  }
  return { ok: true, mine: mine, pending: pending };
}

/* 토큰 없이 계정 줄을 새로 쓸 수 있는 경우 — 아직 없는 아이디이거나, 반려·삭제된 신청을 다시 낼 때 */
function acctMayCreate_(uid) {
  if (!/^[0-9a-f]{8,64}$/.test(uid)) return false;
  try {
    const s = sheet_();
    const hit = acctIndex_(s.acct, uid);
    if (!hit) return true;
    const del = String(hit.row[6] == null ? '' : hit.row[6]);
    return del === 'R' || del === '1';
  } catch (e) { return false; }
}
