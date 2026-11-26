/* 덕신교회 부서업무 — 11가지 요청 추가분
   (학부모–자녀 연결 / 교사 담임·권한 지정 / 문자·카톡 / 아동 명단 양식 / 연간 출석부 / 주일보고 반려)
   기존 core.js·ui.js·features.js·app.js 위에 얹습니다. 자료는 모두 기존 암호문 한 덩어리에 함께 저장됩니다. */
'use strict';

/* ================= 보호자 연락 ================= */
if (typeof V.autoMsg === 'undefined') V.autoMsg = false;

function normPhone(p) { return String(p || '').replace(/[^0-9]/g, ''); }
function fmtPhone(p) {
  const n = normPhone(p);
  if (n.length === 11) return n.slice(0, 3) + '-' + n.slice(3, 7) + '-' + n.slice(7);
  if (n.length === 10) return n.slice(0, 3) + '-' + n.slice(3, 6) + '-' + n.slice(6);
  return String(p || '');
}
function smsHref(phone, text) {
  const p = normPhone(phone);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return 'sms:' + p + (ios ? '&' : '?') + 'body=' + encodeURIComponent(String(text || ''));
}
function msgBtnHtml(sid, title) {
  return '<button class="msg-btn" data-act="msg-student" data-sid="' + esc(sid) + '" title="' + esc(title || '보호자에게 문자·카톡') + '">💬</button>';
}
function msgTextOf(id) { const e = document.getElementById(id); return e ? String(e.value || '') : ''; }

function messageModal(opts) {
  opts = opts || {};
  const s = opts.student || {};
  const phone = normPhone(opts.phone || s.guardianPhone || '');
  const text = opts.text || '';
  let h = '<div class="banner sky">' + (s.name ? '<b>' + esc(s.name) + '</b> · ' : '') + '보호자 ' + esc(s.guardianName || s.guardianPhone || '연락처 미등록') + '</div>';
  h += '<div class="field"><label>받는 번호</label><input id="msgPhone" type="tel" inputmode="tel" value="' + esc(phone ? fmtPhone(phone) : '') + '" placeholder="010-0000-0000"></div>';
  h += '<div class="field"><label>보낼 내용</label><textarea id="msgText" style="min-height:96px">' + esc(text) + '</textarea></div>';
  h += '<div class="row wrap" style="gap:6px"><a class="btn primary" id="msgSms" href="' + esc(smsHref(phone, text)) + '">📱 문자 보내기</a>';
  h += '<button class="btn" data-act="msg-kakao">💬 카톡·공유</button><button class="btn ghost" data-act="msg-copy">📋 내용 복사</button></div>';
  h += '<p class="hint" style="margin-top:8px">문자 앱이 열리면 [보내기]만 누르면 됩니다. 카톡은 공유 창에서 카카오톡을 고르거나, 복사한 내용을 카톡 대화창에 붙여넣으세요.</p>';
  openModal('보호자에게 보내기', h, { focus: 'msgText' });
}

