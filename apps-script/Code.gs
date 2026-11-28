/* 교회 금전출납부 · 공유 데이터 API (Google Apps Script 웹앱)
   스프레드시트 「교회 금전출납부 (공유 데이터)」에 붙여 배포한 서버 코드입니다.

   ★ 보안 강화판 (2026-11-27)
   - 계정은 `계정` 시트에 저장합니다 (id, name, role, salt, pwHash, active ... mustChange, fails, lockUntil, pwSetAt).
     비밀번호는 SHA-256(salt + ":" + 비밀번호) 해시로만 보관하고 원문은 저장하지 않습니다.
   - 로그인은 서버가 직접 확인하고, 서버 속성의 비밀키로 서명한 HMAC-SHA256 토큰을 발급합니다(12시간 만료).
     토큰에는 계정·권한·만료·비밀번호 판본이 들어 있어 위조·만료·비밀번호 변경 뒤의 토큰은 거부됩니다.
   - 5회 연속 실패하면 15분 잠깁니다(서버가 셉니다).
   - 장부 데이터를 다루는 모든 action 은 서명 토큰 없이는 { ok:false, error:"unauthorized" } 만 돌려줍니다.
   - 처음 받은 기본 비밀번호(admin1234 등)로 로그인하면 비밀번호를 바꾸기 전까지 다른 기능을 막습니다.
   - 시트에는 장부 내용을 AES-256-GCM 으로 암호화해 저장합니다(키는 스크립트 속성에만).
   - 로그인·수정·계정관리 이력은 `보안로그`, 하루 1회 스냅샷은 `백업` 탭에 남습니다.

   action 목록
     login, logout, me
     sync_all, save_entry, save_settings, bulk_import, reset_all
     change_password, users_list, user_save, user_delete
*/

const SHEET_ENTRIES = "거래내역";
const SHEET_SETTINGS = "설정";
const SHEET_USERS = "계정";
const SHEET_SESSIONS = "세션";
const SHEET_ID = "1PLtsH2E1CkALiP8xHLs73hfpouqL01iCrrqO-uqz8lg";

const HEAD = ["id", "date", "type", "cat", "memo", "pay", "amount", "author", "receiptData", "updatedAt", "deleted"];
/* 영수증은 암호문이 한 칸(50,000자)을 넘을 수 있어 뒤 두 칸에 이어 붙입니다. */
const WIDTH = 13;
const RECEIPT_CHUNK = 45000;
const USER_HEAD = ["id", "name", "role", "salt", "pwHash", "active", "createdAt", "updatedAt", "mustChange", "fails", "lockUntil", "pwSetAt"];
const SESS_HEAD = ["token", "id", "pwHash", "createdAt", "expiresAt"]; var SEC_KEY_CACHE_ = null, DATA_KEY_CACHE_ = null; /* 성능: 스크립트 속성 키는 실행마다 한 번만 읽습니다 */

const LOCK_MS = 25000;
const RECEIPT_MAX = 46000;
const ADMIN_ID = "admin";
const ADMIN_INIT_PW = "admin1234";
const MIN_PW = 6;
const MAX_FAILS = 5;             // 5회 연속 실패 → 15분 잠금 (서버가 셉니다)
const LOCK_MINUTES = 15;
const TOKEN_HOURS = 12;          // 서명 토큰 만료 12시간
const SEC_LOG = "보안로그";
const SEC_LOG_MAX = 3000;
const BACKUP_TAB = "백업";
const BACKUP_DAYS = 7;
const DEFAULT_PWS = ["admin1234", "deoksin2026", "deoksin2026!", "123456", "12345678", "0000"];

/* ============================================================
   진입점
   ============================================================ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  return handle(p.action || "sync_all", p, p);
}

function doPost(e) {
  let body = {};
  const raw = e && e.postData ? e.postData.contents : "";
  try { body = JSON.parse(raw || "{}"); } catch (err) { body = {}; }
  const p = (e && e.parameter) || {};
  return handle(body.action || p.action || "sync_all", body, p);
}

function handle(action, body, p) {
  let out = {};
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_MS);
    const t = ensureTabs_(getSpreadsheet_());
    try { backupIfDue_(t.ss); } catch (eB) {}

    if (action === "info") {
      out = { ok: true, app: "church-ledger", v: 7, time: Date.now() };
    } else if (action === "portal_get" || action === "portal_put") {
      /* 포털 계정 문서는 중보기도문 시트의 portal-acct 슬롯에 있습니다.
         그 시트를 여는 권한은 이 스크립트(같은 구글 계정)에 있으므로, 포털은 이 서버를 거쳐 읽고 씁니다. */
      const pa = authOf_(t, body, p);
      out = pa ? portalDoc_(action, body) : { ok: false, error: "unauthorized", needLogin: true, message: "로그인이 필요합니다" };
      if (out && out.ok && pa && action === "portal_put") {
        audit_(t.ss, pa.id, "portal_put", "저장", clientOf_(body, p), "포털 계정 문서");
      }
    } else if (action === "verify") {
      /* 다른 교회 앱(포털 등)이 이 토큰이 살아 있는지 물어볼 때 씁니다. */
      const vc = readToken_(String((body && body.token) || (p && p.token) || ""));
      const vu = vc ? findUser_(t, vc.u) : null;
      out = (vc && vu && vu.active && String(vu.pwHash || "").slice(0, 16) === String(vc.pv || ""))
        ? { ok: true, user: { id: vu.id, name: vu.name, role: vu.role }, exp: Number(vc.exp) || 0 }
        : { ok: false, error: "invalid_token" };
    } else if (action === "login") {
      out = login_(t, body, p);
    } else if (action === "logout") {
      out = logout_(t, body, p);
    } else {
      const auth = authOf_(t, body, p);
      if (!auth) {
        out = { ok: false, error: "unauthorized", message: "로그인이 필요합니다" };
      } else if (auth.mustChange && action !== "me" && action !== "logout" && action !== "change_password") {
        out = { ok: false, error: "must_change_password", needPwChange: true,
          message: "처음 받은 비밀번호입니다. 비밀번호를 바꾸기 전에는 다른 기능을 쓸 수 없습니다." };
      } else if (action === "me") {
        out = { ok: true, user: { id: auth.id, name: auth.name, role: auth.role },
          mustChange: !!auth.mustChange, tokenExpiresAt: auth.exp || 0 };
      } else if (action === "encrypt_all") {
        out = (auth.role === "admin")
          ? encryptAll_(t, auth, body)
          : { ok: false, error: "forbidden", message: "관리자만 할 수 있습니다" };
      } else if (action === "change_password") {
        out = changePassword_(t, auth, body, p);
      } else if (action === "users_list") {
        out = usersList_(t, auth);
      } else if (action === "user_save") {
        out = userSave_(t, auth, body, p);
      } else if (action === "user_delete") {
        out = userDelete_(t, auth, body, p);
      } else if (action === "save_entry") {
        out = saveEntry_(t, body.entry || body, auth);
      } else if (action === "save_settings") {
        out = saveSettings_(t, body.settings || body);
      } else if (action === "bulk_import") {
        out = bulkImport_(t, body, auth);
      } else if (action === "reset_all") {
        // 전체 초기화는 공유 장부를 통째로 지우므로 관리자만 할 수 있습니다.
        out = (auth.role === "admin")
          ? resetAll_(t)
          : { ok: false, error: "forbidden", message: "전체 초기화는 관리자만 할 수 있습니다" };
      } else {
        out = syncAll_(t);
      }
      if (out && out.ok && AUDIT_ACTIONS[action]) {
        audit_(t.ss, auth.id, action, "성공", clientOf_(body, p), auditNote_(action, out));
      }
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  out.action = action;
  out.serverTime = Date.now();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { return active; }
  return SpreadsheetApp.openById(SHEET_ID);
}

