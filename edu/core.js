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
  admin: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'report.review': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'child.link': 1, 'staff.manage': 1, 'schedule.manage': 1, 'user.manage': 1, 'dept.manage': 1, 'plan.read': 1, 'plan.write': 1, 'ledger.manage': 1, 'user.approve': 1 },
  pastor: { 'attendance.stat': 1, 'report.write': 1, 'report.review': 1, 'notice.read': 1, 'notice.write': 1, 'feed.write': 1, 'plan.read': 1, 'ledger.manage': 1, 'user.approve': 1, 'schedule.manage': 1 },
  edu: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'child.link': 1, 'staff.manage': 1, 'schedule.manage': 1, 'plan.read': 1, 'plan.write': 1, 'ledger.manage': 1, 'user.approve': 1 },
  teacher: { 'attendance.check': 1, 'attendance.stat': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'child.link': 1, 'plan.read': 1, 'plan.write': 1, 'user.approve': 1 },
  parent: { 'attendance.self': 1, 'notice.read': 1, 'feed.read': 1 }
};

/* 역할 계층 — 가입 승인은 '바로 윗단계'가 합니다 (관리자 > 목회자 > 교육부서담당 > 교사 > 학부모) */
const ROLE_RANK = { admin: 5, pastor: 4, edu: 3, teacher: 2, parent: 1 };
function rankOfRoleKey(key) { return ROLE_RANK[roleDef(key).base] || 0; }
function rankOfKeys(keys) { return (keys || []).reduce((m, k) => Math.max(m, rankOfRoleKey(k)), 0); }
function myRank() { return rankOfKeys(S.me && S.me.roles); }

const PERM_LABELS = [
  ['attendance.check', '출석 체크'],
  ['attendance.stat', '출석 통계·현황'],
  ['attendance.self', '자녀 출석 조회'],
  ['report.write', '주일보고 작성·제출'],
  ['report.review', '주일보고 확인(목회자)'],
  ['notice.write', '알림장 작성'],
  ['notice.read', '알림장 보기·확인'],
  ['feed.write', '피드 작성'],
  ['feed.read', '피드 보기'],
  ['member.manage', '반·학생 관리'],
  ['child.link', '학부모–자녀 연결'],
  ['staff.manage', '교사 담임·권한 지정'],
  ['schedule.manage', '일정 관리'],
  ['user.manage', '사용자 관리'],
  ['user.approve', '가입 승인'],
  ['dept.manage', '부서 관리'],
  ['plan.read', '월별계획표 보기'],
  ['plan.write', '월별계획표 작성'],
  ['ledger.manage', '회계 관리']
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
    plans: [], ledger: [],
    people: {},
    settings: { church: '덕신교회', title: '부서업무', updatedAt: 0 },
    rev: 0
  };
}

const COLLS = ['roles', 'departments', 'classes', 'students', 'attendance', 'reports', 'notices', 'feeds', 'events', 'plans', 'ledger'];

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
    students: info.students || [], birth: info.birth || '', grants: info.grants || {},
    active: info.active !== false, at: Date.now()
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
    const info = appRowInfo(row);
    if (info.kind !== 'active') {
      const a = info.app || {};
      out.push({ uid: String(row.uid), salt: row.salt, wrap: row.wrap, status: info.kind,
        rec: { id: a.id || '?', name: a.name || '(이름 없음)', roles: a.roles || [], depts: a.depts || [], classes: a.classes || [], students: [] },
        app: a, note: info.note || '', updated: Number(row.updated) || 0 });
      continue;
    }
    let rec = null;
    try { rec = await Crypto.openJson(S.dek, JSON.parse(row.rec)); } catch (e) { rec = { id: '?', name: '(읽을 수 없음)', roles: [] }; }
    out.push({ uid: String(row.uid), salt: row.salt, wrap: row.wrap, rec: rec, status: 'active', updated: Number(row.updated) || 0 });
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
/* 교육부서담당이 교사에게 위임한 권한 (계정에 함께 보관) */
function grantedPerms() { return (S.me && S.me.grants) || {}; }
function permsOf(key) {
  const r = roleDef(key);
  const p = Object.assign({}, BASE_PERMS[r.base] || {});
  if (key === S.roleKey) {
    const g = grantedPerms();
    Object.keys(g).forEach(k => { if (g[k]) p[k] = 1; });
  }
  return p;
}
function can(perm) { return !!permsOf(S.roleKey)[perm]; }
/* 위임할 수 있는 권한 — 교육부서담당이 교사별로 체크 */
const DELEGABLE_PERMS = [
  ['schedule.manage', '일정 관리'],
  ['ledger.manage', '회계 입력·관리'],
  ['report.write', '주일보고 작성'],
  ['plan.write', '월별계획표 작성'],
  ['attendance.check', '출석 체크'],
  ['member.manage', '반·학생 관리']
];
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