function copyText(text) {
  const t = String(text || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('복사했습니다. 카톡에 붙여넣으세요', 'ok')).catch(() => fallbackCopy(t));
  } else fallbackCopy(t);
}
function fallbackCopy(t) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('복사했습니다. 카톡에 붙여넣으세요', 'ok');
  } catch (e) { toast('복사하지 못했습니다. 내용을 길게 눌러 복사해 주세요', 'err'); }
}
async function shareText(text) {
  const t = String(text || '');
  if (navigator.share) {
    try { await navigator.share({ title: '덕신교회 부서업무', text: t }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  copyText(t);
  return true;
}

/* ================= 계정 기록 고치기 (교사·학부모 계정) ================= */
async function updateAccountRec(uid, mutate) {
  const row = await fetchAccount(uid);
  if (!row) throw new Error('계정을 찾지 못했습니다');
  const info = appRowInfo(row);
  if (info.kind !== 'active') throw new Error('아직 첫 로그인 전인 계정입니다. 본인이 한 번 로그인한 뒤 지정할 수 있습니다.');
  const rec = await Crypto.openJson(S.dek, JSON.parse(row.rec));
  mutate(rec);
  rec.at = Date.now();
  const sealed = await Crypto.sealJson(S.dek, rec);
  await saveAccountRow({ uid: String(row.uid), salt: row.salt, wrap: row.wrap, rec: JSON.stringify(sealed), rev: Date.now(), updated: Date.now(), deleted: row.deleted || '' });
  return rec;
}
function isBaseRole(r, base) { return String(roleDef(r).base) === base; }
function accountDeptIds(a) { return (a && a.rec && a.rec.depts) || []; }
function accountClasses(a) { return (a && a.rec && a.rec.classes) || []; }

/* 내 계정 정보(담임·권한·자녀)를 주기적으로 다시 읽어 화면에 반영 */
async function refreshMyAccount() {
  if (!S.dek || !S.me || !Api.on()) return;
  try {
    const row = await fetchAccount(S.me.uid);
    if (!row) return;
    const info = appRowInfo(row);
    if (info.kind !== 'active') return;
    const rec = await Crypto.openJson(S.dek, JSON.parse(row.rec));
    if (rec.active === false) return;
    if (accountStatusOf(rec) !== 'normal') {
      const st = rec.status;
      clearSession();
      S.dek = null; S.me = null; S.state = emptyState();
      showLogin((st === 'paused' ? '일시중지된 계정입니다.' : '차단된 계정입니다.') + '\n사유: ' + (rec.statusNote || '담당자에게 문의해 주세요'));
      return;
    }
    const pick = () => JSON.stringify({ c: S.me.classes || [], d: S.me.depts || [], g: S.me.grants || {}, s: S.me.students || [], n: S.me.name, r: S.me.roles || [] });
    const before = pick();
    S.me = Object.assign({}, S.me, {
      name: rec.name || S.me.name, roles: rec.roles || [], depts: rec.depts || [], classes: rec.classes || [],
      students: rec.students || [], grants: rec.grants || {}, birth: rec.birth || '',
      birthType: birthTypeOf(rec), birthLunar: rec.birthLunar || '',
      status: accountStatusOf(rec), statusNote: rec.statusNote || ''
    });
    if (before !== pick()) {
      if ((S.me.roles || []).indexOf(S.roleKey) < 0) S.roleKey = highestRoleKey(S.me.roles);
      saveSession();
      renderApp();
    }
  } catch (e) { /* 다음 차례에 다시 */ }
}

/* ================= 1. 학부모–자녀 연결 ================= */
function kidsOfAccount(a) {
  const out = [];
  const seen = {};
  ((a && a.rec && a.rec.students) || []).forEach(id => { const s = (S.state.students || []).find(x => x.id === id && !x._del && inYear(x)); if (s && !seen[s.id]) { seen[s.id] = 1; out.push(s); } });
  (S.state.students || []).forEach(s => { if (!s._del && inYear(s) && s.guardianUid === a.uid && !seen[s.id]) { seen[s.id] = 1; out.push(s); } });
  return out;
}
function loadParentAccounts(force) {
  if (V.parentLoading) return;
  if (V.parentAccts && !force) return;
  V.parentLoading = true;
  renderApp();
  listAccounts().then(list => {
    V.allAccts = list;
    V.parentAccts = list.filter(a => a.status === 'active' && (a.rec.roles || []).some(r => isBaseRole(r, 'parent')));
    V.parentErr = '';
  }).catch(e => {
    V.parentAccts = [];
    V.parentErr = '학부모 계정을 불러오지 못했습니다: ' + ((e && e.message) || e);
  }).then(() => { V.parentLoading = false; renderApp(); });
}
function parentInDept(a, deptId) {
  const ds = accountDeptIds(a);
  if (!ds.length) return true;
  if (ds.indexOf(deptId) >= 0) return true;
  return kidsOfAccount(a).some(s => s.deptId === deptId);
}
function unlinkedParents(deptId) {
  return (V.parentAccts || []).filter(a => parentInDept(a, deptId)).filter(a => kidsOfAccount(a).length === 0);
}
function linkedParents(deptId) {
  return (V.parentAccts || []).filter(a => parentInDept(a, deptId)).filter(a => kidsOfAccount(a).length > 0);
}
function studentsWithoutParent(deptId) {
  return studentsOfDept(deptId).filter(s => !s.guardianUid);
}

function childLinkCard(deptId) {
  if (!V.parentAccts && !V.parentLoading) loadParentAccounts();
  let h = '<div class="card" style="margin-top:12px;border:1.5px solid #ffd9cd;background:#fff9f6">';
  h += '<h3>👨‍👩‍👧 자녀 연결 <span class="sp"></span>';
  if (!V.parentAccts) h += '<small>불러오는 중…</small>';
  else h += '<small>미연결 학부모 ' + unlinkedParents(deptId).length + '명 · 보호자 미연결 아동 ' + studentsWithoutParent(deptId).length + '명</small>';
  h += '</h3>';
  if (V.parentErr) h += '<div class="banner coral">' + esc(V.parentErr) + '</div>';
  h += '<p class="hint" style="margin:0 0 8px">학부모가 자녀를 등록해도 교사·교육부서담당이 여기서 연결해 주어야 학부모 화면에 자녀가 나타납니다.</p>';
  h += '<div class="row wrap" style="gap:6px"><button class="btn primary sm" data-act="child-link" data-dept="' + esc(deptId) + '">자녀 연결·변경</button>';
  h += '<button class="btn sm ghost" data-act="birth-sync" data-dept="' + esc(deptId) + '">🎂 생일 일정 맞추기</button></div>';
  h += '</div>';
  return h;
}

function childLinkModal(opts) {
  opts = opts || {};
  const deptId = opts.deptId || V.dept;
  if (!V.parentAccts) { loadParentAccounts(true); return toast('학부모 계정을 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요', 'err'); }

  /* 부모 한 명 → 자녀 고르기 */
  if (opts.uid) {
    const a = (V.parentAccts || []).find(x => x.uid === opts.uid);
    if (!a) return toast('학부모 계정을 찾지 못했습니다', 'err');
    const cur = kidsOfAccount(a).map(s => s.id);
    V.childEdit = { uid: a.uid, sids: cur.slice() };
    let h = '<div class="banner sky"><b>' + esc(a.rec.name) + '</b> (@' + esc(a.rec.id) + ') 님의 자녀를 골라 주세요.</div>';
    h += '<div class="field"><label>학생 (여러 명 선택 가능)</label><div class="row wrap" style="gap:6px">';
    const vis = visibleDepts().map(d => d.id);
    const list = (S.state.students || []).filter(s => !s._del && inYear(s) && vis.indexOf(s.deptId) >= 0);
    if (!list.length) h += '<span class="muted">등록된 학생이 없습니다. 반·학생에서 먼저 등록하세요.</span>';
    list.forEach(s => {
      const on = V.childEdit.sids.indexOf(s.id) >= 0;
      const d = deptById(s.deptId) || {};
      h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="child-pick" data-sid="' + esc(s.id) + '">' + esc(s.name) + ' <span style="opacity:.7">' + esc((d.name || '') + ' ' + ((classById(s.classId) || {}).name || '')) + '</span></button>';
    });
    h += '</div><div class="hint">이미 다른 학부모에게 연결된 아동도 여기서 옮길 수 있습니다.</div></div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="child-save" data-uid="' + esc(a.uid) + '">연결 저장</button></div>';
    openModal('자녀 연결', h);
    return;
  }

  /* 학생 한 명 → 학부모 고르기 */
  if (opts.sid) {
    const s = (S.state.students || []).find(x => x.id === opts.sid);
    if (!s) return toast('학생을 찾지 못했습니다', 'err');
    let h = '<div class="banner sky"><b>' + esc(s.name) + '</b> · ' + esc((deptById(s.deptId) || {}).name || '') + ' ' + esc((classById(s.classId) || {}).name || '') + '</div>';
    h += '<div class="field"><label>학부모 계정</label><div class="row wrap" style="gap:6px">';
    const sdept = s.deptId;
    const list = (V.parentAccts || []).filter(a => {
      const ds = accountDeptIds(a);
      return !ds.length || ds.indexOf(sdept) >= 0 || s.guardianUid === a.uid;
    });
    if (!list.length) h += '<span class="muted">학부모 계정이 없습니다. 가입 승인에서 학부모 가입을 먼저 승인하세요.</span>';
    list.forEach(a => {
      const on = s.guardianUid === a.uid;
      h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="child-set" data-sid="' + esc(s.id) + '" data-uid="' + esc(a.uid) + '">' + esc(a.rec.name) + ' <span style="opacity:.7">@' + esc(a.rec.id) + '</span></button>';
    });
    h += '</div></div>';
    if (s.guardianUid) h += '<button class="btn block" style="color:#c33e5f" data-act="child-clear" data-sid="' + esc(s.id) + '">연결 해제</button>';
    h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">닫기</button></div>';
    openModal('학부모 연결', h);
    return;
  }

  /* 부서 → 미연결 학부모 / 보호자 미연결 아동 */
  const un = unlinkedParents(deptId);
  const watch = studentsWithoutParent(deptId);
  let h = '<div class="banner sky">' + esc((deptById(deptId) || {}).name || '') + ' · 자녀가 연결되지 않은 학부모와 보호자 계정이 없는 아동입니다.</div>';
  h += '<div class="sect-title">자녀 미연결 학부모 ' + un.length + '명</div>';
  if (!un.length) h += '<div class="card flat"><p class="muted" style="margin:0">모두 연결되었습니다. 👍</p></div>';
  else {
    h += '<div class="list">';
    un.forEach(a => {
      h += '<button class="item" data-act="child-link" data-uid="' + esc(a.uid) + '"><span class="av">' + esc((a.rec.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(a.rec.name) + '</b><span>@' + esc(a.rec.id) + ' · ' + esc((a.rec.depts || []).map(d => (deptById(d) || {}).name).filter(Boolean).join(', ') || '부서 미지정') + '</span></span><span class="rt"><span class="chip coral">연결하기</span></span></button>';
    });
    h += '</div>';
  }
  h += '<div class="sect-title">보호자 계정이 없는 아동 ' + watch.length + '명</div>';
  if (!watch.length) h += '<div class="card flat"><p class="muted" style="margin:0">모두 연결되었습니다. 👍</p></div>';
  else {
    h += '<div class="list">';
    watch.forEach(s => {
      h += '<button class="item" data-act="child-link" data-sid="' + esc(s.id) + '"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + '</b><span>' + esc((classById(s.classId) || {}).name || '반 미지정') + ' · 보호자 ' + esc(s.guardianName || '미등록') + (s.guardianPhone ? ' · ' + esc(s.guardianPhone) : '') + '</span></span><span class="rt"><span class="chip amber">학부모 고르기</span></span></button>';
    });
    h += '</div>';
  }
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="modal-close">닫기</button></div>';
  openModal('자녀 연결', h);
}

async function saveChildLinks(uid, sids) {
  const a = (V.parentAccts || []).find(x => x.uid === uid);
  if (!a) throw new Error('학부모 계정을 찾지 못했습니다');
  const nm = a.rec.name;
  const prev = kidsOfAccount(a).map(s => s.id);
  const add = sids.filter(id => prev.indexOf(id) < 0);
  const remove = prev.filter(id => sids.indexOf(id) < 0);
  const depts = new Set(accountDeptIds(a));
  const students = (S.state.students || []);
  for (const id of add) {
    const s = students.find(x => x.id === id);
    if (!s) continue;
    const old = s.guardianUid;
    s.guardianUid = uid;
    if (!s.guardianName) s.guardianName = nm;
    if (s.deptId) depts.add(s.deptId);
    touch(s);
    if (old && old !== uid) {
      /* 이전 학부모의 목록에서 빼기 */
      try {
        await updateAccountRec(old, rec => { rec.students = (rec.students || []).filter(x => x !== id); });
      } catch (e) { /* 이전 계정을 못 고쳐도 새 연결은 유지 */ }
    }
  }
  remove.forEach(id => {
    const s = students.find(x => x.id === id);
    if (s && s.guardianUid === uid) { s.guardianUid = ''; touch(s); }
  });
  await updateAccountRec(uid, rec => {
    rec.students = sids.slice();
    rec.depts = Array.from(new Set([].concat(rec.depts || [], Array.from(depts))));
  });
  syncBirthEventOf('account', uid, a.rec, Array.from(depts));
  await Sync.save();
  await loadParentAccounts(true);
  return { added: add.length, removed: remove.length };
}

/* ================= 2·9. 교사 담임·권한 관리 ================= */
function loadStaffAccounts(force) {
  if (V.staffLoading) return;
  if (V.staffAccts && !force) return;
  V.staffLoading = true;
  renderApp();
  listAccounts().then(list => {
    V.staffAll = list;
    V.staffAccts = list.filter(a => a.status === 'active' && (a.rec.roles || []).some(r => isBaseRole(r, 'teacher')));
    V.staffErr = '';
  }).catch(e => {
    V.staffAccts = [];
    V.staffErr = '교사 계정을 불러오지 못했습니다: ' + ((e && e.message) || e);
  }).then(() => { V.staffLoading = false; renderApp(); });
}

function staffView() {
  if (!can('staff.manage')) return '<div class="card">' + emptyBox('🔒', '교사 담임·권한을 지정할 권한이 없습니다') + '</div>';
  if (!V.staffAccts && !V.staffLoading) loadStaffAccounts();
  let h = subHead('교사·권한 관리', '교사의 담임 반과 일정·회계·주일보고 권한을 지정합니다',
    '<button class="btn sm" data-act="staff-reload">↻ 새로고침</button>');
  if (V.staffErr) h += '<div class="banner coral">' + esc(V.staffErr) + '</div>';
  if (!V.staffAccts) return h + '<div class="card"><p class="muted" style="margin:0">교사 계정을 불러오는 중…</p></div>';

  const depts = visibleDepts();
  if (!V.staffDept || !depts.some(d => d.id === V.staffDept)) V.staffDept = depts.length ? depts[0].id : '';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">' + depts.map(d => '<button class="chip big ' + (d.id === V.staffDept ? 'coral' : 'gray') + '" data-act="staff-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div>';

  const list = (V.staffAccts || []).filter(a => {
    const ds = accountDeptIds(a);
    if (!ds.length) return true;
    return ds.indexOf(V.staffDept) >= 0;
  });
  if (!list.length) h += '<div class="card">' + emptyBox('🧑‍🏫', '이 부서에 등록된 교사가 없습니다', '가입 승인에서 교사 가입을 승인하면 여기에 나타납니다') + '</div>';
  list.forEach(a => {
    const rec = a.rec;
    const cls = accountClasses(a).map(id => (classById(id) || {}).name).filter(Boolean);
    const gr = Object.keys(rec.grants || {}).filter(k => rec.grants[k]).map(k => (PERM_LABELS.find(x => x[0] === k) || [k, k])[1]);
    h += '<div class="card"><h3>' + esc(rec.name) + ' <small>@' + esc(rec.id) + ' · ' + esc((rec.depts || []).map(d => (deptById(d) || {}).name).filter(Boolean).join(', ') || '부서 미지정') + '</small><span class="sp"></span><button class="btn sm primary" data-act="staff-edit" data-uid="' + esc(a.uid) + '">지정</button></h3>';
    h += '<div class="kv"><span>담임 반</span><b>' + (cls.length ? esc(cls.join(', ')) : '<span class="chip amber">미지정</span>') + '</b></div>';
    h += '<div class="kv"><span>위임 권한</span><b>' + (gr.length ? esc(gr.join(', ')) : '-') + '</b></div>';
    h += '<div class="kv"><span>계정 상태</span><b>' + (accountStatusChip(rec) || '<span class="chip mint">정상</span>') + ' <button class="btn sm" data-act="acct-status" data-uid="' + esc(a.uid) + '">상태 변경</button></b></div>';
    h += '</div>';
  });

  const pend = (V.staffAll || []).filter(a => a.status !== 'active' && ((a.rec && a.rec.roles) || (a.app && a.app.roles) || []).some(r => isBaseRole(r, 'teacher')));
  if (pend.length) {
    h += '<div class="sect-title">아직 첫 로그인 전인 교사</div><div class="list">';
    pend.forEach(a => { h += '<div class="item"><span class="av">⏳</span><span class="tx"><b>' + esc((a.app && a.app.name) || a.rec.name) + '</b><span>본인이 한 번 로그인하면 담임·권한을 지정할 수 있습니다</span></span></div>'; });
    h += '</div>';
  }
  h += '<p class="muted" style="margin-top:12px">담임 반을 지정하면 그 교사의 반·학생 화면에 바로 나타나고, 위임한 권한의 탭(일정·회계·주일보고 등)이 열립니다. 교사 기기에는 30초 안에 자동 반영됩니다.</p>';
  return h;
}

function staffEditModal(uid) {
  const a = (V.staffAccts || []).find(x => x.uid === uid);
  if (!a) return;
  const depts = visibleDepts();
  const myDeptIds = depts.map(d => d.id);
  const recDepts = accountDeptIds(a).filter(d => myDeptIds.indexOf(d) >= 0);
  V.staffEdit = {
    uid: uid,
    depts: recDepts.length ? recDepts.slice() : (V.staffDept ? [V.staffDept] : []),
    classes: accountClasses(a).slice(),
    grants: Object.assign({}, a.rec.grants || {})
  };
  let h = '<div class="banner sky"><b>' + esc(a.rec.name) + '</b> (@' + esc(a.rec.id) + ')</div>';
  h += '<div class="field"><label>담당 부서</label><div class="row wrap" style="gap:6px">' + depts.map(d => '<button type="button" class="chip big ' + (V.staffEdit.depts.indexOf(d.id) >= 0 ? 'coral' : 'gray') + '" data-act="staff-deptsel" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div></div>';

  const cls = (S.state.classes || []).filter(c => !c._del && inYear(c) && (V.staffEdit.depts.length ? V.staffEdit.depts.indexOf(c.deptId) >= 0 : myDeptIds.indexOf(c.deptId) >= 0));
  h += '<div class="field"><label>담임 반 (여러 반 가능)</label><div class="row wrap" style="gap:6px">';
  if (!cls.length) h += '<span class="muted">이 부서에 반이 없습니다. 반·학생에서 반을 먼저 만드세요.</span>';
  cls.forEach(c => {
    const on = V.staffEdit.classes.indexOf(c.id) >= 0;
    h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="staff-class" data-id="' + esc(c.id) + '">' + esc((deptById(c.deptId) || {}).name || '') + ' ' + esc(c.name) + '</button>';
  });
  h += '</div></div>';

  h += '<div class="field"><label>위임 권한</label><div class="row wrap" style="gap:6px">';
  const bases = (a.rec.roles || []).map(k => roleDef(k).base);
  const baseKey = bases.find(x => x === 'edu') || bases.find(x => x === 'teacher') || 'teacher';
  const baseP = BASE_PERMS[baseKey] || {};
  const deleg = DELEGABLE_PERMS.filter(p => !baseP[p[0]]);
  deleg.forEach(p => {
    const on = !!V.staffEdit.grants[p[0]];
    h += '<button type="button" class="chip big ' + (on ? 'mint' : 'gray') + '" data-act="staff-perm" data-key="' + esc(p[0]) + '">' + esc(p[1]) + '</button>';
  });
  if (!deleg.length) h += '<span class="muted">이 계정은 이미 모든 권한을 가지고 있습니다.</span>';
  h += '</div><div class="hint">체크한 권한의 탭이 교사 화면에 열립니다. 주일보고 확인·사용자 관리 같은 관리자 권한은 위임되지 않습니다.</div></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="staff-save" data-uid="' + esc(uid) + '">저장</button></div>';
  openModal('교사 담임·권한 지정', h);
}

async function saveStaffEdit(uid) {
  const e = V.staffEdit;
  if (!e) return;
  try {
    const mine = visibleDepts().map(d => d.id);
    for (const cid of e.classes) { const c = classById(cid); if (c && e.depts.indexOf(c.deptId) < 0) e.depts.push(c.deptId); }
    await updateAccountRec(uid, rec => {
      /* 내가 볼 수 없는 부서·반은 지우지 않고 그대로 둔다 */
      const keepDepts = (rec.depts || []).filter(d => mine.indexOf(d) < 0);
      rec.depts = Array.from(new Set(keepDepts.concat(e.depts)));
      const keepCls = (rec.classes || []).filter(cid => { const c = classById(cid); return !c || e.classes.indexOf(cid) < 0; });
      rec.classes = Array.from(new Set(keepCls.concat(e.classes)));
      rec.grants = Object.assign({}, e.grants);
    }).then(rec => {
      /* 생일 일정도 옮겨 간 부서에 보이게 */
      if (rec) syncBirthEventOf('account', uid, rec, rec.depts || []);
    });
    if (uid === S.me.uid) {
      S.me.depts = e.depts.slice(); S.me.classes = e.classes.slice(); S.me.grants = Object.assign({}, e.grants);
      saveSession();
    }
    refreshClassTeacherNames();
    await Sync.save();
    closeModal();
    V.staffAccts = null;
    V.staffEdit = null;
    toast('저장했습니다. 교사 기기에 곧 반영됩니다', 'ok');
    await loadStaffAccounts(true);
    renderApp();
  } catch (err) {
    toast((err && err.message) || '저장하지 못했습니다', 'err');
  }
}

/* 반 카드에 담당 교사 이름 표시 */
function refreshClassTeacherNames() {
  const accts = (V.staffAccts || V.allAccts || []);
  (S.state.classes || []).forEach(c => {
    if (c._del) return;
    const names = accts.filter(a => a.status === 'active' && accountClasses(a).indexOf(c.id) >= 0).map(a => a.rec.name);
    const now = names.join(', ');
    if ((c.teacherNames || []).join(', ') !== now) { c.teacherNames = names; touch(c); }
  });
}

/* ================= 5·7. 생일 일정 일괄 맞추기 ================= */
function birthSyncAll(deptId) {
  let n = 0;
  studentsOfDept(deptId).forEach(s => {
    if (s.birth) { syncBirthEventOf('student', s.personId || s.id, s, s.deptId || deptId); n++; }
  });
  (V.parentAccts || []).forEach(a => {
    if (!a.rec.birth) return;
    if (!parentInDept(a, deptId)) return;
    const ds = accountDeptIds(a).length ? accountDeptIds(a) : [deptId];
    syncBirthEventOf('account', a.uid, a.rec, ds);
    n++;
  });
  Sync.save().then(() => {
    renderApp();
    toast('생일 ' + n + '건을 부서 일정에 맞췄습니다', 'ok');
  });
}

/* ================= 7. 아동 명단 양식 · 일괄 업로드 ================= */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function rosterTemplateCsv(deptId) {
  const d = deptById(deptId) || {};
  const cname = (classesOfDept(deptId)[0] || {}).name || ((d.name || '부서') + ' 1반');
  const rows = [
    ['반명', '이름', '생년월일', '성별', '보호자', '연락처', '메모'],
    [cname, '홍길동', '2016-03-05', '남', '홍보호', '010-0000-0000', '예시 줄입니다. 지우고 쓰세요']
  ];
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function normBirthCell(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
  }
  m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) {
    const y = new Date().getFullYear() - 7;
    return y + '-' + pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  }
  return '';
}
function genderCell(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['남', '남자', 'm', 'male', 'boy'].indexOf(s) >= 0) return 'm';
  if (['여', '여자', 'f', 'female', 'girl'].indexOf(s) >= 0) return 'f';
  return '';
}
function parseCsvText(text) {
  const s = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (ch === '\r') { /* skip */ }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
async function parseXlsxRows(buf) {
  const zi = zipEntries(buf);
  const readName = async nm => {
    const e = zi.list.find(x => x.name.toLowerCase() === String(nm).toLowerCase());
    if (!e) return null;
    return new TextDecoder('utf-8').decode(await zipRead(zi, e));
  };
  const parser = new DOMParser();
  let shared = [];
  const ss = await readName('xl/sharedStrings.xml');
  if (ss) {
    const doc = parser.parseFromString(ss, 'application/xml');
    shared = Array.prototype.slice.call(doc.getElementsByTagName('*'))
      .filter(e => String(e.nodeName).split(':').pop() === 'si')
      .map(si => Array.prototype.slice.call(si.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 't').map(t => t.textContent || '').join(''));
  }
  let sheet = await readName('xl/worksheets/sheet1.xml');
  if (!sheet) {
    const nm = zi.list.map(e => e.name).find(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
    if (nm) sheet = await readName(nm);
  }
  if (!sheet) throw new Error('엑셀 시트를 찾지 못했습니다. .xlsx 파일인지 확인해 주세요.');
  const doc = parser.parseFromString(sheet, 'application/xml');
  const rowEls = Array.prototype.slice.call(doc.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'row');
  const out = [];
  rowEls.forEach(re => {
    const cells = Array.prototype.slice.call(re.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'c');
    const arr = [];
    cells.forEach(c => {
      const ref = c.getAttribute('r') || '';
      const m = ref.match(/^([A-Z]+)/);
      let ci = arr.length;
      if (m) { ci = 0; for (const ch of m[1]) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1; }
      const t = c.getAttribute('t');
      let v = '';
      if (t === 'inlineStr') {
        v = Array.prototype.slice.call(c.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 't').map(x => x.textContent || '').join('');
      } else {
        const ve = Array.prototype.slice.call(c.getElementsByTagName('*')).find(e => String(e.nodeName).split(':').pop() === 'v');
        v = ve ? (ve.textContent || '') : '';
        if (t === 's') v = shared[Number(v)] || '';
      }
      arr[ci] = v;
    });
    if (arr.some(x => String(x || '').trim())) out.push(arr);
  });
  return out;
}
function rosterRowsToItems(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(c => String(c || '').trim());
  const looksHeader = head.some(c => /이름|반명|생년|생일|보호자|연락/.test(c));
  const idx = { cls: -1, name: -1, birth: -1, gender: -1, guardian: -1, phone: -1, note: -1 };
  if (looksHeader) {
    const find = re => head.findIndex(c => re.test(c));
    idx.cls = find(/반/); idx.name = find(/이름|성명/); idx.birth = find(/생년|생일|생월/);
    idx.gender = find(/성별/); idx.guardian = find(/보호자|학부모|부모/); idx.phone = find(/연락|전화|휴대/); idx.note = find(/메모|비고/);
  } else {
    idx.cls = 0; idx.name = 1; idx.birth = 2; idx.gender = 3; idx.guardian = 4; idx.phone = 5; idx.note = 6;
  }
  const out = [];
  rows.slice(looksHeader ? 1 : 0).forEach(r => {
    const name = idx.name >= 0 ? String(r[idx.name] || '').trim() : '';
    if (!name) return;
    out.push({
      className: idx.cls >= 0 ? String(r[idx.cls] || '').trim() : '',
      name: name,
      birth: idx.birth >= 0 ? normBirthCell(r[idx.birth]) : '',
      gender: idx.gender >= 0 ? genderCell(r[idx.gender]) : '',
      guardianName: idx.guardian >= 0 ? String(r[idx.guardian] || '').trim() : '',
      guardianPhone: idx.phone >= 0 ? String(r[idx.phone] || '').trim() : '',
      note: idx.note >= 0 ? String(r[idx.note] || '').trim() : ''
    });
  });
  return out;
}
async function rosterPick(deptId) {
  fileInput('.csv,.xlsx', async f => {
    try {
      toast('명단을 읽는 중…');
      const low = String(f.name || '').toLowerCase();
      let rows = [];
      if (/\.xlsx$/.test(low)) rows = await parseXlsxRows(await readFileBytes(f));
      else rows = parseCsvText(await f.text());
      const items = rosterRowsToItems(rows);
      if (!items.length) return toast('명단에서 아동 이름을 찾지 못했습니다. 양식(반명·이름·생년월일…)을 확인해 주세요', 'err');
      V.rosterItems = items;
      V.rosterName = f.name;
      V.rosterDept = deptId;
      rosterPreviewModal(f.name, deptId);
    } catch (e) {
      toast((e && e.message) || '명단을 읽지 못했습니다', 'err');
    }
  });
}
function rosterPreviewModal(fname, deptId) {
  const items = V.rosterItems || [];
  const dept = deptById(deptId) || {};
  let h = '<div class="banner sky">' + esc(fname) + ' · ' + items.length + '명을 읽었습니다. ' + esc(dept.name || '') + '에 넣을까요?</div>';
  h += '<div class="tbl-wrap" style="max-height:44vh"><table class="tbl"><thead><tr><th>반</th><th>이름</th><th>생일</th><th>성별</th><th>보호자</th><th>연락처</th></tr></thead><tbody>';
  items.forEach(it => {
    h += '<tr><td>' + esc(it.className || '-') + '</td><td>' + esc(it.name) + '</td><td>' + esc(it.birth ? it.birth.replace(/-/g, '.') : '⚠ 없음') + '</td><td>' + esc(it.gender === 'm' ? '남' : it.gender === 'f' ? '여' : '') + '</td><td>' + esc(it.guardianName || '') + '</td><td>' + esc(it.guardianPhone || '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<p class="hint">같은 반·이름(생일)은 새로 만들지 않고 고칩니다. 생년월일이 있으면 부서 일정에 🎂 생일이 자동 등록됩니다.</p>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="roster-apply" data-dept="' + esc(deptId) + '">' + items.length + '명 명단에 넣기</button></div>';
  openModal('아동 명단 미리보기', h);
}
async function applyRoster(deptId) {
  const items = V.rosterItems || [];
  if (!items.length) return;
  let made = 0, updated = 0, classesMade = 0, births = 0;
  for (const it of items) {
    let clsId = '';
    if (it.className) {
      let c = classesOfDept(deptId).find(x => x.name === it.className)
        || classesOfDept(deptId).find(x => x.name.indexOf(it.className) >= 0 || it.className.indexOf(x.name) >= 0);
      if (!c) {
        c = { id: 'cl-' + Crypto.uid(), name: it.className, deptId: deptId, note: '명단 업로드로 만든 반', year: curYear(), order: (S.state.classes || []).length + 1, u: Date.now() };
        S.state.classes.push(c);
        classesMade++;
      }
      clsId = c.id;
    }
    let s = (S.state.students || []).find(x => !x._del && inYear(x) && x.deptId === deptId && x.name === it.name && ((it.birth && x.birth === it.birth) || (!it.birth && !x.birth)))
      || (S.state.students || []).find(x => !x._del && inYear(x) && x.deptId === deptId && x.name === it.name);
    if (!s) {
      s = { id: 'st-' + Crypto.uid(), name: it.name, deptId: deptId, year: curYear(), active: true, joined: ymd(), u: Date.now() };
      S.state.students.push(s);
      made++;
    } else updated++;
    s.name = it.name;
    if (it.birth) s.birth = it.birth;
    if (it.gender) s.gender = it.gender;
    if (it.guardianName) s.guardianName = it.guardianName;
    if (it.guardianPhone) s.guardianPhone = it.guardianPhone;
    if (it.note) s.note = it.note;
    if (clsId) s.classId = clsId;
    s._del = false;
    touch(s);
    if (s.birth) { syncBirthEventOf('student', s.personId || s.id, s, deptId); births++; }
  }
  await Sync.save();
  closeModal();
  V.rosterItems = null;
  renderApp();
  let msg = made + '명 새로 등록';
  if (updated) msg += ' · ' + updated + '명 갱신';
  if (classesMade) msg += ' · 반 ' + classesMade + '개 생성';
  if (births) msg += ' · 생일 ' + births + '건 일정 등록';
  toast(msg, 'ok');
}

/* ================= 10·11. 연간 출석부 ================= */
function annualData(year, deptIds) {
  const sundays = sundaysOfYear(year);
  const deptOrder = {};
  (S.state.departments || []).forEach((d, i) => { deptOrder[d.id] = d.order || i; });
  const studs = [];
  (deptIds || []).forEach(did => studentsOfDeptIn(did, year).forEach(s => studs.push(s)));
  studs.sort((a, b) => {
    const da = deptOrder[a.deptId] || 0, db = deptOrder[b.deptId] || 0;
    if (da !== db) return da - db;
    const ca = classById(a.classId), cb = classById(b.classId);
    const oa = ca ? (ca.order || 0) : 999, ob = cb ? (cb.order || 0) : 999;
    if (oa !== ob) return oa - ob;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
  const map = {};
  (S.state.attendance || []).forEach(a => { if (!a._del && a.studentId) map[a.date + '|' + a.studentId] = a.status; });
  return { sundays: sundays, studs: studs, map: map };
}
function attMark(st) { return st === 'present' ? '출' : st === 'absent' ? '결' : st === 'excused' ? '인' : ''; }
function annualSheetHtml(opts) {
  opts = opts || {};
  const year = opts.year || statYear();
  const deptIds = opts.deptIds || [];
  const showDept = !!opts.showDept;
  const data = annualData(year, deptIds);
  let h = '<div class="card"><h3>📅 ' + year + '년 연간 출석부 <span class="sp"></span><small>' + data.studs.length + '명 · 주일 ' + data.sundays.length + '회</small></h3>';
  if (!data.studs.length) return h + '<p class="muted" style="margin:0">등록된 아동이 없습니다.</p></div>';
  h += '<p class="muted" style="margin:0 0 8px">출·결·인 / 빈칸은 미기록입니다. 표를 옆으로 밀어서 보세요.</p>';
  h += '<div class="tbl-wrap"><table class="tbl annual"><thead><tr>';
  if (showDept) h += '<th>부서</th>';
  h += '<th>반명</th><th>이름</th><th>생일</th>';
  data.sundays.forEach(d => { h += '<th class="sun">' + esc(fmtShort(d)) + '</th>'; });
  h += '</tr></thead><tbody>';
  data.studs.forEach(s => {
    h += '<tr>';
    if (showDept) h += '<td>' + esc((deptById(s.deptId) || {}).name || '') + '</td>';
    h += '<td>' + esc((classById(s.classId) || {}).name || '-') + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.birth ? birthShort(s.birth) : '-') + '</td>';
    data.sundays.forEach(d => {
      const st = data.map[d + '|' + s.id];
      h += '<td class="sun att-' + (st || 'none') + '">' + attMark(st) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div></div>';
  return h;
}
function annualCsv() {
  const year = statYear();
  const depts = visibleDepts();
  const allMode = V.statDept === '' && canSeeAllDepts();
  const deptIds = allMode ? depts.map(d => d.id) : [V.statDept];
  const data = annualData(year, deptIds);
  const head = ['부서', '반명', '이름', '생일'].concat(data.sundays);
  const lines = [head.map(csvCell).join(',')];
  data.studs.forEach(s => {
    const row = [(deptById(s.deptId) || {}).name || '', (classById(s.classId) || {}).name || '', s.name, s.birth || ''];
    data.sundays.forEach(d => row.push(attMark(data.map[d + '|' + s.id])));
    lines.push(row.map(csvCell).join(','));
  });
  const label = allMode ? '전체부서' : ((deptById(V.statDept) || {}).name || '부서');
  downloadFile(year + '년_연간출석부_' + label + '.csv', '\ufeff' + lines.join('\r\n') + '\r\n');
  toast('연간 출석부를 내려받았습니다', 'ok');
}
function annualTableHtml(data, showDept) {
  let h = '<table><thead><tr>';
  if (showDept) h += '<th>부서</th>';
  h += '<th>반명</th><th>이름</th><th>생일</th>';
  data.sundays.forEach(d => { h += '<th class="sun">' + esc(fmtShort(d)) + '</th>'; });
  h += '</tr></thead><tbody>';
  data.studs.forEach(s => {
    h += '<tr>';
    if (showDept) h += '<td>' + esc((deptById(s.deptId) || {}).name || '') + '</td>';
    h += '<td>' + esc((classById(s.classId) || {}).name || '-') + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.birth ? birthShort(s.birth) : '-') + '</td>';
    data.sundays.forEach(d => { h += '<td class="sun">' + attMark(data.map[d + '|' + s.id]) + '</td>'; });
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}
function printAnnual() {
  const year = statYear();
  const depts = visibleDepts();
  const allMode = V.statDept === '' && canSeeAllDepts();
  const deptIds = allMode ? depts.map(d => d.id) : [V.statDept];
  const data = annualData(year, deptIds);
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연간 출석부</title><style>@page{size:A4 landscape;margin:8mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;padding:10px;color:#222}h1{font-size:16px;text-align:center;margin:0 0 2px}h2{font-size:11px;color:#777;text-align:center;margin:0 0 10px;font-weight:600}' +
    'table{border-collapse:collapse;width:100%;font-size:7.5px}th,td{border:1px solid #999;padding:2px 3px;text-align:left;white-space:nowrap}th{background:#f2eeea}td.sun,th.sun{text-align:center;font-size:7px}' +
    '</style></head><body><h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 연간 출석부</h1><h2>' + year + '년 · ' + (allMode ? '전체 부서' : esc((deptById(V.statDept) || {}).name || '')) + ' · ' + data.studs.length + '명</h2>' +
    annualTableHtml(data, allMode) +
    '<p style="font-size:8px;color:#999;text-align:center;margin-top:8px">덕신교회 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}
function printIntegratedStats() {
  const ym = statState();
  const depts = visibleDepts();
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  const rowsAll = (S.state.attendance || []).filter(a => !a._del && !a.staff && monthKeyOf(a.date) === ym && depts.some(d => d.id === a.deptId));
  let body = '';
  depts.forEach(d => {
    const rs = rowsAll.filter(a => a.deptId === d.id);
    const p = rs.filter(a => a.status === 'present').length, ab = rs.filter(a => a.status === 'absent').length, ex = rs.filter(a => a.status === 'excused').length;
    const t = p + ab + ex;
    body += '<tr><td>' + esc(d.name) + '</td><td class="num">' + studentsOfDept(d.id).length + '</td><td class="num">' + p + '</td><td class="num">' + ab + '</td><td class="num">' + ex + '</td><td class="num">' + (t ? Math.round(((p + ex) / t) * 100) : 0) + '%</td></tr>';
  });
  const data = annualData(statYear(), depts.map(d => d.id));
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>교육부서 통합 출석</title><style>@page{size:A4 landscape;margin:8mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;padding:10px;color:#222}h1{font-size:16px;text-align:center;margin:0 0 2px}h2{font-size:11px;color:#777;text-align:center;margin:0 0 10px;font-weight:600}' +
    'table{border-collapse:collapse;width:100%;font-size:8px;margin-bottom:14px}th,td{border:1px solid #999;padding:3px 4px;text-align:left;white-space:nowrap}th{background:#f2eeea}td.num{text-align:right}' +
    'h3{font-size:12px;margin:14px 0 4px}</style></head><body>' +
    '<h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 통합 출석</h1><h2>' + esc(monthLabel(ym)) + ' · 전체 부서</h2>' +
    '<table><thead><tr><th>부서</th><th>재적</th><th>출석</th><th>결석</th><th>인정</th><th>출석률</th></tr></thead><tbody>' + body + '</tbody></table>' +
    '<h3>' + statYear() + '년 연간 통합 출결표</h3>' + annualTableHtml(data, true) +
    '<p style="font-size:8px;color:#999;text-align:center;margin-top:8px">덕신교회 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}
function printStatsSafe() {
  if (V.statView === 'annual') return printAnnual();
  if (V.statDept === '' && canSeeAllDepts()) return printIntegratedStats();
  return printStats();
}

/* ================= 8. 주일보고 반려 ================= */
async function rejectReport(id) {
  const reason = val('rjReason');
  if (!reason) return toast('반려 사유를 적어 주세요', 'err');
  const r = (S.state.reports || []).find(x => x.id === id);
  if (!r) return;
  r.status = 'rejected';
  r.rejectReason = reason;
  r.rejectedAt = Date.now();
  r.rejectedBy = S.me.uid;
  r.rejectedByName = S.me.name;
  if (r.reopen) { r.reopen.done = true; r.reopen.doneAt = Date.now(); }
  touch(r);
  await Sync.save();
  closeModal();
  renderApp();
  toast('반려했습니다. 교육부서담당이 고쳐 다시 제출할 수 있습니다', 'ok');
}

/* ================= 동작 연결 ================= */
document.addEventListener('input', function (ev) {
  const t = ev.target;
  if (!t || !t.id) return;
  if (t.id === 'msgText' || t.id === 'msgPhone') {
    const a = document.getElementById('msgSms');
    if (a) a.setAttribute('href', smsHref(msgTextOf('msgPhone'), msgTextOf('msgText')));
  }
});

document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      /* --- 출결 문자/카톡 --- */
      case 'toggle-auto-msg': V.autoMsg = !V.autoMsg; renderApp(); toast(V.autoMsg ? '출결 문자/카톡 바로 열기를 켰습니다' : '껐습니다', 'ok'); return;
      case 'msg-student': {
        const s = (S.state.students || []).find(x => x.id === t.dataset.sid);
        if (!s) return;
        messageModal({ student: s, text: '' });
        return;
      }
      case 'msg-kakao': await shareText(msgTextOf('msgText')); return;
      case 'msg-copy': copyText(msgTextOf('msgText')); return;

      /* --- 학부모–자녀 연결 --- */
      case 'child-link':
        closeModal();
        childLinkModal(t.dataset.uid ? { uid: t.dataset.uid } : t.dataset.sid ? { sid: t.dataset.sid } : { deptId: t.dataset.dept || V.dept });
        return;
      case 'child-pick': {
        if (!V.childEdit) return;
        toggleIn(V.childEdit.sids, t.dataset.sid);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        return;
      }
      case 'child-save': {
        try {
          const res = await saveChildLinks(t.dataset.uid, (V.childEdit || {}).sids || []);
          closeModal();
          toast('자녀 연결을 저장했습니다' + (res.added ? ' (+' + res.added + ')' : '') + (res.removed ? ' (-' + res.removed + ')' : ''), 'ok');
        } catch (e) { toast((e && e.message) || '연결하지 못했습니다', 'err'); }
        return;
      }
      case 'child-set': {
        const sid = t.dataset.sid, uid = t.dataset.uid;
        const s = (S.state.students || []).find(x => x.id === sid);
        if (!s) return;
        try {
          const a = (V.parentAccts || []).find(x => x.uid === uid);
          if (!a) return;
          const cur = kidsOfAccount(a).map(x => x.id);
          if (cur.indexOf(sid) < 0) cur.push(sid);
          await saveChildLinks(uid, cur);
          closeModal();
          toast(s.name + ' → ' + a.rec.name + ' 연결했습니다', 'ok');
        } catch (e) { toast((e && e.message) || '연결하지 못했습니다', 'err'); }
        return;
      }
      case 'child-clear': {
        const sid = t.dataset.sid;
        const s = (S.state.students || []).find(x => x.id === sid);
        if (!s) return;
        const uid = s.guardianUid;
        confirmBox('연결 해제', s.name + ' 아동의 학부모 연결을 끊을까요?', '해제', async () => {
          s.guardianUid = ''; touch(s);
          if (uid) {
            try { await updateAccountRec(uid, rec => { rec.students = (rec.students || []).filter(x => x !== sid); }); } catch (e) { }
          }
          await Sync.save(); closeModal(); await loadParentAccounts(true); renderApp(); toast('연결을 해제했습니다', 'ok');
        });
        return;
      }
      case 'birth-sync': {
        if (!V.parentAccts) { loadParentAccounts(true); return toast('잠시 뒤 한 번 더 눌러 주세요', 'err'); }
        birthSyncAll(t.dataset.dept || V.dept); return;
      }

      /* --- 교사 담임·권한 --- */
      case 'staff-reload': V.staffAccts = null; loadStaffAccounts(true); return;
      case 'staff-dept': V.staffDept = t.dataset.id; renderApp(); return;
      case 'staff-edit': staffEditModal(t.dataset.uid); return;
      case 'staff-deptsel': {
        if (!V.staffEdit) return;
        toggleIn(V.staffEdit.depts, t.dataset.id);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        return;
      }
      case 'staff-class': {
        if (!V.staffEdit) return;
        toggleIn(V.staffEdit.classes, t.dataset.id);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        return;
      }
      case 'staff-perm': {
        if (!V.staffEdit) return;
        const k = t.dataset.key;
        V.staffEdit.grants[k] = !V.staffEdit.grants[k];
        t.classList.toggle('mint', !!V.staffEdit.grants[k]); t.classList.toggle('gray', !V.staffEdit.grants[k]);
        return;
      }
      case 'staff-save': await saveStaffEdit(t.dataset.uid); return;

      /* --- 명단 양식 --- */
      case 'roster-template': downloadFile('부서아동명단_양식.csv', rosterTemplateCsv(t.dataset.dept || V.dept)); toast('양식을 내려받았습니다. 엑셀로 열어 작성하세요', 'ok'); return;
      case 'roster-upload': rosterPick(t.dataset.dept || V.dept); return;
      case 'roster-apply': await applyRoster(t.dataset.dept); return;

      /* --- 통계 / 연간 출석부 --- */
      case 'stat-view': V.statView = t.dataset.v; renderApp(); return;
      case 'pastor-tab': V.pastorTab = t.dataset.v; renderApp(); return;
      case 'stat-year': V.statYear = Number(statYear()) + Number(t.dataset.v); renderApp(); return;
      case 'annual-csv': annualCsv(); return;
      case 'annual-print': printAnnual(); return;

      /* --- 주일보고 반려 --- */
      case 'reject-report': await rejectReport(t.dataset.id); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});