/* ============================================================
   시트 준비
   ============================================================ */
function ensureTabs_(ss) {
  let e = ss.getSheetByName(SHEET_ENTRIES);
  if (!e) { e = ss.insertSheet(SHEET_ENTRIES); }
  if (e.getLastRow() < 1 || String(e.getRange(1, 1).getValue()) !== "id") {
    e.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    e.getRange(1, 12, 1, 2).setValues([["receiptData(암호 이어짐)", "receiptData(암호 이어짐2)"]]);
    e.setFrozenRows(1);
    e.getRange("B:B").setNumberFormat("@");
    e.getRange("I:I").setNumberFormat("@");
  }

  let s = ss.getSheetByName(SHEET_SETTINGS);
  if (!s) {
    s = ss.insertSheet(SHEET_SETTINGS);
    s.getRange(1, 1, 5, 2).setValues([["key", "value"], ["org", ""], ["author", ""], ["base", 0], ["accounts", ""]]);
    s.getRange("A:A").setNumberFormat("@");
  }

  let u = ss.getSheetByName(SHEET_USERS);
  if (!u) {
    u = ss.insertSheet(SHEET_USERS);
    u.getRange(1, 1, 1, USER_HEAD.length).setValues([USER_HEAD]);
    u.setFrozenRows(1);
    u.getRange("A:A").setNumberFormat("@");
  } else {
    // 2026-11-27 보안 열(mustChange·fails·lockUntil·pwSetAt)을 기존 시트에 더합니다.
    const need = USER_HEAD.slice(8);
    const have = u.getRange(1, 1, 1, USER_HEAD.length).getValues()[0];
    let fixed = false;
    for (let i = 0; i < need.length; i++) {
      if (String(have[8 + i] || "").trim() !== need[i]) {
        u.getRange(1, 9 + i, 1, 1).setValue(need[i]);
        fixed = true;
      }
    }
    if (fixed) {
      u.getRange(1, 1, 1, USER_HEAD.length).setFontWeight("bold");
      u.getRange(1, USER_HEAD.length).setNote("보안: 1=기본 비밀번호로 강제 변경 필요, fails=연속 실패, lockUntil=잠금 종료 시각, pwSetAt=비밀번호 변경 시각");
    }
  }

  let se = ss.getSheetByName(SHEET_SESSIONS);
  if (!se) {
    se = ss.insertSheet(SHEET_SESSIONS);
    se.getRange(1, 1, 1, SESS_HEAD.length).setValues([SESS_HEAD]);
    se.setFrozenRows(1);
    se.getRange("A:A").setNumberFormat("@");
  }

  const tab = { ss: ss, entries: e, settings: s, users: u, sessions: se };
  seedAdmin_(tab);
  return tab;
}

function seedAdmin_(t) {
  const lr = t.users.getLastRow();
  let hasAny = false;
  if (lr >= 2) {
    const ids = t.users.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] == null ? "" : ids[i][0]).trim()) { hasAny = true; break; }
    }
  }
  if (hasAny) { return; }
  const salt = newSalt_();
  t.users.getRange(2, 1, 1, USER_HEAD.length).setValues([[
    ADMIN_ID, "관리자", "admin", salt, hashPw_(salt, ADMIN_INIT_PW), true, Date.now(), Date.now(), 1, 0, 0, Date.now()
  ]]);
}

/* ============================================================
   비밀번호 · 세션
   ============================================================ */
function newSalt_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

function hashPw_(salt, pw) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ":" + String(pw), Utilities.Charset.UTF_8);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

/* ---------- 서명 토큰 (HMAC-SHA256, 12시간) ---------- */
function secKey_() {
  const props = PropertiesService.getScriptProperties();
  let k = SEC_KEY_CACHE_ || props.getProperty("SEC_TOKEN_KEY"); SEC_KEY_CACHE_ = k;
  if (!k) {
    const b = [];
    for (let i = 0; i < 32; i++) { b.push(Math.floor(Math.random() * 256)); }
    k = Utilities.base64Encode(b);
    props.setProperty("SEC_TOKEN_KEY", k);
  }
  return k;
}

function secMac_(payload64) {
  const raw = Utilities.computeHmacSha256Signature(payload64, secKey_(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(raw);
}

function makeToken_(u) {
  const now = Date.now();
  const payload = {
    u: u.id, n: u.name, r: u.role,
    pv: String(u.pwHash || "").slice(0, 16),
    iat: now, exp: now + TOKEN_HOURS * 3600 * 1000
  };
  const p64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return { token: p64 + "." + secMac_(p64), exp: payload.exp };
}

function readToken_(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) { return null; }
  if (secMac_(parts[0]) !== parts[1]) { return null; }
  let p = null;
  try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { return null; }
  if (!p || !p.u || !p.exp || Number(p.exp) < Date.now()) { return null; }
  return p;
}

function readUsers_(t) {
  const lr = t.users.getLastRow();
  if (lr < 2) { return []; }
  const rows = t.users.getRange(2, 1, lr - 1, USER_HEAD.length).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] == null ? "" : r[0]).trim();
    if (!id) { continue; }
    const actRaw = r[5];
    out.push({
      id: id,
      name: String(r[1] == null ? "" : r[1]).trim() || id,
      role: String(r[2] || "member").trim() === "admin" ? "admin" : "member",
      salt: String(r[3] || ""),
      pwHash: String(r[4] || "").trim(),
      active: !(actRaw === false || String(actRaw).toLowerCase() === "false"),
      createdAt: Number(r[6]) || 0,
      updatedAt: Number(r[7]) || 0,
      mustChange: String(r[8] == "1" ? 1 : 0) === "1" || Number(r[8]) === 1,
      fails: Number(r[9]) || 0,
      lockUntil: Number(r[10]) || 0,
      pwSetAt: Number(r[11]) || 0,
      row: i + 2
    });
  }
  return out;
}

function findUser_(t, id) {
  const list = readUsers_(t);
  const key = String(id || "").trim();
  for (let i = 0; i < list.length; i++) { if (list[i].id === key) { return list[i]; } }
  return null;
}

function writeUser_(t, u) {
  t.users.getRange(u.row, 1, 1, USER_HEAD.length).setValues([[
    u.id, u.name, u.role, u.salt, u.pwHash, u.active, u.createdAt, u.updatedAt,
    u.mustChange ? 1 : 0, Number(u.fails) || 0, Number(u.lockUntil) || 0, Number(u.pwSetAt) || 0
  ]]);
}

