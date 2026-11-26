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
  admin: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'report.review': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'child.link': 1, 'staff.manage': 1, 'schedule.manage': 1, 'user.manage': 1, 'dept.manage': 1, 'plan.read': 1, 'plan.write': 1, 'ledger.manage': 1, 'user.approve': 1, 'year.manage': 1 },
  pastor: { 'attendance.stat': 1, 'report.write': 1, 'report.review': 1, 'notice.read': 1, 'notice.write': 1, 'feed.write': 1, 'plan.read': 1, 'ledger.manage': 1, 'user.approve': 1, 'schedule.manage': 1 },
  edu: { 'attendance.check': 1, 'attendance.stat': 1, 'report.write': 1, 'notice.write': 1, 'notice.read': 1, 'feed.write': 1, 'member.manage': 1, 'child.link': 1, 'staff.manage': 1, 'schedule.manage': 1, 'plan.read': 1, 'plan.write': 1, 'ledger.manage': 1, 'user.approve': 1, 'year.manage': 1 },
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
  ['ledger.manage', '회계 관리'],
  ['year.manage', '연도·진급 관리']
];

/* 부서는 세 개입니다 — 유치부(7세까지) · 초등부(초1~초6) · 청소년부(중1~고3) */
const DEFAULT_DEPTS = [
  { id: 'dept-kids', name: '유치부', emoji: '🌿', color: '#ffd6a5', note: '', order: 1, active: true, u: 1 },
  { id: 'dept-elem', name: '초등부', emoji: '🌳', color: '#a8d8b9', note: '', order: 2, active: true, u: 1 },
  { id: 'dept-teen', name: '청소년부', emoji: '🌲', color: '#b8c8ee', note: '', order: 3, active: true, u: 1 }
];

/* ---------------- 부서 이름·자료 호환 (v5) ----------------
   예전 네 부서(유아부·유치부·초등부·중등부) 자료를 세 부서로 이어 붙입니다.
   · 유아부(dept-nursery) 자료 → 유치부(dept-kids) 로 병합
   · 유치부(dept-kids) → 이름 그대로 유치부
   · 초등부(dept-elem) → 이름 그대로 초등부
   · 중등부(dept-teen) → 청소년부로 이름 변경
   저장된 자료(학생·반·출석·주일보고·계정·일정·계획·회계)의 deptId 를 모두 옮겨
   화면 어디에서도 옛 부서 이름이 보이지 않게 합니다. */
