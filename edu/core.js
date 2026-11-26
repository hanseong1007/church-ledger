/* 덕신교회 부서업무 — 공통 기반 (암호화 · 계정 · 구글 시트 동기화)
   - 모든 업무 자료는 브라우저에서 AES-256-GCM 으로 암호화한 뒤에만 시트로 나갑니다.
   - 자료 열쇠(DEK)는 계정마다 '비밀번호에서 뽑은 열쇠(KEK)'로 감싸(wrap) 보관합니다.
     처음 관리자 계정을 만들 때 생긴 열쇠가 원본이고, 사용자를 추가하면 같은 열쇠를
     그 사용자의 비밀번호로 다시 감싸 두므로, 각자 자기 비밀번호만으로 바로 동기화됩니다.
*/
'use strict';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function b64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}
function b64d(s) {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexOf(buf) {
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

const Crypto = {
  ITER: 150000,
  async sha256(str) { return hexOf(await crypto.subtle.digest('SHA-256', ENC.encode(String(str)))); },
  async kek(password, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', ENC.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64d(saltB64), iterations: iter || this.ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async newDek() { return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); },
  async rawDek(dek) { return new Uint8Array(await crypto.subtle.exportKey('raw', dek)); },
  async importDek(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); },
  async seal(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes));
    return { iv: b64(iv), ct: b64(ct) };
  },
  async open(key, pack) {
    if (!pack || !pack.iv || !pack.ct) throw new Error('bad_pack');
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(pack.iv) }, key, b64d(pack.ct)));
  },
  async sealJson(key, obj) { return this.seal(key, ENC.encode(JSON.stringify(obj))); },
  async openJson(key, pack) { return JSON.parse(DEC.decode(await this.open(key, pack))); },
  randB64(n) { return b64(crypto.getRandomValues(new Uint8Array(n || 16))); },
  uid() { return hexOf(crypto.getRandomValues(new Uint8Array(8))); }
};

/* ---------------- 구글 시트 동기화 API ---------------- */
const Api = {
  url: (window.__EDU_SYNC_URL__ || '').trim(),
  on() { return /^https:\/\/script\.google\.com\//.test(this.url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(this.url); },
  async call(payload, ms) {
    if (!this.on()) throw new Error('sync_off');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 15000);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        cache: 'no-store',
        signal: ctl.signal
      });
      if (!res.ok) throw new Error('네트워크 오류 ' + res.status);
      const txt = await res.text();
      let json;
      try { json = JSON.parse(txt); } catch (e) { throw new Error('응답을 읽을 수 없습니다'); }
      return json;
    } finally { clearTimeout(timer); }
  }
};

/* ---------------- 기본 틀 ---------------- */
const DEFAULT_ROLES = [
  { key: 'admin', label: '관리자', emoji: '🛡️', base: 'admin', u: 1 },
  { key: 'pastor', label: '목회자', emoji: '🕊️', base: 'pastor', u: 1 },
  { key: 'edu', label: '교육부서담당', emoji: '📋', base: 'edu', u: 1 },
  { key: 'teacher', label: '교사', emoji: '🍎', base: 'teacher', u: 1 },
  { key: 'parent', label: '학부모', emoji: '👨‍👩‍👧', base: 'parent', u: 1 }
];

const BASE_PERMS = {
  admin: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'report.review': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'schedule.manage': 1, 'user.manage': 1, 'dept.manage': 1 },
  pastor: { 'attendance.stat': 1, 'report.review': 1, 'notice.read': 1, 'feed.write': 1 },
  edu: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'schedule.manage': 1 },
  teacher: { 'attendance.check': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1 },
  parent: { 'attendance.self': 1, 'notice.read': 1, 'feed.read': 1 }
};

const PERM_LABELS = [
  ['attendance.check', '출석 체크'],
  ['attendance.stat', '부서 전체 출석 현황'],
  ['attendance.self', '자녀 출석 조회'],
  ['report.write', '주일보고 작성·제출'],
  ['report.review', '주일보고 확인(목회자)'],
  ['notice.write', '알림장 작성'],
  ['notice.read', '알림장 보기·확인'],
  ['feed.write', '피드 작성'],
  ['feed.read', '피드 보기'],
  ['member.manage', '반·학생 관리'],
  ['schedule.manage', '일정 관리'],
  ['user.manage', '사용자 관리'],
  ['dept.manage', '부서 관리']
];