function publicUser_(u) {
  return { id: u.id, name: u.name, role: u.role, active: !!u.active, createdAt: u.createdAt, updatedAt: u.updatedAt, mustChange: !!u.mustChange };
}

function readSessions_(t) {
  const lr = t.sessions.getLastRow();
  if (lr < 2) { return []; }
  const rows = t.sessions.getRange(2, 1, lr - 1, SESS_HEAD.length).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const token = String(r[0] == null ? "" : r[0]).trim();
    if (!token) { continue; }
    out.push({
      token: token,
      id: String(r[1] || "").trim(),
      pwHash: String(r[2] || "").trim(),
      createdAt: Number(r[3]) || 0,
      expiresAt: Number(r[4]) || 0,
      row: i + 2
    });
  }
  return out;
}

function appendSession_(t, s) {
  t.sessions.appendRow([s.token, s.id, s.pwHash, s.createdAt, s.expiresAt]);
}

function purgeSessions_(t) {
  // 행을 지우면 아래 행 번호가 당겨지므로 항상 아래(큰 행 번호)부터 지웁니다.
  const list = readSessions_(t);
  const now = Date.now();
  const targets = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i].expiresAt && list[i].expiresAt < now) { targets[list[i].row] = true; }
  }
  if (list.length > 300) {   // 너무 많이 쌓이면 오래된 것부터 정리
    const live = list.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    let remove = list.length - 300;
    for (let j = 0; j < live.length && remove > 0; j++) {
      if (!targets[live[j].row]) { targets[live[j].row] = true; remove--; }
    }
  }
  const rows = Object.keys(targets).map(Number).sort(function (a, b) { return b - a; });
  for (let k = 0; k < rows.length; k++) { t.sessions.deleteRow(rows[k]); }
}

function deleteSessionsOf_(t, id) {
  const list = readSessions_(t);
  const rows = [];
  for (let i = 0; i < list.length; i++) { if (list[i].id === id) { rows.push(list[i].row); } }
  rows.sort(function (a, b) { return b - a; });
  for (let j = 0; j < rows.length; j++) { t.sessions.deleteRow(rows[j]); }
}

function authOf_(t, body, p) {
  const token = String((body && body.token) || (p && p.token) || "").trim();
  if (!token) { return null; }
  const c = readToken_(token);
  if (!c) { return null; }
  if (isRevoked_(t, token)) { return null; }
  const u = findUser_(t, c.u);
  if (!u || !u.active) { return null; }
  if (String(u.pwHash || "").slice(0, 16) !== String(c.pv || "")) { return null; }  // 비밀번호가 바뀌면 기존 토큰 무효
  return { id: u.id, name: u.name, role: u.role, mustChange: !!u.mustChange, exp: Number(c.exp) || 0 };
}

/* 세션 탭은 이제 '해지된 토큰' 명단으로만 씁니다 (로그아웃한 기기의 토큰). */
function isRevoked_(t, token) {
  const tag = String(token).slice(-40);
  const list = readSessions_(t);
  for (let i = 0; i < list.length; i++) {
    if (list[i].token === tag && (!list[i].expiresAt || list[i].expiresAt > Date.now())) { return true; }
  }
  return false;
}

function login_(t, body, p) {
  const id = String((body && body.id) || (p && p.id) || "").trim();
  const pw = String((body && (body.pw || body.password)) || (p && (p.pw || p.password)) || "");
  const req = clientOf_(body, p);
  if (!id) { return { ok: false, error: "invalid_request", message: "아이디를 입력해 주세요" }; }

  const now = Date.now();
  const st = lockGet_(id);
  if (st.until && st.until > now) {
    const left = Math.max(1, Math.ceil((st.until - now) / 60000));
    audit_(t.ss, id, "login", "잠김", req, left + "분 남음");
    return { ok: false, error: "locked", message: "비밀번호를 " + MAX_FAILS + "번 연속 틀어 " + LOCK_MINUTES + "분 동안 잠겼습니다. " + left + "분 뒤에 다시 시도해 주세요.", retryAfterMs: st.until - now };
  }

  const u = findUser_(t, id);
  const good = !!u && !!u.active && !!pw && !!u.pwHash && hashPw_(u.salt, pw) === u.pwHash;

  if (!good) {
    st.fails = (Number(st.fails) || 0) + 1;
    let msg = "아이디 또는 비밀번호가 맞지 않습니다.";
    if (u && !u.active) { msg = "사용이 중지된 계정입니다. 관리자에게 문의해 주세요."; }
    let locked = false;
    if (st.fails >= MAX_FAILS) {
      st.until = now + LOCK_MINUTES * 60000;
      st.fails = 0;
      locked = true;
      msg = "비밀번호를 " + MAX_FAILS + "번 연속 틀어 " + LOCK_MINUTES + "분 동안 잠깁니다. " + LOCK_MINUTES + "분 뒤에 다시 시도해 주세요.";
    }
    lockSet_(id, st);
    if (u) { u.fails = Number(st.fails) || 0; u.lockUntil = Number(st.until) || 0; writeUser_(t, u); }
    audit_(t.ss, id, "login", locked ? "잠금" : "실패", req, (u ? "계정있음" : "없는아이디") + (locked ? " · 연속실패" : ""));
    return { ok: false, error: locked ? "locked" : "bad_credentials", message: msg };
  }

  lockClear_(id);
  if (!u.mustChange && isDefaultPw_(u.salt, pw)) {
    u.mustChange = true; u.updatedAt = now; writeUser_(t, u);
  }
  const tk = makeToken_(u);
  purgeSessions_(t);
  audit_(t.ss, id, "login", "성공", req, u.mustChange ? "기본 비밀번호 · 변경 필요" : "");
  return {
    ok: true,
    user: { id: u.id, name: u.name, role: u.role },
    token: tk.token,
    expiresAt: tk.exp,
    mustChange: !!u.mustChange,
    message: u.mustChange ? "처음 받은 비밀번호입니다. 비밀번호를 먼저 바꿔 주세요." : ""
  };
}

function logout_(t, body, p) {
  const token = String((body && body.token) || (p && p.token) || "").trim();
  if (token) {
    const c = readToken_(token);
    if (c) {
      appendSession_(t, { token: token.slice(-40), id: c.u, pwHash: "", createdAt: Date.now(), expiresAt: Number(c.exp) || (Date.now() + TOKEN_HOURS * 3600000) });
      audit_(t.ss, c.u, "logout", "성공", clientOf_(body, p), "");
      purgeSessions_(t);
    }
  }
  return { ok: true };
}

function lockGet_(id) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty("LK_" + lockKey_(id));
    return v ? JSON.parse(v) : { fails: 0, until: 0 };
  } catch (e) { return { fails: 0, until: 0 }; }
}
function lockSet_(id, st) {
  try { PropertiesService.getScriptProperties().setProperty("LK_" + lockKey_(id), JSON.stringify(st || {})); } catch (e) {}
}
function lockClear_(id) {
  try { PropertiesService.getScriptProperties().deleteProperty("LK_" + lockKey_(id)); } catch (e) {}
}
function lockKey_(id) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(id).toLowerCase(), Utilities.Charset.UTF_8);
  let s = "";
  for (let i = 0; i < 10; i++) { s += ((d[i] + 256) % 256).toString(16); }
  return s;
}
function isDefaultPw_(salt, pw) {
  for (let i = 0; i < DEFAULT_PWS.length; i++) {
    if (String(pw) === DEFAULT_PWS[i] || hashPw_(salt, DEFAULT_PWS[i]) === hashPw_(salt, pw)) { return true; }
  }
  return false;
}