const DEPT_SCHEMA = 2;
const DEPT_CANON = DEFAULT_DEPTS.map(d => ({ id: d.id, name: d.name, emoji: d.emoji, color: d.color, order: d.order }));
const DEPT_ALIAS = { 'dept-nursery': 'dept-kids' };
const DEPT_OLD_NAMES = { '유아부': 'dept-kids', '중등부': 'dept-teen' };
function canonDeptId(id) { return DEPT_ALIAS[String(id || '')] || String(id || ''); }
function canonDeptByName(name) { return DEPT_OLD_NAMES[String(name || '').trim()] || ''; }
function deptNameCanon(id) { const c = DEPT_CANON.find(x => x.id === canonDeptId(id)); return c ? c.name : ''; }
/* 지금 상태의 부서·자료를 세 부서 기준으로 맞춥니다. 바뀐 항목 수를 돌려줍니다. */
function normalizeDeptRefs(includeMe) {
  const st = S.state;
  if (!st || !Array.isArray(st.departments)) return 0;
  const now = Date.now();
  let changed = 0;

  /* 1) 부서 목록 — 같은 부서로 합쳐지면 이름이 제대로 된 쪽(정식 id)을 남깁니다 */
  const picks = {};
  const extras = [];
  const tomb = [];
  st.departments.forEach(d => {
    if (!d || !d.id) return;
    if (d._del) { tomb.push(d); return; }
    let tid = canonDeptId(d.id);
    if (!DEPT_CANON.some(c => c.id === tid)) tid = canonDeptByName(d.name) || tid;
    if (DEPT_CANON.some(c => c.id === tid)) {
      const prev = picks[tid];
      if (!prev) picks[tid] = d;
      else {
        /* 정식 id 를 가진 기록을 우선하고, 메모는 비어 있지 않은 쪽을 씁니다 */
        const better = (d.id === tid && prev.id !== tid) ? d : prev;
        const other = better === d ? prev : d;
        if (!better.note && other.note) better.note = other.note;
        picks[tid] = better;
      }
    } else {
      extras.push(d);
    }
  });
  const next = [];
  DEPT_CANON.forEach(c => {
    const cur = picks[c.id];
    const d = cur || { id: c.id, note: '', active: true, u: 0 };
    if (d.id !== c.id || d.name !== c.name || d.emoji !== c.emoji || d.color !== c.color || d.order !== c.order || d.active === false) {
      d.id = c.id; d.name = c.name; d.emoji = c.emoji; d.color = c.color; d.order = c.order; d.active = true;
      d.u = now; changed++;
    }
    next.push(d);
  });
  extras.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(d => {
    d.order = (d.order || 0) > 3 ? d.order : next.length + 1;
    next.push(d);
  });
  /* 지운 부서 기록은 남겨 두어 다른 기기와 어긋나지 않게 합니다 */
  tomb.forEach(d => next.push(d));
  st.departments = next;

  /* 2) 자료의 deptId 옮기기 */
  const fix = rec => {
    if (!rec || !rec.deptId) return;
    const t = canonDeptId(rec.deptId);
    if (t !== rec.deptId) { rec.deptId = t; rec.u = Math.max(Number(rec.u) || 0, now); changed++; }
  };
  ['classes', 'students', 'attendance', 'reports', 'notices', 'feeds', 'events', 'plans', 'ledger', 'budgets'].forEach(key => {
    (st[key] || []).forEach(fix);
  });
  /* 반이 옮겨진 학생은 반의 부서를 따라갑니다 */
  const clsDept = {};
  (st.classes || []).forEach(c => { if (c && c.id && !c._del) clsDept[c.id] = c.deptId; });
  (st.students || []).forEach(s => {
    if (!s || s._del) return;
    const cd = clsDept[s.classId];
    if (cd && s.deptId !== cd) { s.deptId = cd; s.u = Math.max(Number(s.u) || 0, now); changed++; }
  });

  /* 3) 내 계정의 부서 */
  if (includeMe && S.me) {
    const before = JSON.stringify(S.me.depts || []);
    S.me.depts = Array.from(new Set((S.me.depts || []).map(canonDeptId)));
    if (JSON.stringify(S.me.depts) !== before) changed++;
  }
  st.deptSchema = DEPT_SCHEMA;
  return changed;
}

function emptyState(seed) {
  return {
    v: 3,
    roles: seed === false ? [] : JSON.parse(JSON.stringify(DEFAULT_ROLES)),
    departments: seed === false ? [] : JSON.parse(JSON.stringify(DEFAULT_DEPTS)),
    classes: [], students: [], attendance: [], reports: [], notices: [], feeds: [], events: [],
    plans: [], ledger: [], budgets: [], years: [], requests: [],
    people: {},
    settings: { church: '덕신교회', title: '부서업무', updatedAt: 0 },
    rev: 0
  };
}

const COLLS = ['roles', 'departments', 'classes', 'students', 'attendance', 'reports', 'notices', 'feeds', 'events', 'plans', 'ledger', 'budgets', 'requests'];

/* ---------------- 앱 상태 ---------------- */
const S = {
  dek: null,
  rev: 0,
  state: emptyState(),
  me: null,             // {uid, id, name, roles:[], depts:[], classes:[], students:[]}
  chosen: [],           // 로그인 화면에서 고른 역할
  roleKey: '',
  year: 0,              // 지금 보고 있는 연도 (자료는 연도별로 나뉩니다)
  dept: '',
  screen: 'home',
  sync: 'idle',         // idle | saving | saved | error | off
  syncMsg: '',
  ready: false,
  lastPull: 0
};

function normId(id) { return String(id || '').trim().toLowerCase(); }
async function uidOf(id) { return (await Crypto.sha256('deoksin-edu-account:' + normId(id))).slice(0, 32); }

/* 아이디 — 한글 이름도 그대로 쓸 수 있습니다 (2~24자, 공백·기호는 _ . - 만) */
function okAccountId(id) { return /^[가-힣a-zA-Z0-9_.-]{2,24}$/.test(String(id || '').trim()); }
function idRuleText() { return '아이디는 한글·영문·숫자 2~24자로 정해 주세요. (예: 박한성, kim01)'; }

