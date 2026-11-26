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
      out = { ok: true, app: 'deoksin-edu-sync', v: 1, sheet: s.url, time: Date.now() };
    } else if (action === 'acct_get') {
      out = acctGet_(String(b.uid || ''));
    } else if (action === 'acct_list') {
      out = acctList_();
    } else if (action === 'acct_save') {
      out = acctSave_(b.row || {});
    } else if (action === 'acct_del') {
      out = acctDel_(String(b.uid || ''));
    } else if (action === 'doc_pull') {
      out = docPull_(b.rev);
    } else if (action === 'doc_push') {
      out = docPush_(b);
    } else if (action === 'doc_list') {
      out = docList_();
    } else {
      out = { ok: false, error: 'unknown_action', message: '알 수 없는 요청: ' + action };
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