function changePassword_(t, auth, body, p) {
  const oldPw = String((body && (body.oldPw || body.oldPassword)) || "");
  const newPw = String((body && (body.newPw || body.newPassword)) || "");
  const u = findUser_(t, auth.id);
  if (!u) { return { ok: false, error: "not_found", message: "계정을 찾지 못했습니다" }; }
  if (!oldPw || hashPw_(u.salt, oldPw) !== u.pwHash) {
    return { ok: false, error: "bad_credentials", message: "지금 쓰는 비밀번호가 맞지 않습니다" };
  }
  if (String(newPw).length < MIN_PW) {
    return { ok: false, error: "weak_password", message: "새 비밀번호는 " + MIN_PW + "자 이상으로 정해 주세요" };
  }
  if (isDefaultPw_(u.salt, newPw)) {
    return { ok: false, error: "weak_password", message: "처음 받은 기본 비밀번호는 쓸 수 없습니다. 다른 비밀번호로 정해 주세요" };
  }
  const salt = newSalt_();
  u.salt = salt;
  u.pwHash = hashPw_(salt, newPw);
  u.updatedAt = Date.now();
  u.pwSetAt = Date.now();
  u.mustChange = false;
  writeUser_(t, u);

  // 기존 기기 세션은 모두 해제 (비밀번호 판본이 바뀌어 토큰이 자동으로 무효가 됩니다)
  const tk = makeToken_(u);
  audit_(t.ss, u.id, "change_password", "성공", clientOf_(body, p), "다른 기기 로그아웃");
  return {
    ok: true, user: { id: u.id, name: u.name, role: u.role },
    token: tk.token, expiresAt: tk.exp, mustChange: false,
    message: "비밀번호를 바꿨습니다. 다른 기기에서는 다시 로그인해야 합니다."
  };
}

function countActiveAdmins_(list) {
  let n = 0;
  for (let i = 0; i < list.length; i++) { if (list[i].role === "admin" && list[i].active) { n++; } }
  return n;
}

function usersList_(t, auth) {
  if (auth.role !== "admin") { return { ok: false, error: "forbidden", message: "관리자만 볼 수 있습니다" }; }
  const list = readUsers_(t).map(publicUser_);
  return { ok: true, users: list };
}

function userSave_(t, auth, body, p) {
  if (auth.role !== "admin") { return { ok: false, error: "forbidden", message: "관리자만 할 수 있습니다" }; }
  const src = (body && body.user) || body || {};
  const id = String(src.id || "").trim();
  const name = String(src.name || "").trim();
  const role = String(src.role || "member").trim() === "admin" ? "admin" : "member";
  const pw = String(src.pw || src.password || "");
  const active = !(src.active === false || String(src.active).toLowerCase() === "false");
  if (!id) { return { ok: false, error: "invalid_request", message: "아이디를 입력해 주세요" }; }
  if (/\s/.test(id) || id.length > 24) { return { ok: false, error: "invalid_request", message: "아이디는 공백 없이 24자 이하로 정해 주세요" }; }

  const list = readUsers_(t);
  const found = findUser_(t, id);

  if (!found) {
    if (String(pw).length < MIN_PW) {
      return { ok: false, error: "weak_password", message: "새 계정의 비밀번호는 " + MIN_PW + "자 이상으로 정해 주세요" };
    }
    const salt = newSalt_();
    t.users.appendRow([id, name || id, role, salt, hashPw_(salt, pw), true, Date.now(), Date.now(), 1, 0, 0, Date.now()]);
    const made = findUser_(t, id);
    audit_(t.ss, auth.id, "user_save", "계정 추가", clientOf_(body, p), id + " / " + role);
    return { ok: true, created: true, user: publicUser_(made) };
  }

  // 기존 계정 수정
  const willBeAdmin = role === "admin";
  const willBeActive = active;
  if (found.role === "admin" && found.active && (!willBeAdmin || !willBeActive) && countActiveAdmins_(list) <= 1) {
    return { ok: false, error: "last_admin", message: "관리자는 최소 한 명은 남아 있어야 합니다" };
  }
  found.name = name || found.name;
  found.role = role;
  found.active = willBeActive;
  found.updatedAt = Date.now();
  if (String(pw).length >= MIN_PW) {
    const salt = newSalt_();
    found.salt = salt;
    found.pwHash = hashPw_(salt, pw);
    found.mustChange = true;          // 관리자가 정해 준 비밀번호는 본인이 바꿔야 합니다
    found.pwSetAt = Date.now();
  } else if (pw) {
    return { ok: false, error: "weak_password", message: "비밀번호는 " + MIN_PW + "자 이상으로 정해 주세요" };
  }
  writeUser_(t, found);
  audit_(t.ss, auth.id, "user_save", "계정 수정", clientOf_(body, p), found.id + (String(pw) ? " / 비밀번호 초기화" : ""));
  return { ok: true, created: false, user: publicUser_(found) };
}

function userDelete_(t, auth, body, p) {
  if (auth.role !== "admin") { return { ok: false, error: "forbidden", message: "관리자만 할 수 있습니다" }; }
  const id = String((body && (body.id || (body.user && body.user.id))) || "").trim();
  if (!id) { return { ok: false, error: "invalid_request", message: "지울 계정을 골라 주세요" }; }
  if (id === auth.id) { return { ok: false, error: "self", message: "지금 로그인한 계정은 지울 수 없습니다" }; }
  const list = readUsers_(t);
  const found = findUser_(t, id);
  if (!found) { return { ok: false, error: "not_found", message: "계정을 찾지 못했습니다" }; }
  if (found.role === "admin" && found.active && countActiveAdmins_(list) <= 1) {
    return { ok: false, error: "last_admin", message: "관리자는 최소 한 명은 남아 있어야 합니다" };
  }
  t.users.deleteRow(found.row);
  deleteSessionsOf_(t, id);
  audit_(t.ss, auth.id, "user_delete", "성공", clientOf_(body, p), id);
  return { ok: true, deleted: id };
}

/* ============================================================
   장부 데이터
   ============================================================ */
function fmtDate_(v) {
  if (v instanceof Date) { return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd"); }
  return String(v == null ? "" : v).slice(0, 10);
}

function readEntries_(e) {
  const lr = e.getLastRow();
  if (lr < 2) { return []; }
  const rows = e.getRange(2, 1, lr - 1, WIDTH).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] == null ? "" : r[0]);
    if (!id) { continue; }
    out.push({
      id: id,
      date: fmtDate_(r[1]),
      type: String(r[2] || "income"),
      cat: decVal_(r[3]),
      memo: decVal_(r[4]),
      pay: decVal_(r[5]),
      amount: Math.round(Number(decVal_(r[6])) || 0),
      author: decVal_(r[7]),
      receiptData: decVal_(String(r[8] == null ? "" : r[8]) + String(r[11] == null ? "" : r[11]) + String(r[12] == null ? "" : r[12])),
      updatedAt: Number(r[9]) || 0,
      deleted: r[10] === true || String(r[10]).toLowerCase() === "true",
      row: i + 2
    });
  }
  return out;
}

