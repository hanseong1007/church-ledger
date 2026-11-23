/* 교회 재정 보고 변환 · 전 기기 동기화 API (Google Apps Script 웹앱)

   하는 일
   - 웹앱(https://hanseong1007.github.io/church-ledger/ppt/)이 작업 내용을 비밀번호에서 뽑은 키로
     AES-GCM 암호화한 덩어리(ciphertext)만 주고받습니다.
   - 이 스크립트는 그 암호문을 구글 시트에 그대로 보관·반환만 합니다.
     시트를 열어도 재정 숫자·항목 이름 같은 평문은 보이지 않습니다.
   - 어느 기기에서든 같은 비밀번호로 들어오면 같은 'slot' 이름이 만들어지므로,
     그 슬롯의 암호문을 내려받아 그 기기에서 복호화해 이어서 작업합니다.

   action
     info   연결 확인
     meta   {slot} → {ok, updatedAt, chunks}
     pull   {slot} → {ok, updatedAt, chunks:[암호문 조각…]}
     push   {slot, updatedAt, savedAt, device, chunks:[…]} → {ok, updatedAt}
     drop   {slot} → 슬롯 삭제(테스트 정리용)

   시트는 처음 호출될 때 스크립트가 직접 만들고, 그 ID를 스크립트 속성에 저장합니다.
*/

const PROP_ID = 'FR_SHEET_ID';
const TAB = '동기화';
const HEAD = ['slot', 'idx', 'data', 'updatedAt', 'savedAt', 'device', 'bytes'];
const MAX_CHUNK = 45000;
const MAX_CHUNKS = 40;      // 조각 40개 ≒ 1.8MB 까지
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
      out = { ok: true, app: 'church-finance-report-sync', v: 1, sheet: s.url, time: Date.now() };
    } else if (!/^[0-9a-f]{16,64}$/.test(slot)) {
      out = { ok: false, error: 'bad_slot', message: '슬롯 이름이 올바르지 않습니다' };
    } else if (action === 'meta') {
      out = meta_(slot);
    } else if (action === 'pull') {
      out = pull_(slot);
    } else if (action === 'push') {
      out = push_(slot, b);
    } else if (action === 'drop') {
      out = drop_(slot);
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
    ss = SpreadsheetApp.create('교회 재정 보고 동기화 (암호화)');
    props.setProperty(PROP_ID, ss.getId());
  }
  let sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('C:C').setNumberFormat('@');
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      if (s.getName() !== TAB && s.getLastRow() === 0 && sheets.length > 1) {
        try { ss.deleteSheet(s); } catch (e) {}
        break;
      }
    }
  }
  return { ss: ss, sh: sh, url: ss.getUrl() };
}

function readRows_(sh) {
  const lr = sh.getLastRow();
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, HEAD.length).getValues();
}

/* ---------- action ---------- */
function slotRows_(sh, slot) {
  const rows = readRows_(sh);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '') === slot) {
      out.push({ row: i + 2, idx: Number(rows[i][1]) || 0, data: String(rows[i][2] || ''), updatedAt: Number(rows[i][3]) || 0 });
    }
  }
  out.sort(function (a, b) { return a.idx - b.idx; });
  return out;
}

function meta_(slot) {
  const s = sheet_();
  const list = slotRows_(s.sh, slot);
  let updatedAt = 0;
  for (let i = 0; i < list.length; i++) updatedAt = Math.max(updatedAt, list[i].updatedAt);
  return { ok: true, updatedAt: updatedAt, chunks: list.length, sheet: s.url };
}

function pull_(slot) {
  const s = sheet_();
  const list = slotRows_(s.sh, slot);
  let updatedAt = 0;
  const chunks = [];
  for (let i = 0; i < list.length; i++) {
    updatedAt = Math.max(updatedAt, list[i].updatedAt);
    chunks.push(list[i].data);
  }
  return { ok: true, updatedAt: updatedAt, chunks: chunks, sheet: s.url };
}

function push_(slot, b) {
  const chunks = b.chunks || [];
  if (!chunks.length) return { ok: false, error: 'empty', message: '보낼 자료가 없습니다' };
  if (chunks.length > MAX_CHUNKS) return { ok: false, error: 'too_large', message: '자료가 너무 큽니다 (' + chunks.length + '조각)' };
  for (let i = 0; i < chunks.length; i++) {
    if (String(chunks[i]).length > MAX_CHUNK) {
      return { ok: false, error: 'chunk_too_large', message: '조각이 너무 큽니다' };
    }
  }
  const lock = LockService.getScriptLock();
  let got = false;
  try {
    lock.waitLock(LOCK_MS);
    got = true;
  } catch (e) {
    return { ok: false, error: 'busy', message: '잠시 뒤 다시 시도해 주세요' };
  }
  try {
    const s = sheet_();
    const sh = s.sh;
    const old = slotRows_(sh, slot);
    for (let i = old.length - 1; i >= 0; i--) sh.deleteRow(old[i].row);
    const updatedAt = Number(b.updatedAt) || Date.now();
    const savedAt = Number(b.savedAt) || updatedAt;
    const device = String(b.device || '').slice(0, 24);
    const rows = [];
    let bytes = 0;
    for (let i = 0; i < chunks.length; i++) {
      const d = String(chunks[i]);
      bytes += d.length;
      rows.push([slot, i, d, updatedAt, savedAt, device, d.length]);
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
    return { ok: true, updatedAt: updatedAt, chunks: rows.length, bytes: bytes, sheet: s.url };
  } finally {
    if (got) { try { lock.releaseLock(); } catch (e2) {} }
  }
}

function drop_(slot) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_MS); } catch (e) {}
  try {
    const s = sheet_();
    const list = slotRows_(s.sh, slot);
    for (let i = list.length - 1; i >= 0; i--) s.sh.deleteRow(list[i].row);
    return { ok: true, removed: list.length, sheet: s.url };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* 시트 주소를 확인하고 싶을 때 편집기에서 한 번 실행 */
function showSheet() {
  const s = sheet_();
  return s.url;
}