const DEFAULT_DEPTS = [
  { id: 'dept-nursery', name: '유아부', emoji: '🌱', color: '#ffb4a2', note: '', order: 1, active: true, u: 1 },
  { id: 'dept-kids', name: '유치부', emoji: '🌿', color: '#ffd6a5', note: '', order: 2, active: true, u: 1 },
  { id: 'dept-elem', name: '초등부', emoji: '🌳', color: '#a8d8b9', note: '', order: 3, active: true, u: 1 },
  { id: 'dept-teen', name: '중등부', emoji: '🌲', color: '#b8c8ee', note: '', order: 4, active: true, u: 1 }
];

function emptyState(seed) {
  return {
    v: 2,
    roles: seed === false ? [] : JSON.parse(JSON.stringify(DEFAULT_ROLES)),
    departments: seed === false ? [] : JSON.parse(JSON.stringify(DEFAULT_DEPTS)),
    classes: [], students: [], attendance: [], reports: [], notices: [], feeds: [], events: [],
    people: {},
    settings: { church: '덕신교회', title: '부서업무', updatedAt: 0 },
    rev: 0
  };
}

const COLLS = ['roles', 'departments', 'classes', 'students', 'attendance', 'reports', 'notices', 'feeds', 'events'];

/* ---------------- 앱 상태 ---------------- */
const S = {
  dek: null,
  rev: 0,
  state: emptyState(),
  me: null,             // {uid, id, name, roles:[], depts:[], classes:[], students:[]}
  chosen: [],           // 로그인 화면에서 고른 역할
  roleKey: '',
  dept: '',
  screen: 'home',
  sync: 'idle',         // idle | saving | saved | error | off
  syncMsg: '',
  ready: false,
  lastPull: 0
};

function normId(id) { return String(id || '').trim().toLowerCase(); }
async function uidOf(id) { return (await Crypto.sha256('deoksin-edu-account:' + normId(id))).slice(0, 32); }

/* ---------------- 계정 ---------------- */
async function buildAccount(dek, info) {
  const salt = Crypto.randB64(16);
  const kek = await Crypto.kek(info.password, salt);
  const wrap = await Crypto.seal(kek, await Crypto.rawDek(dek));
  const rec = await Crypto.sealJson(dek, {
    id: normId(info.id), name: String(info.name || '').trim() || normId(info.id),
    roles: info.roles || [], depts: info.depts || [], classes: info.classes || [],
    students: info.students || [], active: info.active !== false, at: Date.now()
  });
  return {
    uid: await uidOf(info.id), salt: salt,
    wrap: JSON.stringify(wrap), rec: JSON.stringify(rec),
    rev: Date.now(), updated: Date.now(), deleted: ''
  };
}

async function fetchAccount(uid) {
  const r = await Api.call({ action: 'acct_get', uid: uid }, 12000);
  if (!r.ok) throw new Error(r.message || r.error || '계정을 확인하지 못했습니다');
  return r.row || null;
}

async function listAccounts() {
  const r = await Api.call({ action: 'acct_list' }, 15000);
  if (!r.ok) throw new Error(r.message || '계정 목록을 가져오지 못했습니다');
  const out = [];
  for (const row of (r.rows || [])) {
    if (String(row.deleted) === '1') continue;
    let rec = null;
    try { rec = await Crypto.openJson(S.dek, JSON.parse(row.rec)); } catch (e) { rec = { id: '?', name: '(읽을 수 없음)', roles: [] }; }
    out.push({ uid: String(row.uid), salt: row.salt, wrap: row.wrap, rec: rec, updated: Number(row.updated) || 0 });
  }
  out.sort((a, b) => (a.rec.name || '').localeCompare(b.rec.name || '', 'ko'));
  return out;
}

async function saveAccountRow(row) {
  const r = await Api.call({ action: 'acct_save', row: row }, 15000);
  if (!r.ok) throw new Error(r.message || '계정을 저장하지 못했습니다');
  return r.row;
}
async function deleteAccountRow(uid) {
  const r = await Api.call({ action: 'acct_del', uid: uid }, 12000);
  if (!r.ok) throw new Error(r.message || '계정을 지우지 못했습니다');
  return r;
}

/* ---------------- 자료 암호문 ---------------- */
const CHUNK = 45000;
async function packState(state) {
  const sealed = await Crypto.sealJson(S.dek, state);
  const s = JSON.stringify(sealed);
  const chunks = [];
  for (let i = 0; i < s.length; i += CHUNK) chunks.push(s.slice(i, i + CHUNK));
  return chunks;
}
async function unpackState(chunks) {
  const sealed = JSON.parse((chunks || []).join(''));
  return await Crypto.openJson(S.dek, sealed);
}