function readSettings_(s) {
  const out = { org: "", author: "", base: 0, accounts: { income: [], expense: [] } };
  const lr = s.getLastRow();
  if (lr < 2) { return out; }
  const rows = s.getRange(2, 1, lr - 1, 2).getValues();
  for (let i = 0; i < rows.length; i++) {
    const k = String(rows[i][0] == null ? "" : rows[i][0]).trim();
    const v = rows[i][1];
    if (!k) { continue; }
    if (k === "accounts") {
      try {
        const a = JSON.parse(String(v || "{}"));
        if (Array.isArray(a.income)) { out.accounts.income = a.income.map(String); }
        if (Array.isArray(a.expense)) { out.accounts.expense = a.expense.map(String); }
      } catch (err) {}
    } else if (k === "base") {
      out.base = Math.round(Number(v) || 0);
    } else if (k === "org" || k === "author") {
      out[k] = String(v == null ? "" : v);
    }
  }
  return out;
}

function writeSettings_(s, st) {
  const acc = st.accounts || {};
  s.getRange(2, 1, 4, 2).setValues([
    ["org", String(st.org || "")],
    ["author", String(st.author || "")],
    ["base", Math.round(Number(st.base) || 0)],
    ["accounts", JSON.stringify({ income: acc.income || [], expense: acc.expense || [] })]
  ]);
}

function rowValues_(en, receipt) {
  const box = encVal_(receipt);
  const c1 = box.slice(0, RECEIPT_CHUNK);
  const c2 = box.slice(RECEIPT_CHUNK, RECEIPT_CHUNK * 2);
  return [String(en.id), String(en.date || ""), String(en.type || "income"), encVal_(en.cat),
    encVal_(en.memo), encVal_(en.pay), encVal_(Math.round(Number(en.amount) || 0)),
    encVal_(en.author), c1, Number(en.updatedAt) || Date.now(), en.deleted === true, c2, box.slice(RECEIPT_CHUNK * 2)];
}

/* ---------- 시트 저장 값 암호화 ---------- */
function dataKey_() {
  const props = PropertiesService.getScriptProperties();
  let k = DATA_KEY_CACHE_ || props.getProperty("LEDGER_ENC_KEY"); DATA_KEY_CACHE_ = k;
  if (!k) {
    const b = [];
    for (let i = 0; i < 32; i++) { b.push(Math.floor(Math.random() * 256)); }
    k = Utilities.base64Encode(b);
    props.setProperty("LEDGER_ENC_KEY", k);
  }
  return k;
}
function encVal_(v) {
  const s = String(v === null || v === undefined ? "" : v);
  if (!s) { return ""; }
  if (isEnc_(s)) { return s; }
  return encStr_(s, dataKey_());
}
function decVal_(v) {
  const s = String(v === null || v === undefined ? "" : v);
  if (!isEnc_(s)) { return s; }
  const out = decStr_(s, dataKey_());
  return out === "" ? "" : out;
}

function findRow_(list, id) {
  for (let i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
  return null;
}

function saveEntry_(t, en, auth) {
  const id = String((en && en.id) || "").trim();
  if (!id) { return { ok: false, error: "id가 없습니다" }; }
  let receipt = String(en.receiptData || "");
  let warning = "";
  if (receipt.length > RECEIPT_MAX) { receipt = ""; warning = "영수증 사진이 너무 커서 첨부 없이 저장했습니다"; }
  if (!String(en.author || "").trim() && auth) { en.author = auth.name; }
  const vals = rowValues_(en, receipt);
  const list = readEntries_(t.entries);
  const found = findRow_(list, id);
  let created = false;
  if (found) {
    // 2026-11-28: rowValues_ 는 영수증 이어붙임 열까지 13열입니다. 범위도 WIDTH(13)로 써야 합니다.
    t.entries.getRange(found.row, 1, 1, WIDTH).setValues([vals]);
  } else {
    t.entries.appendRow(vals);
    created = true;
  }
  const saved = { id: id, date: String(en.date || ""), type: String(en.type || "income"), cat: String(en.cat || ""),
    memo: String(en.memo || ""), pay: String(en.pay || ""), amount: Math.round(Number(en.amount) || 0),
    author: String(en.author || ""), receiptData: receipt, updatedAt: Number(vals[9]) || 0, deleted: en.deleted === true };
  return { ok: true, entry: saved, created: created, warning: warning, count: list.length + (created ? 1 : 0) };
}

function saveSettings_(t, st) {
  writeSettings_(t.settings, st || {});
  return { ok: true, settings: readSettings_(t.settings) };
}

function bulkImport_(t, body, auth) {
  const list = body.entries || body.items || [];
  const map = {};
  const known = readEntries_(t.entries);
  for (let i = 0; i < known.length; i++) { map[known[i].id] = known[i]; }
  const add = [];
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const en = list[i];
    const id = String((en && en.id) || "").trim();
    if (!id) { continue; }
    let receipt = String(en.receiptData || "");
    if (receipt.length > RECEIPT_MAX) { receipt = ""; }
    if (!String(en.author || "").trim() && auth) { en.author = auth.name; }
    const vals = rowValues_(en, receipt);
    const have = map[id];
    if (!have) {
      add.push(vals);
      map[id] = { id: id };
    } else if (Number(en.updatedAt) > Number(have.updatedAt) || !have.row) {
      if (have && have.row) { t.entries.getRange(have.row, 1, 1, WIDTH).setValues([vals]); }
      updated++;
    } else {
      skipped++;
    }
  }
  if (add.length) {
    t.entries.getRange(t.entries.getLastRow() + 1, 1, add.length, WIDTH).setValues(add);
  }
  if (body.settings) { writeSettings_(t.settings, body.settings); }
  return { ok: true, added: add.length, updated: updated, skipped: skipped, settings: readSettings_(t.settings) };
}

function resetAll_(t) {
  const lr = t.entries.getLastRow();
  if (lr > 1) { t.entries.getRange(2, 1, lr - 1, WIDTH).clearContent(); }
  writeSettings_(t.settings, { org: "", author: "", base: 0, accounts: { income: [], expense: [] } });
  return { ok: true, cleared: Math.max(0, lr - 1) };
}

function syncAll_(t) {
  const list = readEntries_(t.entries);
  const live = [];
  for (let i = 0; i < list.length; i++) {
    const en = list[i];
    delete en.row;
    live.push(en);
  }
  return { ok: true, entries: live, settings: readSettings_(t.settings), count: live.length };
}

/* ============================================================
   관리자용: 시트를 직접 열었을 때 쓰는 도우미 (선택)
   - 스프레드시트 메뉴에서 실행해 관리자 비밀번호를 되돌릴 수 있습니다.
   ============================================================ */
