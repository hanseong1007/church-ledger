/* 교회 금전출납부 · 공유 데이터 API (Google Apps Script 웹앱)
   스프레드시트 「교회 금전출납부 (공유 데이터)」에 붙여 배포한 서버 코드입니다.

   ★ 로그인 보안판 (2026-11-22)
   - 계정은 `계정` 시트에 저장합니다 (id, name, role, salt, pwHash, active ...).
     비밀번호는 SHA-256(salt + ":" + 비밀번호) 해시로만 보관하고 원문은 저장하지 않습니다.
   - 로그인하면 세션 토큰을 발급하고 `세션` 시트에 보관합니다(30일, 사용하면 자동 연장).
   - 장부 데이터를 다루는 모든 action 은 토큰 또는 (아이디 + 비밀번호 해시) 없이는
     { ok:false, error:"unauthorized" } 만 돌려줍니다. 시트는 그대로 잠겨 있습니다.

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
const USER_HEAD = ["id", "name", "role", "salt", "pwHash", "active", "createdAt", "updatedAt"];
const SESS_HEAD = ["token", "id", "pwHash", "createdAt", "expiresAt"];

const LOCK_MS = 25000;
const RECEIPT_MAX = 49000;
const SESSION_DAYS = 30;
const SESSION_RENEW_DAYS = 20;   // 남은 기간이 이보다 짧으면 사용할 때 연장
const ADMIN_ID = "admin";
const ADMIN_INIT_PW = "admin1234";
const MIN_PW = 6;
const MAX_FAILS = 8;             // 10분 안에 이만큼 틀리면 잠시 막음

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

    if (action === "login") {
      out = login_(t, body, p);
    } else if (action === "logout") {
      out = logout_(t, body, p);
    } else {
      const auth = authOf_(t, body, p);
      if (!auth) {
        out = { ok: false, error: "unauthorized", message: "로그인이 필요합니다" };
      } else if (action === "me") {
        out = { ok: true, user: { id: auth.id, name: auth.name, role: auth.role } };
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
        out = resetAll_(t);
      } else {
        out = syncAll_(t);
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
    ADMIN_ID, "관리자", "admin", salt, hashPw_(salt, ADMIN_INIT_PW), true, Date.now(), Date.now()
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
    u.id, u.name, u.role, u.salt, u.pwHash, u.active, u.createdAt, u.updatedAt
  ]]);
}

function publicUser_(u) {
  return { id: u.id, name: u.name, role: u.role, active: !!u.active, createdAt: u.createdAt, updatedAt: u.updatedAt };
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
  if (token) {
    const list = readSessions_(t);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.token !== token) { continue; }
      if (!s.expiresAt || s.expiresAt < Date.now()) { return null; }
      const u = findUser_(t, s.id);
      if (!u || !u.active || u.pwHash !== s.pwHash) { return null; }   // 비밀번호가 바뀌면 기존 토큰 무효
      if (s.expiresAt - Date.now() < SESSION_RENEW_DAYS * 86400000) {
        const next = Date.now() + SESSION_DAYS * 86400000;
        t.sessions.getRange(s.row, 5).setValue(next);
        s.expiresAt = next;
        if (body && typeof body === "object") { body.tokenExpiresAt = next; }
      }
      return { id: u.id, name: u.name, role: u.role };
    }
  }
  const id = String((body && body.id) || (p && p.id) || "").trim();
  const key = String((body && (body.authKey || body.pwHash)) || (p && (p.authKey || p.pwHash)) || "").trim();
  if (id && key) {
    const u = findUser_(t, id);
    if (u && u.active && u.pwHash === key) { return { id: u.id, name: u.name, role: u.role }; }
  }
  return null;
}

function login_(t, body, p) {
  const id = String((body && body.id) || (p && p.id) || "").trim();
  const pw = String((body && (body.pw || body.password)) || (p && (p.pw || p.password)) || "");
  const givenKey = String((body && (body.authKey || body.pwHash)) || (p && (p.authKey || p.pwHash)) || "").trim();
  if (!id) { return { ok: false, error: "invalid_request", message: "아이디를 입력해 주세요" }; }

  const cache = CacheService.getScriptCache();
  const failKey = "lf:" + id;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) {
    return { ok: false, error: "too_many_attempts", message: "비밀번호를 여러 번 틀렸습니다. 10분 뒤에 다시 시도해 주세요." };
  }

  const u = findUser_(t, id);
  let key = givenKey;
  if (!key && pw && u) { key = hashPw_(u.salt, pw); }
  const good = !!u && !!u.active && !!key && !!u.pwHash && key === u.pwHash;

  if (!good) {
    cache.put(failKey, String(fails + 1), 600);
    const why = (!u) ? "아이디 또는 비밀번호가 맞지 않습니다."
      : (!u.active ? "사용이 중지된 계정입니다. 관리자에게 문의해 주세요." : "아이디 또는 비밀번호가 맞지 않습니다.");
    return { ok: false, error: "bad_credentials", message: why };
  }

  cache.remove(failKey);
  const token = newToken_();
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  appendSession_(t, { token: token, id: u.id, pwHash: u.pwHash, createdAt: Date.now(), expiresAt: expiresAt });
  purgeSessions_(t);
  return {
    ok: true,
    user: { id: u.id, name: u.name, role: u.role },
    token: token,
    authKey: u.pwHash,
    expiresAt: expiresAt
  };
}

function logout_(t, body, p) {
  const token = String((body && body.token) || (p && p.token) || "").trim();
  if (token) {
    const list = readSessions_(t);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].token === token) { t.sessions.deleteRow(list[i].row); }
    }
  }
  return { ok: true };
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
  const salt = newSalt_();
  u.salt = salt;
  u.pwHash = hashPw_(salt, newPw);
  u.updatedAt = Date.now();
  writeUser_(t, u);

  deleteSessionsOf_(t, u.id);            // 기존 기기 세션은 모두 해제
  const token = newToken_();
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  appendSession_(t, { token: token, id: u.id, pwHash: u.pwHash, createdAt: Date.now(), expiresAt: expiresAt });
  return {
    ok: true, user: { id: u.id, name: u.name, role: u.role },
    token: token, authKey: u.pwHash, expiresAt: expiresAt,
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
    t.users.appendRow([id, name || id, role, salt, hashPw_(salt, pw), true, Date.now(), Date.now()]);
    const made = findUser_(t, id);
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
    deleteSessionsOf_(t, found.id);      // 비밀번호를 바꾸면 그 계정의 기존 세션 해제
  } else if (pw) {
    return { ok: false, error: "weak_password", message: "비밀번호는 " + MIN_PW + "자 이상으로 정해 주세요" };
  }
  writeUser_(t, found);
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
  const rows = e.getRange(2, 1, lr - 1, HEAD.length).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] == null ? "" : r[0]);
    if (!id) { continue; }
    out.push({
      id: id,
      date: fmtDate_(r[1]),
      type: String(r[2] || "income"),
      cat: String(r[3] == null ? "" : r[3]),
      memo: String(r[4] == null ? "" : r[4]),
      pay: String(r[5] == null ? "" : r[5]),
      amount: Math.round(Number(r[6]) || 0),
      author: String(r[7] == null ? "" : r[7]),
      receiptData: String(r[8] == null ? "" : r[8]),
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
  return [String(en.id), String(en.date || ""), String(en.type || "income"), String(en.cat || ""),
    String(en.memo || ""), String(en.pay || ""), Math.round(Number(en.amount) || 0),
    String(en.author || ""), receipt, Number(en.updatedAt) || Date.now(), en.deleted === true];
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
    t.entries.getRange(found.row, 1, 1, HEAD.length).setValues([vals]);
  } else {
    t.entries.appendRow(vals);
    created = true;
  }
  const saved = { id: id, date: vals[1], type: vals[2], cat: vals[3], memo: vals[4], pay: vals[5],
    amount: vals[6], author: vals[7], receiptData: receipt, updatedAt: vals[9], deleted: vals[10] };
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
      if (have && have.row) { t.entries.getRange(have.row, 1, 1, HEAD.length).setValues([vals]); }
      updated++;
    } else {
      skipped++;
    }
  }
  if (add.length) {
    t.entries.getRange(t.entries.getLastRow() + 1, 1, add.length, HEAD.length).setValues(add);
  }
  if (body.settings) { writeSettings_(t.settings, body.settings); }
  return { ok: true, added: add.length, updated: updated, skipped: skipped, settings: readSettings_(t.settings) };
}

function resetAll_(t) {
  const lr = t.entries.getLastRow();
  if (lr > 1) { t.entries.getRange(2, 1, lr - 1, HEAD.length).clearContent(); }
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