/* ---------------- 계정 ---------------- */
async function buildAccount(dek, info) {
  const salt = Crypto.randB64(16);
  const kek = await Crypto.kek(info.password, salt);
  const wrap = await Crypto.seal(kek, await Crypto.rawDek(dek));
  const rec = await Crypto.sealJson(dek, {
    id: normId(info.id), name: String(info.name || '').trim() || normId(info.id),
    roles: info.roles || [], depts: info.depts || [], classes: info.classes || [],
    students: info.students || [], birth: info.birth || '', grants: info.grants || {},
    birthType: info.birthType || 'solar', birthLunar: info.birthLunar || '',
    status: info.status || 'normal', statusNote: info.statusNote || '', statusAt: 0,
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
        rec: { id: a.id || '?', name: a.name || '(이름 없음)', roles: a.roles || [], depts: (a.depts || []).map(canonDeptId), classes: a.classes || [], students: [] },
        app: a, note: info.note || '', updated: Number(row.updated) || 0 });
      continue;
    }
    let rec = null;
    try { rec = await Crypto.openJson(S.dek, JSON.parse(row.rec)); } catch (e) { rec = { id: '?', name: '(읽을 수 없음)', roles: [] }; }
    if (rec && Array.isArray(rec.depts)) rec.depts = Array.from(new Set(rec.depts.map(canonDeptId)));
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
  local.deptSchema = Math.max(Number(local.deptSchema) || 0, Number(remote.deptSchema) || 0);
  local.people = Object.assign({}, remote.people || {}, local.people || {});
  /* 연도 목록은 양쪽을 합칩니다. 삭제한 연도는 표시를 남겨 다른 기기에서도 되살아나지 않게 합니다 */
  const ymap = {}, ydel = {};
  [].concat(remote.years || [], local.years || []).forEach(y => {
    const n = Number(y && (y.year || y));
    if (!n) return;
    const o = (y && typeof y === 'object') ? y : {};
    ymap[n] = Object.assign({ year: n }, ymap[n] || {}, o);
    if (o._del) ydel[n] = Math.max(Number(o.u) || 0, ydel[n] || 0);
  });
  Object.keys(ydel).forEach(k => {
    const it = ymap[k];
    if (!it) return;
    /* 삭제 표시가 그 뒤에 다시 만든 기록보다 최신일 때만 지운 것으로 봅니다 */
    if ((Number(it.u) || 0) <= ydel[k]) { it._del = true; it.u = ydel[k]; }
  });
  local.years = Object.keys(ymap).map(k => ymap[k]).sort((a, b) => a.year - b.year);
  const ls = local.settings || {}, rs = remote.settings || {};
  local.settings = (Number(rs.updatedAt) || 0) > (Number(ls.updatedAt) || 0) ? Object.assign({}, ls, rs) : Object.assign({}, rs, ls);
  // 부서에 없는 옛 역할 키가 있으면 기본값 유지
  if (!(local.roles || []).length) local.roles = JSON.parse(JSON.stringify(DEFAULT_ROLES));
  /* 예전 부서 이름(유아부·중등부) 자료를 세 부서로 이어 붙입니다 */
  try { normalizeDeptRefs(false); } catch (e) { }
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
    try { normalizeDeptRefs(true); } catch (e) { }
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
      me: S.me, chosen: S.chosen, roleKey: S.roleKey, year: S.year, wk: b64(S.wkRaw), rev: S.rev, at: Date.now()
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
    S.year = Number(s.year) || 0;
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
  const list = (S.me.depts || []).map(canonDeptId).filter(Boolean);
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
function studentsOfDeptIn(deptId, year) { return (S.state.students || []).filter(s => !s._del && s.active !== false && s.deptId === deptId && recYear(s) === Number(year)); }
function studentsOfClassIn(classId, year) { return (S.state.students || []).filter(s => !s._del && s.active !== false && s.classId === classId && recYear(s) === Number(year)); }
function classesOfDeptIn(deptId, year) { return (S.state.classes || []).filter(c => !c._del && c.deptId === deptId && recYear(c) === Number(year)).sort((a, b) => (a.order || 0) - (b.order || 0)); }
function studentsOfDept(deptId) { return studentsOfDeptIn(deptId, curYear()); }
function studentsOfClass(classId) { return studentsOfClassIn(classId, curYear()); }
function classesOfDept(deptId) { return classesOfDeptIn(deptId, curYear()); }
function allStudentsIn(year) { return (S.state.students || []).filter(s => !s._del && s.active !== false && recYear(s) === Number(year)); }
function peopleOf(uid) { return (S.state.people || {})[uid] || null; }
function nameOfUid(uid) { const p = peopleOf(uid); return p ? p.name : '(알 수 없음)'; }