function resetAdminPassword() {
  const t = ensureTabs_(getSpreadsheet_());
  const u = findUser_(t, ADMIN_ID);
  const salt = newSalt_();
  if (!u) {
    t.users.appendRow([ADMIN_ID, "관리자", "admin", salt, hashPw_(salt, ADMIN_INIT_PW), true, Date.now(), Date.now()]);
  } else {
    u.salt = salt;
    u.pwHash = hashPw_(salt, ADMIN_INIT_PW);
    u.active = true;
    u.role = "admin";
    u.updatedAt = Date.now();
    writeUser_(t, u);
    deleteSessionsOf_(t, ADMIN_ID);
  }
  return "admin / " + ADMIN_INIT_PW;
}

/* ============================================================
   시트 저장 값 암호화 (AES-256-GCM, 순수 JS)
   · 키는 스크립트 속성에만 있고 HTML/JS 소스에는 없습니다.
   · 옛 평문 값은 그대로 읽습니다(하위 호환).
   ============================================================ */
/* Apps Script 에는 btoa/atob 가 없어 Utilities.base64 로 대신한다 */
function btoa(s){
  var b = [];
  for (var i = 0; i < s.length; i++){ var c = s.charCodeAt(i); b.push(c > 127 ? c - 256 : c); }
  return Utilities.base64Encode(b);
}
function atob(s){
  var a = Utilities.base64Decode(String(s)), o = '';
  for (var i = 0; i < a.length; i++) o += String.fromCharCode((a[i] + 256) % 256);
  return o;
}

/* AES-256-GCM (순수 JS) — Apps Script 에는 암호 API 가 없어 직접 넣는다.
   · 키 32바이트, IV 12바이트, 태그 16바이트 (WebCrypto AES-GCM 과 같은 규격)
   · encStr_ / decStr_ 로 시트 칸 값을 감싼다
   · Node.js WebCrypto 결과와 대조해 검증했다 (scripts/test_aesgcm.js) */