/* ================= 가입 신청 · 승인용 열쇠 교환 (RSA-OAEP + PBKDF2) =================
   신청자는 자기 비밀번호로만 열리는 개인키를 만들어 두고, 공개키만 신청서에 담아 둡니다.
   승인자는 신청자의 공개키로 자료 열쇠(DEK)를 감싸 주고, 신청자는 첫 로그인 때
   자기 비밀번호로 개인키를 풀어 DEK 를 얻은 뒤 곧바로 자기 비밀번호 봉인으로 바꿉니다.
   → 승인자는 신청자의 비밀번호를 몰라도 되고, 자료는 계속 종단간 암호화됩니다. */
const Keys = {
  b64(buf) { return b64(buf); },
  async newPair() {
    const kp = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']);
    return {
      pub: b64(await crypto.subtle.exportKey('spki', kp.publicKey)),
      priv: new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
    };
  },
  async importPub(pubB64) {
    return crypto.subtle.importKey('spki', b64d(pubB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  },
  async importPriv(privBytes) {
    return crypto.subtle.importKey('pkcs8', privBytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  },
  async sealTo(pubB64, rawDek) {
    const pub = await this.importPub(pubB64);
    return b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawDek));
  },
  async openFrom(privBytes, b64ct) {
    const priv = await this.importPriv(privBytes);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64d(b64ct)));
  }
};

/* 계정 시트 한 줄의 상태 읽기
   - active    : 보통 계정 (rec = 암호문)
   - pending   : 가입 신청만 된 상태 (rec = 평문 신청서, 결재 대기)
   - approved  : 승인되어 DEK 를 받아 두었으나 아직 첫 로그인 전
   - rejected  : 반려됨
   deleted 열: '' = 정상, 'P' = 가입 절차 중, 'R' = 반려, '1' = 삭제 */
function appRowInfo(row) {
  if (!row) return { kind: 'none' };
  const del = String(row.deleted || '');
  let rec = null;
  try { rec = JSON.parse(String(row.rec || 'null')); } catch (e) { rec = null; }
  const plain = !!(rec && rec.app);
  if (del === '1') return { kind: 'deleted' };
  if (del === 'R' || (plain && rec.status === 'rejected')) return { kind: 'rejected', app: rec && rec.app, note: rec && rec.note };
  if (plain) return { kind: rec.status === 'approved' ? 'approved' : 'pending', app: rec.app, pub: rec.pub, dek: rec.dek, by: rec.by, byName: rec.byName, at: rec.at };
  return { kind: 'active' };
}

/* 신청서를 시트 한 줄로 (평문 — 승인자가 읽어야 하므로 이름·부서만 담고 비밀번호는 담지 않습니다) */
async function buildApplication(info) {
  const pair = await Keys.newPair();
  const salt = Crypto.randB64(16);
  const kek = await Crypto.kek(info.password, salt);
  const wrap = await Crypto.seal(kek, pair.priv);
  const app = {
    name: String(info.name || '').trim(),
    id: normId(info.id),
    birth: String(info.birth || '').trim(),
    roles: info.roles || [],
    depts: info.depts || [],
    classes: info.classes || [],
    className: info.className || '',
    childName: String(info.childName || '').trim(),
    note: String(info.note || '').trim(),
    at: Date.now()
  };
  return {
    uid: await uidOf(info.id),
    salt: salt,
    wrap: JSON.stringify(wrap),
    rec: JSON.stringify({ app: app, pub: pair.pub, status: 'pending' }),
    rev: Date.now(), updated: Date.now(), deleted: 'P'
  };
}

/* 승인: 관리 중인 자료 열쇠(DEK)를 신청자 공개키로 감싸 신청서에 넣붙입니다.
   승인자가 부서·반을 바로잡아 줄 수 있도록 overrides 를 받습니다. */
async function approveApplication(row, overrides) {
  const info = appRowInfo(row);
  if (!info.pub) throw new Error('신청서에 공개키가 없습니다');
  const sealed = await Keys.sealTo(info.pub, S.wkRaw);
  const app = Object.assign({}, info.app || {}, overrides || {});
  return {
    uid: String(row.uid), salt: row.salt, wrap: row.wrap,
    rec: JSON.stringify({ app: app, pub: info.pub, dek: sealed, status: 'approved', by: S.me.uid, byName: S.me.name, at: Date.now() }),
    rev: Date.now(), updated: Date.now(), deleted: 'P'
  };
}