/* ---------------- 학부모 연결 (아이 한 명에 학부모 두 명 이상) ----------------
   옛 자료의 guardianUid(한 명)와 새 guardianUids(여러 명)를 함께 읽습니다.
   첫 값은 늘 guardianUid 에도 남겨 두어 예전 화면·자료가 그대로 동작합니다. */
function guardianIdsOf(s) {
  const out = [];
  if (!s) return out;
  [].concat(s.guardianUids || [], s.guardianUid ? [s.guardianUid] : []).forEach(u => {
    const k = String(u || '').trim();
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}
function hasGuardian(s) { return guardianIdsOf(s).length > 0; }
function guardianNamesOf(s) { return guardianIdsOf(s).map(u => nameOfUid(u)).filter(Boolean); }
function addGuardianTo(s, uid) {
  if (!s || !uid) return false;
  const list = guardianIdsOf(s);
  if (list.indexOf(uid) >= 0) { s.guardianUids = list; return false; }
  list.push(uid);
  s.guardianUids = list;
  if (!s.guardianUid) s.guardianUid = list[0];
  touch(s);
  return true;
}
function removeGuardianFrom(s, uid) {
  if (!s) return false;
  const list = guardianIdsOf(s).filter(u => u !== uid);
  s.guardianUids = list;
  if (s.guardianUid === uid) s.guardianUid = list[0] || '';
  touch(s);
  return true;
}

/* ---------------- 역할·부서 변경 신청 ----------------
   학부모 → 교사처럼 권한이 올라가는 변경은 곧바로 적용하지 않고
   윗단계(교육부서담당·목회자·관리자)가 승인한 뒤에 적용합니다.
   부서만 옮기거나 권한이 올라가지 않는 변경은 바로 적용합니다. */
function changeRequests() { return (S.state.requests || []).filter(r => r && !r._del); }
function pendingChanges() { return changeRequests().filter(r => r.status === 'pending'); }
function myPendingChange() {
  if (!S.me) return null;
  return pendingChanges().find(r => r.uid === S.me.uid) || null;
}
function sameKeySet(a, b) {
  const A = Array.from(new Set((a || []).map(x => String(x)))).sort();
  const B = Array.from(new Set((b || []).map(x => String(x)))).sort();
  return A.length === B.length && A.every((v, i) => v === B[i]);
}
/* 이 신청을 내가 승인할 수 있는지 — 바로 윗단계 + 같은 부서 */
function canApproveChange(r) {
  if (!r || r.status !== 'pending') return false;
  if (!can('user.approve') && !can('user.manage')) return false;
  const myR = myRank();
  if (!myR || myR <= rankOfKeys(r.to && r.to.roles)) return false;
  const base = roleDef(S.roleKey).base;
  if (base === 'admin' || base === 'pastor') return true;
  const myDepts = (S.me.depts || []).map(canonDeptId);
  if (!myDepts.length) return true;
  const toDepts = ((r.to && r.to.depts) || []).map(canonDeptId);
  const fromDepts = ((r.from && r.from.depts) || []).map(canonDeptId);
  if (!toDepts.length) return fromDepts.some(d => myDepts.indexOf(d) >= 0);
  return toDepts.some(d => myDepts.indexOf(d) >= 0);
}

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

/* ---------------- 연도 (자료는 1년 단위로 나뉩니다) ----------------
   출석·주일보고·월별계획표·회계·일반 일정·학생·반은 연도마다 따로 보입니다.
   연도 칸이 없는 옛 자료(2026년 이전에 만든 것)는 2026년 자료로 읽습니다. */
const FIRST_YEAR = 2026;
function curYear() { return Number(S.year) || FIRST_YEAR; }
function yearOfDate(d) { const y = Number(String(d || '').slice(0, 4)); return y >= 1900 ? y : 0; }
function recYear(rec) {
  if (!rec) return 0;
  return Number(rec.year) || yearOfDate(rec.date || rec.month) || FIRST_YEAR;
}
function inYear(rec) { return recYear(rec) === curYear(); }
function availableYears() {
  const set = {};
  set[FIRST_YEAR] = 1;
  set[new Date().getFullYear()] = 1;
  set[curYear()] = 1;
  (S.state.years || []).forEach(y => { if (!y || y._del) return; const n = Number(y.year || y); if (n) set[n] = 1; });
  ['students', 'classes', 'plans', 'ledger', 'reports', 'attendance'].forEach(key => {
    (S.state[key] || []).forEach(r => {
      if (!r || r._del) return;
      const y = Number(r.year) || yearOfDate(r.date || r.month);
      if (y >= 1900) set[y] = 1;
    });
  });
  return Object.keys(set).map(Number).filter(n => n >= 1900).sort((a, b) => a - b);
}
function ensureYear(y) {
  y = Number(y);
  if (!y) return null;
  S.state.years = S.state.years || [];
  let it = S.state.years.find(x => Number(x && x.year) === y);
  if (!it) { it = { year: y, created: Date.now(), u: Date.now() }; S.state.years.push(it); }
  else if (it._del) { it._del = false; it.u = Date.now(); }   /* 지웠던 연도를 다시 만들면 되살립니다 */
  return it;
}
function yearHasData(y) {
  y = Number(y);
  return ['students', 'classes', 'plans', 'ledger', 'reports', 'attendance'].some(key =>
    (S.state[key] || []).some(r => r && !r._del && (Number(r.year) || yearOfDate(r.date || r.month)) === y));
}
function setYear(y) {
  y = Number(y);
  if (!y || y < 1900) return;
  S.year = y;
  if (typeof V !== 'undefined') {
    const now = new Date();
    if (y === now.getFullYear()) { V.date = lastSunday(); V.reportDate = V.date; }
    else { V.date = lastSunday(new Date(y, 0, 1)); V.reportDate = V.date; }
    V.planMonth = y + '-01';
    V.ledMonth = y + '-01';
    V.statMonth = y + '-01';
    V.statYear = y;
    V.planDept = V.planDept || '';
    V.cls = '';
    V.statCls = '';
  }
  saveSession();
}

/* 날짜를 골랐을 때 그 해로 화면 연도를 맞춥니다 */
function syncYearToDate(d) {
  const y = yearOfDate(d);
  if (!y || y === curYear()) return false;
  S.year = y;
  ensureYear(y);
  if (typeof V !== 'undefined') { V.planMonth = ''; V.ledMonth = ''; V.statMonth = ''; V.statYear = 0; V.cls = ''; V.statCls = ''; }
  saveSession();
  return true;
}

/* ================= 나이·학년 (진급 판정) =================
   사용자 기준: 유치부는 7세까지, 초등부는 6학년까지, 청소년부는 고등학교까지.
   한국 나이 = 그 해 - 출생연도 + 1. 8세=초1 … 13세=초6, 14세=중1 … 19세=고3, 20세부터 졸업. */
function birthYearOf(rec) {
  const m = String((rec && (rec.birth || rec.birthYear)) || '').match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}
function ageInYear(rec, year) {
  const by = birthYearOf(rec);
  const y = Number(year) || curYear();
  return by ? (y - by + 1) : 0;
}
function gradeLabelOfAge(age) {
  const a = Number(age) || 0;
  if (!a) return '';
  if (a <= 7) return a + '세';
  if (a <= 13) return '초' + (a - 7);
  if (a <= 16) return '중' + (a - 13);
  if (a <= 19) return '고' + (a - 16);
  return '졸업';
}
function ageLabelOf(rec, year) { return gradeLabelOfAge(ageInYear(rec, year)); }
/* 나이에 맞는 부서 id — '' (생년월일 없음) 또는 'graduate'(20세 이상) */
function deptIdForAge(age) {
  const a = Number(age) || 0;
  if (!a) return '';
  if (a <= 7) return 'dept-kids';
  if (a <= 13) return 'dept-elem';
  if (a <= 19) return 'dept-teen';
  return 'graduate';
}
/* 그 해 기준 진급 판정 — {age, label, deptId, deptName} */
function promoOf(student, year) {
  const age = ageInYear(student, year);
  const deptId = deptIdForAge(age);
  return {
    age: age, label: gradeLabelOfAge(age), deptId: deptId,
    deptName: deptId === 'graduate' ? '졸업' : (deptNameCanon(deptId) || deptId)
  };
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

/* 계정 상태 — 정상 / 일시중지 / 차단 (기존 기록은 그대로 보존) */
const ACCOUNT_STATUS = { normal: '정상', paused: '일시중지', blocked: '차단' };
function accountStatusOf(rec) { const s = rec && rec.status; return ACCOUNT_STATUS[s] ? s : 'normal'; }
function accountStatusChip(rec) {
  const s = accountStatusOf(rec);
  if (s === 'paused') return '<span class="chip amber">⏸ 일시중지</span>';
  if (s === 'blocked') return '<span class="chip rose">⛔ 차단</span>';
  if (rec && rec.active === false) return '<span class="chip gray">사용 중지</span>';
  return '';
}

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
    birthType: info.birthType === 'lunar' ? 'lunar' : 'solar',
    birthLunar: info.birthLunar || '',
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
  if (Array.isArray(app.depts)) app.depts = Array.from(new Set(app.depts.map(canonDeptId)));
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
    id: a.id, name: a.name || a.id, roles: a.roles || [], depts: Array.from(new Set((a.depts || []).map(canonDeptId))), classes: a.classes || [],
    students: a.students || [], childName: a.childName || '', birth: a.birth || '', grants: a.grants || {},
    birthType: a.birthType || 'solar', birthLunar: a.birthLunar || '',
    status: 'normal', statusNote: '', statusAt: 0,
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

/* ---------------- 생일 (양력·음력) · 자동 일정 ----------------
   생일은 해마다 돌아오므로 '월-일'로 보관하고, 화면에서 그 해 양력 날짜로 펼쳐 보여 줍니다.
   음력 생일은 아래 내장 표(한국천문연구원 기준 · 1930~2050년)로 그 해의 양력 날짜를 계산합니다.
   ⚠ 자료가 늘지 않도록 LUNAR_NY/LUNAR_MD 는 한 줄 문자열입니다(해마다 4자·5자). */
const LUNAR_FIRST_YEAR = 1930;
const LUNAR_NY = '01300217020601260214020401240211013102190208012702150205012602130202012202100129' +
  '02170206012702140204012402120131021902080128021502050125021302020122020901300217' +
  '02060127021502030123021101310218020701280216020501250213020202200209012902180206' +
  '01270215020401230210013102190208012802160205012402120201012202090129021802070126' +
  '02140203012302100131021902080128021602050125021202010122021001290217020701270213' +
  '02030123021101310219020801280215020401240212020101220210013002170206012602140202' +
  '0123';
const LUNAR_MD = '0c6a60052700a570b95600ada006d407751007490fb1300a930052b0d51b0096d00b6a09da400ba4' +
  '00b4904d4b00a950eaab0052d00aad0baaa00db200da407ea100d4a10d9500a96005560c57500ad5' +
  '006d20875500ea500e4a0664e00a9b0ead60056a00b590abb2007520072508b2b00a4b109ab002ad' +
  '0056b0d5a900da900d9208d9500d2514e4d00a56002b60caed006d400da90aed200e9200d260652e' +
  '00a57109b600b5a006d40a769007490069308a970052b00a5b04aae0036a0edd500ba400b490ad53' +
  '00a950052d0752d00aad12baa005d200da50aeaa00d4a00a9508a9d0055600ab504ad6006d20c765' +
  '00ea500e4a0a65600c9b0055a0656d00b6916f520075200b250db0b00a4b004ab0a2bb0056d00b69' +
  '04daa00d920eea500d2500a4d0ba4d002b6005b5076d1';
function lunarYearInfo(year) {
  const i = Number(year) - LUNAR_FIRST_YEAR;
  if (!(i >= 0) || i * 4 + 4 > LUNAR_NY.length) return null;
  const ny = LUNAR_NY.slice(i * 4, i * 4 + 4);
  const md = parseInt(LUNAR_MD.slice(i * 5, i * 5 + 5), 16);
  if (!ny || !isFinite(md)) return null;
  return { month: Number(ny.slice(0, 2)), day: Number(ny.slice(2, 4)), leap: (md >> 13) & 15, leapBig: (md >> 12) & 1, bits: md & 0xfff };
}
function lunarLeapMonth(year) { const i = lunarYearInfo(year); return i ? i.leap : 0; }
function lunarMonthLen(year, month) {
  const i = lunarYearInfo(year);
  if (!i) return 0;
  return ((i.bits >> (Number(month) - 1)) & 1) ? 30 : 29;
}
/* 음력 날짜 → 양력 'YYYY-MM-DD' (없는 날짜면 그 달 마지막 날로) */
function lunarToSolar(year, month, day) {
  const info = lunarYearInfo(year);
  if (!info) return '';
  const m = Number(month), d = Number(day);
  if (!(m >= 1 && m <= 12) || !(d >= 1)) return '';
  const dt = new Date(Number(year), info.month - 1, info.day);
  for (let mm = 1; mm < m; mm++) dt.setDate(dt.getDate() + lunarMonthLen(year, mm));
  if (info.leap && info.leap < m) dt.setDate(dt.getDate() + lunarMonthLen(year, info.leap));
  dt.setDate(dt.getDate() + Math.min(d, lunarMonthLen(year, m)) - 1);
  return ymd(dt);
}
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
/* 생일 정보 — {name, birth, birthType, birthLunar} 모양이면 모두 받습니다 */
function birthTypeOf(rec) { return rec && rec.birthType === 'lunar' ? 'lunar' : 'solar'; }
function birthMmddOf(rec) {
  if (!rec) return '';
  if (birthTypeOf(rec) === 'lunar') return String(rec.birthLunar || birthdayMmdd(rec.birth) || '').slice(0, 5);
  return birthdayMmdd(rec.birth);
}
/* 그 해에 생일이 돌아오는 양력 날짜 */
function birthOccDate(rec, year) {
  const mmdd = birthMmddOf(rec);
  if (!mmdd) return '';
  if (birthTypeOf(rec) === 'lunar') return lunarToSolar(year, Number(mmdd.slice(0, 2)), Number(mmdd.slice(3, 5)));
  return birthdayDateInYear(mmdd, year);
}
function birthLabel(rec) {
  if (!rec) return '';
  const mmdd = birthMmddOf(rec);
  if (!mmdd) return '';
  if (birthTypeOf(rec) === 'lunar') {
    const occ = birthOccDate(rec, new Date().getFullYear());
    return '음력 ' + Number(mmdd.slice(0, 2)) + '.' + Number(mmdd.slice(3, 5)) + (occ ? ' · 양력 ' + fmtShort(occ) : '');
  }
  return String(rec.birth || '').replace(/-/g, '.');
}
function birthEventOf(ownerType, ownerId) {
  return (S.state.events || []).find(e => e.auto === 'birth' && e.ownerType === ownerType && e.ownerId === ownerId) || null;
}
/* 생일 일정 자동 등록·갱신. deptIds 는 문자열 또는 배열. 생일이 없으면 기존 일정을 지웁니다. */
function syncBirthEvent(ownerType, ownerId, name, birth, deptIds, birthType, birthLunar) {
  if (!ownerType || !ownerId) return null;
  S.state.events = S.state.events || [];
  let ev = birthEventOf(ownerType, ownerId);
  const info = { name: name, birth: birth || '', birthType: birthType === 'lunar' ? 'lunar' : 'solar', birthLunar: birthLunar || '' };
  const mmdd = birthMmddOf(info);
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
  ev.birthType = info.birthType;
  ev.birthLunar = info.birthType === 'lunar' ? mmdd : '';
  ev.birthYear = String(birth || '').slice(0, 4);
  ev.deptId = deptId;
  ev.date = birthOccDate(info, curYear()) || birthOccDate(info, curYear() + 1) || '';
  ev.time = '';
  ev.place = '';
  ev.desc = '생일 자동 등록' + (info.birthType === 'lunar' ? ' (음력)' : '');
  ev._del = false;
  touch(ev);
  return ev;
}
/* 계정·학생·교사 기록에서 바로 생일 일정을 맞춥니다. ownerId 는 사람을 가리키는 고정 id */
function syncBirthEventOf(ownerType, ownerId, person, deptIds) {
  const p = person || {};
  return syncBirthEvent(ownerType, ownerId, p.name, p.birth, deptIds, birthTypeOf(p), p.birthLunar || '');
}
function nextBirthdayDate(mmdd, from) {
  const today = from || ymd();
  const y = Number(String(today).slice(0, 4));
  const a = birthdayDateInYear(mmdd, y);
  if (a && a >= today) return a;
  return birthdayDateInYear(mmdd, y + 1);
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