var AES_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aesXtime_(b){ return ((b << 1) ^ ((b & 0x80) ? 0x1b : 0)) & 0xff; }
function aesMul_(a, b){
  var r = 0;
  while (b){ if (b & 1) r ^= a; a = aesXtime_(a); b >>= 1; }
  return r & 0xff;
}
function aesExpandKey_(key){
  var w = [], i, t0, t1, t2, t3, tmp;
  for (i = 0; i < 8; i++) w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
  for (i = 8; i < 60; i++){
    t0 = w[i-1][0]; t1 = w[i-1][1]; t2 = w[i-1][2]; t3 = w[i-1][3];
    if (i % 8 === 0){
      tmp = t0;
      t0 = AES_SBOX[t1] ^ AES_RCON[(i/8) - 1]; t1 = AES_SBOX[t2]; t2 = AES_SBOX[t3]; t3 = AES_SBOX[tmp];
    } else if (i % 8 === 4){
      t0 = AES_SBOX[t0]; t1 = AES_SBOX[t1]; t2 = AES_SBOX[t2]; t3 = AES_SBOX[t3];
    }
    w[i] = [(w[i-8][0]^t0)&0xff, (w[i-8][1]^t1)&0xff, (w[i-8][2]^t2)&0xff, (w[i-8][3]^t3)&0xff];
  }
  return w;
}
function aesAddKey_(s, w, round){
  for (var c = 0; c < 4; c++){
    var k = w[round*4 + c];
    s[4*c] ^= k[0]; s[4*c+1] ^= k[1]; s[4*c+2] ^= k[2]; s[4*c+3] ^= k[3];
  }
}
function aesSub_(s){ for (var i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]]; }
function aesShift_(s){
  var t;
  t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[3]; s[3] = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = t;
}
function aesMix_(s){
  for (var c = 0; c < 4; c++){
    var i = 4*c, a0 = s[i], a1 = s[i+1], a2 = s[i+2], a3 = s[i+3];
    s[i]   = aesMul_(a0,2) ^ aesMul_(a1,3) ^ a2 ^ a3;
    s[i+1] = a0 ^ aesMul_(a1,2) ^ aesMul_(a2,3) ^ a3;
    s[i+2] = a0 ^ a1 ^ aesMul_(a2,2) ^ aesMul_(a3,3);
    s[i+3] = aesMul_(a0,3) ^ a1 ^ a2 ^ aesMul_(a3,2);
  }
}
function aesEncBlock_(w, block){
  var s = block.slice(0, 16);
  aesAddKey_(s, w, 0);
  for (var r = 1; r <= 13; r++){ aesSub_(s); aesShift_(s); aesMix_(s); aesAddKey_(s, w, r); }
  aesSub_(s); aesShift_(s); aesAddKey_(s, w, 14);
  return s;
}
/* GF(2^128) 곱 — 4워드(128비트) 피연산자 */
function aesGfMul_(x, y){
  var z0 = 0, z1 = 0, z2 = 0, z3 = 0;
  var v0 = x[0]>>>0, v1 = x[1]>>>0, v2 = x[2]>>>0, v3 = x[3]>>>0;
  for (var i = 0; i < 128; i++){
    var bit = (y[i >> 5] >>> (31 - (i & 31))) & 1;
    if (bit){ z0 ^= v0; z1 ^= v1; z2 ^= v2; z3 ^= v3; }
    var lsb = v3 & 1;
    v3 = (v3 >>> 1) | ((v2 & 1) << 31);
    v2 = (v2 >>> 1) | ((v1 & 1) << 31);
    v1 = (v1 >>> 1) | ((v0 & 1) << 31);
    v0 = v0 >>> 1;
    if (lsb) v0 ^= 0xe1000000;
  }
  return [z0>>>0, z1>>>0, z2>>>0, z3>>>0];
}
function aesBytesToWords_(b, off){
  return [
    ((b[off]<<24) | (b[off+1]<<16) | (b[off+2]<<8) | b[off+3])>>>0,
    ((b[off+4]<<24) | (b[off+5]<<16) | (b[off+6]<<8) | b[off+7])>>>0,
    ((b[off+8]<<24) | (b[off+9]<<16) | (b[off+10]<<8) | b[off+11])>>>0,
    ((b[off+12]<<24) | (b[off+13]<<16) | (b[off+14]<<8) | b[off+15])>>>0
  ];
}
function aesWordsToBytes_(w){
  var o = [];
  for (var i = 0; i < 4; i++) o.push((w[i]>>>24)&0xff, (w[i]>>>16)&0xff, (w[i]>>>8)&0xff, w[i]&0xff);
  return o;
}
function aesGhash_(h, aad, ct){
  var y = [0,0,0,0];
  function run(bytes, count){
    var i = 0;
    for (; i + 16 <= count; i += 16){
      var b = aesBytesToWords_(bytes, i);
      y = aesGfMul_([(y[0]^b[0])>>>0, (y[1]^b[1])>>>0, (y[2]^b[2])>>>0, (y[3]^b[3])>>>0], h);
    }
    if (i < count){
      var last = [];
      for (var j = 0; j < 16; j++) last.push(i + j < count ? bytes[i+j] : 0);
      var b2 = aesBytesToWords_(last, 0);
      y = aesGfMul_([(y[0]^b2[0])>>>0, (y[1]^b2[1])>>>0, (y[2]^b2[2])>>>0, (y[3]^b2[3])>>>0], h);
    }
  }
  run(aad, aad.length);
  run(ct, ct.length);
  var la = aad.length * 8, lc = ct.length * 8;
  /* 길이 블록: 64비트 len(A) || 64비트 len(C) (빅엔디언) */
  var lenBlock = [
    0, 0, 0, 0,
    (la>>>24)&0xff, (la>>>16)&0xff, (la>>>8)&0xff, la&0xff,
    0, 0, 0, 0,
    (lc>>>24)&0xff, (lc>>>16)&0xff, (lc>>>8)&0xff, lc&0xff
  ];
  var lb = aesBytesToWords_(lenBlock, 0);
  y = aesGfMul_([(y[0]^lb[0])>>>0, (y[1]^lb[1])>>>0, (y[2]^lb[2])>>>0, (y[3]^lb[3])>>>0], h);
  return aesWordsToBytes_(y);
}
function aesUtf8_(str){
  var out = [], i, c, c2;
  for (i = 0; i < str.length; i++){
    c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      c2 = str.charCodeAt(++i);
      var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return out;
}
function aesFromUtf8_(bytes){
  var s = '', i = 0, c;
  while (i < bytes.length){
    c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 63));
    else if (c < 0xf0) s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else {
      var cp = ((c & 0x07) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}
function aesB64_(bytes){
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function aesUnb64_(str){
  var bin = atob(str), o = [];
  for (var i = 0; i < bin.length; i++) o.push(bin.charCodeAt(i));
  return o;
}

/* key 32바이트 · iv 12바이트 → {ct, tag} */
function aesGcmSeal_(key, iv, pt){
  var w = aesExpandKey_(key);
  var h = aesBytesToWords_(aesEncBlock_(w, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), 0);
  var j0 = iv.concat([0,0,0,1]);
  var ct = [], i, counter = 2;
  for (i = 0; i < pt.length; i += 16){
    var cb = j0.slice(0, 12).concat([(counter>>>24)&0xff, (counter>>>16)&0xff, (counter>>>8)&0xff, counter&0xff]);
    var ks = aesEncBlock_(w, cb);
    for (var j = 0; j < 16 && i + j < pt.length; j++) ct.push(pt[i+j] ^ ks[j]);
    counter++;
  }
  var s = aesGhash_(h, [], ct);
  var ek = aesEncBlock_(w, j0);
  var tag = [];
  for (i = 0; i < 16; i++) tag.push(s[i] ^ ek[i]);
  return { ct: ct, tag: tag };
}

/* → 평문 배열 (태그가 맞지 않으면 null) */
function aesGcmOpen_(key, iv, ct, tag){
  var w = aesExpandKey_(key);
  var h = aesBytesToWords_(aesEncBlock_(w, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), 0);
  var s = aesGhash_(h, [], ct);
  var j0 = iv.concat([0,0,0,1]);
  var ek = aesEncBlock_(w, j0);
  for (var i = 0; i < 16; i++){ if ((s[i] ^ ek[i]) !== tag[i]) return null; }
  var pt = [], counter = 2;
  for (i = 0; i < ct.length; i += 16){
    var cb = j0.slice(0, 12).concat([(counter>>>24)&0xff, (counter>>>16)&0xff, (counter>>>8)&0xff, counter&0xff]);
    var ks = aesEncBlock_(w, cb);
    for (var j = 0; j < 16 && i + j < ct.length; j++) pt.push(ct[i+j] ^ ks[j]);
    counter++;
  }
  return pt;
}

/* ===== 저장 형식 도우미 (시트 칸 값 감싸기) ===== */
var ENC_PREFIX = 'enc1:';

function encStr_(plain, keyB64){
  if (plain === null || plain === undefined || plain === '') return '';
  var key = aesUnb64_(keyB64);
  var seed = String(Math.random()) + '|' + String(Date.now()) + '|' + String(plain.length);
  var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  var iv = [];
  for (var i = 0; i < 12; i++) iv.push((dig[i] + 256) % 256);
  var sealed = aesGcmSeal_(key, iv, aesUtf8_(String(plain)));
  return ENC_PREFIX + aesB64_(iv) + ':' + aesB64_(sealed.ct.concat(sealed.tag));
}

function decStr_(v, keyB64){
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.indexOf(ENC_PREFIX) !== 0) return s;          /* 옛 평문은 그대로 */
  try {
    var parts = s.slice(ENC_PREFIX.length).split(':');
    var iv = aesUnb64_(parts[0]);
    var all = aesUnb64_(parts[1]);
    var pt = aesGcmOpen_(aesUnb64_(keyB64), iv, all.slice(0, all.length - 16), all.slice(all.length - 16));
    return pt ? aesFromUtf8_(pt) : '';
  } catch (e){
    return '';
  }
}

function isEnc_(v){ return String(v === null || v === undefined ? '' : v).indexOf(ENC_PREFIX) === 0; }

/* ============================================================
   보안: 감사 로그 · 자동 백업 · 시트 암호화 마이그레이션
   ============================================================ */
const AUDIT_ACTIONS = { save_entry: 1, save_settings: 1, bulk_import: 1, reset_all: 1, encrypt_all: 1 };

function clientOf_(body, p) {
  return String((body && (body.ua || body.device)) || (p && (p.ua || p.device)) || "").slice(0, 90);
}

function auditNote_(action, out) {
  if (action === "save_entry") { return (out.created ? "새 기록" : "수정") + " " + (out.entry ? out.entry.id : ""); }
  if (action === "reset_all") { return "지운 기록 " + out.cleared; }
  if (action === "bulk_import") { return "추가 " + out.added + " · 수정 " + out.updated; }
  if (action === "encrypt_all") { return "암호화 " + out.encrypted + "건"; }
  return "";
}

function auditSheet_(ss) {
  let sh = ss.getSheetByName(SEC_LOG);
  if (!sh) {
    sh = ss.insertSheet(SEC_LOG);
    sh.appendRow(["시각", "아이디", "작업", "결과", "기기", "비고"]);
    sh.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e7f4ec");
    sh.setFrozenRows(1);
  }
  return sh;
}

function audit_(ss, id, action, result, req, note) {
  try {
    const sh = auditSheet_(ss);
    sh.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      String(id || ""), String(action || ""), String(result || ""),
      String(req || "").slice(0, 90), String(note || "").slice(0, 200)
    ]);
    const extra = sh.getLastRow() - 1 - SEC_LOG_MAX;
    if (extra > 0) { sh.deleteRows(2, extra); }
  } catch (e) { }
}

function backupIfDue_(ss) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty("LAST_BACKUP") || 0);
  if (Date.now() - last < 24 * 3600 * 1000) { return false; }
  doBackup_(ss);
  props.setProperty("LAST_BACKUP", String(Date.now()));
  return true;
}