function rejectApplication(row, why) {
  const info = appRowInfo(row);
  return {
    uid: String(row.uid), salt: row.salt, wrap: row.wrap,
    rec: JSON.stringify({ app: info.app, pub: info.pub, status: 'rejected', by: S.me.uid, byName: S.me.name, at: Date.now(), note: String(why || '') }),
    rev: Date.now(), updated: Date.now(), deleted: 'R'
  };
}

/* 승인받은 신청자의 첫 로그인: 개인키 복호 → DEK 획득 → 자기 비밀번호 봉인으로 전환 */
async function activateApproved(row, password, info) {
  const kek = await Crypto.kek(password, row.salt);
  const privBytes = await Crypto.open(kek, JSON.parse(row.wrap));
  const raw = await Keys.openFrom(privBytes, info.dek);
  if (!raw || raw.length !== 32) throw new Error('자료 열쇠를 풀지 못했습니다');
  const dek = await Crypto.importDek(raw);
  const a = info.app || {};
  const rec = await Crypto.sealJson(dek, {
    id: a.id, name: a.name || a.id, roles: a.roles || [], depts: a.depts || [], classes: a.classes || [],
    students: a.students || [], childName: a.childName || '', birth: a.birth || '', grants: a.grants || {},
    active: true, at: Date.now()
  });
  const salt = Crypto.randB64(16);
  const kek2 = await Crypto.kek(password, salt);
  const wrap = await Crypto.seal(kek2, raw);
  const row2 = {
    uid: String(row.uid), salt: salt, wrap: JSON.stringify(wrap), rec: JSON.stringify(rec),
    rev: Date.now(), updated: Date.now(), deleted: ''
  };
  await saveAccountRow(row2);
  return { dek: dek, raw: raw, rec: a };
}