/* ---------------- 병합 ---------------- */
function newer(a, b) { return (Number(a && a.u) || 0) >= (Number(b && b.u) || 0) ? a : b; }

function mergeState(local, remote) {
  if (!remote) return local;
  COLLS.forEach(key => {
    const map = new Map();
    (local[key] || []).forEach(it => { if (it && it.id) map.set(it.id, it); });
    (remote[key] || []).forEach(it => {
      if (!it || !it.id) return;
      const cur = map.get(it.id);
      if (!cur) { map.set(it.id, it); return; }
      let pick = newer(cur, it);
      if (key === 'notices') {
        const reads = Object.assign({}, (cur.reads || {}));
        Object.keys(it.reads || {}).forEach(uid => { reads[uid] = Math.min(Number(reads[uid]) || 9e15, Number(it.reads[uid]) || 9e15); });
        pick = Object.assign({}, pick, { reads: reads });
      }
      map.set(it.id, pick);
    });
    local[key] = Array.from(map.values());
  });
  local.people = Object.assign({}, remote.people || {}, local.people || {});
  const ls = local.settings || {}, rs = remote.settings || {};
  local.settings = (Number(rs.updatedAt) || 0) > (Number(ls.updatedAt) || 0) ? Object.assign({}, ls, rs) : Object.assign({}, rs, ls);
  // 부서에 없는 옛 역할 키가 있으면 기본값 유지
  if (!(local.roles || []).length) local.roles = JSON.parse(JSON.stringify(DEFAULT_ROLES));
  return local;
}

/* ---------------- 동기화 ---------------- */
const Sync = {
  busy: false,
  timer: null,
  async pull(quiet) {
    if (!Api.on() || !S.dek) return false;
    try {
      const r = await Api.call({ action: 'doc_pull' }, 15000);
      if (!r.ok) throw new Error(r.message || r.error || '불러오기 실패');
      if (!r.chunks || !r.chunks.length) { S.rev = r.rev || 0; if (!quiet) setSync('saved', '새 자료 없음'); return false; }
      if (Number(r.rev) <= Number(S.rev) && S.ready) { S.lastPull = Date.now(); return false; }
      const remote = await unpackState(r.chunks);
      mergeState(S.state, remote);
      S.state.rev = Number(r.rev) || S.state.rev;
      S.rev = Number(r.rev) || 0;
      S.lastPull = Date.now();
      S.ready = true;
      if (!quiet) setSync('saved', '불러옴');
      return true;
    } catch (e) {
      if (!quiet) setSync('error', '불러오기 실패');
      return false;
    }
  },
  async save() {
    if (!Api.on()) { setSync('off', '동기화 꺼짐'); return false; }
    if (!S.dek) return false;
    if (this.busy) { this.again = true; return false; }
    this.busy = true;
    setSync('saving', '저장 중…');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const chunks = await packState(S.state);
        const r = await Api.call({ action: 'doc_push', baseRev: S.rev, chunks: chunks, device: deviceName() }, 25000);
        if (r.ok) {
          S.rev = Number(r.rev) || S.rev;
          S.state.rev = S.rev;
          setSync('saved', '저장됨');
          this.busy = false;
          if (this.again) { this.again = false; setTimeout(() => this.save(), 300); }
          return true;
        }
        if (r.error === 'conflict') {
          if (r.chunks && r.chunks.length) {
            const remote = await unpackState(r.chunks);
            mergeState(S.state, remote);
          }
          S.rev = Number(r.rev) || S.rev;
          continue;
        }
        throw new Error(r.message || r.error || '저장 실패');
      }
      throw new Error('다른 기기와 계속 부딪혔습니다');
    } catch (e) {
      setSync('error', (e && e.message) || '저장 실패');
      this.busy = false;
      return false;
    }
  }
};

function deviceName() {
  const ua = navigator.userAgent || '';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Web';
}

function setSync(kind, msg) {
  S.sync = kind; S.syncMsg = msg || '';
  const el = document.getElementById('syncDot');
  if (el) {
    el.className = 'sync-dot ' + kind;
    el.title = msg || '';
    el.innerHTML = '<i></i><span>' + esc(msg || '') + '</span>';
  }
}