function doBackup_(ss) {
  let sh = ss.getSheetByName(BACKUP_TAB);
  if (!sh) {
    sh = ss.insertSheet(BACKUP_TAB);
    sh.getRange(1, 1, 1, 4).setValues([["시각", "탭", "조각", "데이터"]]);
    sh.setFrozenRows(1);
    sh.getRange("A:D").setNumberFormat("@");
  }
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const names = [SHEET_ENTRIES, SHEET_SETTINGS, SHEET_USERS];
  const rows = [];
  for (let n = 0; n < names.length; n++) {
    const s = ss.getSheetByName(names[n]);
    if (!s) { continue; }
    const lr = s.getLastRow();
    if (lr < 1) { continue; }
    const vals = s.getRange(1, 1, lr, Math.max(1, s.getLastColumn())).getValues();
    const json = JSON.stringify(vals);
    for (let i = 0; i < json.length; i += 45000) {
      rows.push([stamp, names[n], Math.floor(i / 45000), json.substr(i, 45000)]);
    }
  }
  if (rows.length) { sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows); }

  // 오래된 스냅샷 정리 (최근 BACKUP_DAYS 일치만 남김)
  const total = sh.getLastRow() - 1;
  if (total <= 0) { return; }
  const all = sh.getRange(2, 1, total, 4).getValues();
  const stamps = {};
  for (let i = 0; i < all.length; i++) { stamps[String(all[i][0])] = 1; }
  const list = Object.keys(stamps).sort();
  if (list.length <= BACKUP_DAYS) { return; }
  const drop = {};
  for (let i = 0; i < list.length - BACKUP_DAYS; i++) { drop[list[i]] = 1; }
  const keep = [];
  for (let i = 0; i < all.length; i++) { if (!drop[String(all[i][0])]) { keep.push(all[i]); } }
  sh.getRange(2, 1, total, 4).clearContent();
  if (keep.length) { sh.getRange(2, 1, keep.length, 4).setValues(keep); }
}

/* 지금까지 평문으로 저장된 거래를 한 번에 암호화합니다 (관리자, 내용은 그대로). */
function encryptAll_(t, auth, body) {
  const before = readEntries_(t.entries);
  const lr = t.entries.getLastRow();
  if (lr < 2) { return { ok: true, rows: 0, encrypted: 0, message: "암호화할 거래가 없습니다" }; }
  doBackup_(t.ss);
  const rows = t.entries.getRange(2, 1, lr - 1, WIDTH).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] == null ? "" : r[0]);
    if (!id) { out.push(r); continue; }
    const box = encVal_(decVal_(String(r[8] == null ? "" : r[8]) + String(r[11] == null ? "" : r[11]) + String(r[12] == null ? "" : r[12])));
    out.push([
      id, r[1], String(r[2] || "income"),
      encVal_(decVal_(r[3])), encVal_(decVal_(r[4])), encVal_(decVal_(r[5])),
      encVal_(String(Math.round(Number(decVal_(r[6])) || 0))),
      encVal_(decVal_(r[7])), box.slice(0, RECEIPT_CHUNK),
      Number(r[9]) || Date.now(), r[10] === true,
      box.slice(RECEIPT_CHUNK, RECEIPT_CHUNK * 2), box.slice(RECEIPT_CHUNK * 2)
    ]);
  }
  t.entries.getRange(2, 1, rows.length, WIDTH).setValues(out);
  const after = readEntries_(t.entries);
  const sig = function (list) {
    return list.map(function (e) {
      return [e.id, e.date, e.type, e.cat, e.memo, e.pay, e.amount, e.author, e.receiptData, e.updatedAt, e.deleted].join("\u0001");
    }).join("\u0002");
  };
  const same = before.length === after.length && sig(before) === sig(after);
  audit_(t.ss, auth.id, "encrypt_all", same ? "성공" : "검증 실패", clientOf_(body, {}), before.length + "건");
  if (!same) {
    return { ok: false, error: "verify_failed", message: "암호화 뒤 내용 검증이 맞지 않습니다. `백업` 탭 사본을 확인해 주세요." };
  }
  return { ok: true, rows: after.length, encrypted: after.length, message: "거래 " + after.length + "건을 암호화했습니다" };
}


/* ============================================================
   포털 계정 문서(중보기도문 동기화 시트의 portal-acct 슬롯) 읽기·쓰기
   · 포털 로그인 뒤(토큰 있음)에만 동작합니다.
   ============================================================ */
const PORTAL_SHEET_ID = "1P6wks9j0c7sBrHM2_qsAhgLMQyZNoSR6_yKMxqt0gnQ";
const PORTAL_TAB = "동기화";
const PORTAL_SLOT = "portal-acct";

function portalSheet_() {
  const ss = SpreadsheetApp.openById(PORTAL_SHEET_ID);
  let sh = ss.getSheetByName(PORTAL_TAB);
  if (!sh) { throw new Error("중보기도문 시트에 동기화 탭이 없습니다"); }
  return sh;
}

function portalDoc_(action, body) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_MS); } catch (e) { }
  try {
    const sh = portalSheet_();
    const lr = sh.getLastRow();
    const all = lr < 2 ? [] : sh.getRange(2, 1, lr - 1, 8).getValues();
    const others = [];
    const mine = [];
    for (let i = 0; i < all.length; i++) {
      const slot = String(all[i][0] || "");
      if (slot === PORTAL_SLOT) { mine.push(all[i]); } else if (slot) { others.push(all[i]); }
    }
    if (action === "portal_get") {
      const map = {};
      for (let i = 0; i < mine.length; i++) {
        const key = String(mine[i][1] || "");
        if (!map[key]) { map[key] = { key: key, idx: [], updatedAt: 0 }; }
        map[key].idx.push({ i: Number(mine[i][2]) || 0, d: String(mine[i][3] || "") });
        map[key].updatedAt = Math.max(map[key].updatedAt, Number(mine[i][4]) || 0);
      }
      const rows = Object.keys(map).map(function (k) {
        const g = map[k];
        g.idx.sort(function (a, b) { return a.i - b.i; });
        return { key: k, data: g.idx.map(function (x) { return x.d; }).join(""), updatedAt: g.updatedAt };
      });
      return { ok: true, rows: rows };
    }
    const rows = (body && body.rows) || [];
    if (!rows.length) { return { ok: false, error: "empty", message: "보낼 자료가 없습니다" }; }
    const now = Date.now();
    const keep = others.slice();
    for (let r = 0; r < rows.length; r++) {
      const data = String(rows[r].data || "");
      const key = String(rows[r].key || "main");
      const chunks = Math.max(1, Math.ceil(data.length / 45000));
      if (chunks > 80) { return { ok: false, error: "too_big", message: "자료가 너무 큽니다" }; }
      for (let c = 0; c < chunks; c++) {
        keep.push([PORTAL_SLOT, key, c, data.substr(c * 45000, 45000),
          Number(rows[r].updatedAt) || now, now, String((body && body.device) || "").slice(0, 60), data.length]);
      }
    }
    sh.clearContents();
    sh.getRange(1, 1, 1, 8).setValues([["slot", "key", "idx", "data", "updatedAt", "savedAt", "device", "bytes"]]);
    if (keep.length) { sh.getRange(2, 1, keep.length, 8).setValues(keep); }
    return { ok: true, saved: keep.length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}