/* ---------------- 주차·기간 도우미 ---------------- */
/* 달력 주차(일요일 시작) — 2026년 11월 2일은 1주차, 9일은 2주차 … */
function weekOfMonth(dateStr) {
  if (!dateStr) return 0;
  const d = parseYmd(dateStr);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = new Date(first.getTime());
  start.setDate(1 - first.getDay());
  return Math.floor(Math.round((d - start) / 86400000) / 7) + 1;
}
/* 주일(일요일)이 속한 주의 일~토 범위 */
function weekRangeAround(dateStr) {
  const d = parseYmd(dateStr);
  const from = new Date(d.getTime()); from.setDate(d.getDate() - d.getDay());
  const to = new Date(from.getTime()); to.setDate(from.getDate() + 6);
  return { from: ymd(from), to: ymd(to) };
}
function monthKeyOf(dateStr) { return String(dateStr || '').slice(0, 7); }
function monthLabel(ym) { const p = String(ym || '').split('-'); return Number(p[0]) + '년 ' + Number(p[1]) + '월'; }
function shiftMonth(ym, n) {
  const p = String(ym || '').split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1 + n, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function money(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }

/* ---------------- 생일 · 자동 일정 ----------------
   생일은 해마다 돌아오므로 일정에는 '월-일'(birth)로 보관하고, 화면에서 올해·내년 날짜로 펼쳐 보여 줍니다.
   계정(가입 승인)과 아동 명단(수기·업로드) 모두 같은 방식으로 자동 등록·갱신합니다. */
function birthdayMmdd(birth) {
  const s = String(birth || '').trim();
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  return '';
}
function birthdayDateInYear(mmdd, year) {
  const m = String(mmdd || '').match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  let mo = Number(m[1]), dd = Number(m[2]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return '';
  const d = new Date(year, mo - 1, dd);
  if (d.getMonth() !== mo - 1) return year + '-' + pad2(mo) + '-' + pad2(28);   /* 2월 29일 등 */
  return ymd(d);
}
function nextBirthdayDate(mmdd, from) {
  const today = from || ymd();
  const y = Number(String(today).slice(0, 4));
  const a = birthdayDateInYear(mmdd, y);
  if (a && a >= today) return a;
  return birthdayDateInYear(mmdd, y + 1);
}
function birthEventOf(ownerType, ownerId) {
  return (S.state.events || []).find(e => e.auto === 'birth' && e.ownerType === ownerType && e.ownerId === ownerId) || null;
}
/* 생일 일정 자동 등록·갱신. deptIds 는 문자열 또는 배열. 생일이 없으면 기존 일정을 지웁니다. */
function syncBirthEvent(ownerType, ownerId, name, birth, deptIds) {
  if (!ownerType || !ownerId) return null;
  S.state.events = S.state.events || [];
  let ev = birthEventOf(ownerType, ownerId);
  const mmdd = birthdayMmdd(birth);
  if (!mmdd) {
    if (ev) { ev._del = true; touch(ev); }
    return null;
  }
  const list = Array.isArray(deptIds) ? deptIds : (deptIds ? [deptIds] : []);
  const deptId = list.find(d => deptById(d)) || (ev && ev.deptId) || '';
  if (!ev) {
    ev = { id: 'ev-' + Crypto.uid(), auto: 'birth', ownerType: ownerType, ownerId: ownerId, by: S.me ? S.me.uid : '', u: 0 };
    S.state.events.push(ev);
  }
  ev.title = '🎂 ' + String(name || '').trim() + ' 생일';
  ev.birth = mmdd;
  ev.birthYear = String(birth || '').slice(0, 4);
  ev.deptId = deptId;
  ev.date = nextBirthdayDate(mmdd);
  ev.time = '';
  ev.place = '';
  ev.desc = '생일 자동 등록';
  ev._del = false;
  touch(ev);
  return ev;
}

/* ---------------- 월별계획표 → 부서 일정 자동 동기화 ---------------- */
function planEventTitle(p) {
  const em = p.kind === '행사' ? '🎉' : p.kind === '교육' ? '📚' : p.kind === '공과' ? '📖' : '🗓️';
  return em + ' ' + String(p.title || '');
}
function syncPlanEvent(p) {
  if (!p || !p.id) return null;
  S.state.events = S.state.events || [];
  let ev = S.state.events.find(e => e.srcPlanId === p.id) || null;
  if (p._del) {
    if (ev) { ev._del = true; touch(ev); }
    return null;
  }
  if (p.kind === '공과') { if (ev) { ev._del = true; touch(ev); } return null; }
  if (!p.date || !p.deptId) return null;
  if (!ev) {
    ev = { id: 'ev-' + Crypto.uid(), auto: 'plan', srcPlanId: p.id, by: S.me ? S.me.uid : '', u: 0 };
    S.state.events.push(ev);
  }
  ev.title = planEventTitle(p);
  ev.date = p.date;
  ev.deptId = p.deptId;
  ev.kind = p.kind || '계획';
  ev.desc = (p.kind || '계획') + (p.detail ? ' · ' + p.detail : '') + ' · 월별계획표에서 자동 등록';
  ev.time = '';
  ev._del = false;
  touch(ev);
  return ev;
}
function dropPlanEvent(planId) {
  const ev = (S.state.events || []).find(e => e.srcPlanId === planId);
  if (ev) { ev._del = true; touch(ev); }
}

/* 한 해의 모든 주일(일요일) */
function sundaysOfYear(year) {
  const out = [];
  const d = new Date(Number(year), 0, 1);
  while (d.getFullYear() === Number(year)) {
    if (d.getDay() === 0) out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* 계획표 항목 — 부서·주차 */
function plansOf(deptId, ym) {
  return (S.state.plans || []).filter(p => !p._del && p.deptId === deptId && monthKeyOf(p.date || p.month) === ym)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.order || 0) - (b.order || 0));
}
/* 주일보고 연계: 그 주일이 속한 주(일~토)의 계획 */
function plansOfWeek(deptId, dateStr) {
  const r = weekRangeAround(dateStr);
  return (S.state.plans || []).filter(p => !p._del && p.deptId === deptId && p.date >= r.from && p.date <= r.to)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
/* 회계: 그 주(일~토)의 수입만 */
function ledgerOfWeek(deptId, dateStr) {
  const r = weekRangeAround(dateStr);
  return ledgerIn(deptId, r.from, r.to);
}
function ledgerIn(deptId, from, to) {
  return (S.state.ledger || []).filter(e => !e._del && (deptId ? e.deptId === deptId : true) && e.date >= from && e.date <= to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function incomeTotal(list) { return list.filter(e => e.type === 'in').reduce((s, e) => s + (Number(e.amount) || 0), 0); }
function expenseTotal(list) { return list.filter(e => e.type === 'out').reduce((s, e) => s + (Number(e.amount) || 0), 0); }
