/* 교회 금전출납부 · 공유 데이터 API (Google Apps Script 웹앱)
   스프레드시트 「교회 금전출납부 (공유 데이터)」에 붙여 배포한 서버 코드입니다.
   action=sync_all / save_entry / save_settings / bulk_import / reset_all 을 처리합니다. */

const SHEET_ENTRIES = "거래내역";
const SHEET_SETTINGS = "설정";
const SHEET_ID = "1PLtsH2E1CkALiP8xHLs73hfpouqL01iCrrqO-uqz8lg";
const HEAD = ["id", "date", "type", "cat", "memo", "pay", "amount", "author", "receiptData", "updatedAt", "deleted"];
const LOCK_MS = 25000;
const RECEIPT_MAX = 49000;

function doGet(e) {
  const p = (e && e.parameter) || {};
  return handle(p.action || "sync_all", {}, p);
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
    if (action === "save_entry") { out = saveEntry_(t, body.entry || body); }
    else if (action === "save_settings") { out = saveSettings_(t, body.settings || body); }
    else if (action === "bulk_import") { out = bulkImport_(t, body); }
    else if (action === "reset_all") { out = resetAll_(t); }
    else { out = syncAll_(t); }
    out.ok = true;
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
  return { ss: ss, entries: e, settings: s };
}

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

function saveEntry_(t, en) {
  const id = String((en && en.id) || "").trim();
  if (!id) { return { ok: false, error: "id가 없습니다" }; }
  let receipt = String(en.receiptData || "");
  let warning = "";
  if (receipt.length > RECEIPT_MAX) { receipt = ""; warning = "영수증 사진이 너무 커서 첨부 없이 저장했습니다"; }
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

function bulkImport_(t, body) {
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