function touch(item) { item.u = Date.now(); return item; }

/* ---------------- 세션 ---------------- */
const SESS_KEY = 'dse.session.v1';

function saveSession() {
  try {
    sessionStorage.setItem(SESS_KEY, JSON.stringify({
      me: S.me, chosen: S.chosen, roleKey: S.roleKey, wk: b64(S.wkRaw), rev: S.rev, at: Date.now()
    }));
  } catch (e) { }
}
function clearSession() { try { sessionStorage.removeItem(SESS_KEY); } catch (e) { } }
async function restoreSession() {
  let raw = null;
  try { raw = sessionStorage.getItem(SESS_KEY); } catch (e) { }
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s.me || !s.wk) return false;
    S.wkRaw = b64d(s.wk);
    S.dek = await Crypto.importDek(S.wkRaw);
    S.me = s.me; S.chosen = s.chosen || []; S.roleKey = s.roleKey || (s.me.roles || [])[0];
    S.rev = Number(s.rev) || 0;
    return true;
  } catch (e) { return false; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 권한 ---------------- */
function roleDef(key) { return (S.state.roles || []).find(r => r.key === key) || DEFAULT_ROLES.find(r => r.key === key) || { key: key, label: key, emoji: '🙂', base: 'parent' }; }
function activeRole() { return roleDef(S.roleKey); }
function permsOf(key) {
  const r = roleDef(key);
  return BASE_PERMS[r.base] || {};
}
function can(perm) { return !!permsOf(S.roleKey)[perm]; }
function myRoleKeys() { return (S.me && S.me.roles) || []; }
function myRoleDefs() { return myRoleKeys().map(roleDef).filter(Boolean); }

function scopeDeptIds() {
  if (!S.me) return [];
  const base = roleDef(S.roleKey).base;
  if (permsOf(S.roleKey)['user.manage'] || base === 'pastor' || base === 'admin') return 'all';
  const list = (S.me.depts || []).slice();
  if (base === 'parent') {
    (S.me.students || []).forEach(sid => {
      const st = (S.state.students || []).find(x => x.id === sid);
      if (st && list.indexOf(st.deptId) < 0) list.push(st.deptId);
    });
  }
  if (!list.length) {
    // 지정된 부서가 없으면 담당 반의 부서를 쓴다
    (S.me.classes || []).forEach(cid => { const c = S.state.classes.find(x => x.id === cid); if (c && list.indexOf(c.deptId) < 0) list.push(c.deptId); });
  }
  return list;
}
function visibleDepts() {
  const sc = scopeDeptIds();
  const all = (S.state.departments || []).filter(d => !d._del && d.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (sc === 'all') return all;
  return all.filter(d => sc.indexOf(d.id) >= 0);
}
function deptById(id) { return (S.state.departments || []).find(d => d.id === id) || null; }
function classById(id) { return (S.state.classes || []).find(c => c.id === id) || null; }
function studentsOfDept(deptId) { return (S.state.students || []).filter(s => !s._del && s.active !== false && s.deptId === deptId); }
function studentsOfClass(classId) { return (S.state.students || []).filter(s => !s._del && s.active !== false && s.classId === classId); }
function classesOfDept(deptId) { return (S.state.classes || []).filter(c => !c._del && c.deptId === deptId).sort((a, b) => (a.order || 0) - (b.order || 0)); }
function peopleOf(uid) { return (S.state.people || {})[uid] || null; }
function nameOfUid(uid) { const p = peopleOf(uid); return p ? p.name : '(알 수 없음)'; }

/* 아이디로 사람 이름 찾기 (알림장 확인 명단용) */
function rememberMe() {
  if (!S.me) return;
  S.state.people = S.state.people || {};
  S.state.people[S.me.uid] = { name: S.me.name, id: S.me.id, roles: S.me.roles || [], depts: S.me.depts || [], classes: S.me.classes || [] };
}

/* ---------------- 날짜 ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseYmd(s) { const p = String(s || '').split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function weekdayKo(s) { return ['일', '월', '화', '수', '목', '금', '토'][parseYmd(s).getDay()]; }
function fmtDate(s) { const d = parseYmd(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + weekdayKo(s) + ')'; }
function fmtShort(s) { const d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate(); }
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return '방금';
  if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '일 전';
  const d = new Date(Number(ts));
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function lastSunday(from) {
  const d = from ? new Date(from) : new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return ymd(d);
}
