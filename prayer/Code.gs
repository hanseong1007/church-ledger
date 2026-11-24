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
      out = { ok: true, app: 'deoksin-prayer-sync', v: 1, sheet: s.url, time: Date.now() };
    } else if (action === 'list') {
      out = list_(String(b.prefix || ''));
    } else if (!/^[a-z0-9][a-z0-9-]{3,63}$/i.test(slot)) {
      out = { ok: false, error: 'bad_slot', message: '슬롯 이름이 올바르지 않습니다' };
    } else if (action === 'pull') {
      out = pull_(slot);
    } else if (action === 'push') {
      out = push_(slot, b);
    } else if (action === 'del') {
      out = del_(slot);
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
