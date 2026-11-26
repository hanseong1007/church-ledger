/* 덕신교회 부서업무 — 추가 기능 (회원가입·승인 / 월별계획표·한글파일 / 회계·영수증 / 출석통계·결석이유)
   기존 core.js·ui.js·app.js 위에 얹는 화면과 동작입니다. 모든 자료는 기존과 같이
   브라우저에서 AES-256-GCM 으로 암호화된 한 덩어리(시트)에 함께 저장됩니다. */
'use strict';

/* ================= 공통 조각 ================= */
function subHead(title, sub, right) {
  return '<div class="page-head"><div><h2>' + esc(title) + '</h2><p>' + esc(sub) + '</p></div><span class="sp"></span>' + (right || '') + '</div>';
}
function roleChipOf(key) {
  const r = roleDef(key);
  return '<span class="chip violet">' + esc((r.emoji || '') + ' ' + r.label) + '</span>';
}
function monthBar(id, ym, act) {
  return '<div class="daybar"><button class="icon-btn" data-act="' + act + '" data-v="-1">‹</button>' +
    '<div class="month-label">' + esc(monthLabel(ym)) + '</div>' +
    '<button class="icon-btn" data-act="' + act + '" data-v="1">›</button></div>';
}
function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); return arr; }

/* ================= 1. 회원가입 신청 ================= */
const SIGNUP_ROLES = ['pastor', 'edu', 'teacher', 'parent'];

/* 생일 양력↔음력처럼 화면을 다시 그려도 입력한 값을 잃지 않도록 폼 값을 기억합니다 */
function signupFormState() {
  if (!V.signupForm) V.signupForm = { name: '', id: '', pw: '', pw2: '', birth: '', className: '', child: '' };
  return V.signupForm;
}
function captureSignupForm() {
  if (!document.getElementById('suName')) return;
  const f = signupFormState();
  f.name = val('suName'); f.id = val('suId');
  f.pw = (document.getElementById('suPw') || {}).value || '';
  f.pw2 = (document.getElementById('suPw2') || {}).value || '';
  f.birth = val('suBirth'); f.className = val('suClassName'); f.child = val('suChild');
}

function signupModal() {
  if (!V.signup) V.signup = { roles: [], depts: [], classes: [], className: '' };
  const st = V.signup;
  const f = signupFormState();
  const sbt = V.signupBirthType === 'lunar' ? 'lunar' : 'solar';
  let h = '';
  h += '<div class="banner sky"><span>가입은 <b>바로 윗단계 담당자</b>의 승인으로 완료됩니다.<br>관리자 → 목회자 → 교육부서담당 → 교사 → 학부모 순서입니다.</span></div>';
  h += '<div class="field"><label>역할 (한 가지 이상)</label><div class="row wrap" style="gap:6px">';
  SIGNUP_ROLES.forEach(k => {
    const r = roleDef(k);
    h += '<button type="button" class="chip big ' + (st.roles.indexOf(k) >= 0 ? 'coral' : 'gray') + '" data-act="signup-role" data-key="' + esc(k) + '">' + esc((r.emoji || '') + ' ' + r.label) + '</button>';
  });
  h += '</div><div class="hint">학부모 겸 교사처럼 두 가지를 함께 골라도 됩니다.</div></div>';
  h += '<div class="grid2"><div class="field"><label>이름</label><input id="suName" value="' + esc(f.name) + '" placeholder="예: 박한성"></div>';
  h += '<div class="field"><label>아이디</label><input id="suId" value="' + esc(f.id) + '" autocapitalize="none" spellcheck="false" placeholder="예: 박한성"><div class="hint">한글 이름을 그대로 쓸 수 있습니다.</div></div></div>';
  h += '<div class="grid2"><div class="field"><label>비밀번호 (8자 이상)</label><input id="suPw" type="password" autocomplete="new-password" value="' + esc(f.pw) + '"></div>';
  h += '<div class="field"><label>비밀번호 확인</label><input id="suPw2" type="password" autocomplete="new-password" value="' + esc(f.pw2) + '"></div></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:5px">';
  h += '<button type="button" class="chip big ' + (sbt === 'solar' ? 'coral' : 'gray') + '" data-act="signup-birth-type" data-v="solar">양력</button>';
  h += '<button type="button" class="chip big ' + (sbt === 'lunar' ? 'coral' : 'gray') + '" data-act="signup-birth-type" data-v="lunar">음력</button></div>';
  h += '<div class="field"><label>' + (sbt === 'lunar' ? '음력 생년월일 (생일)' : '양력 생년월일 (생일)') + '</label><input id="suBirth" type="date" min="1930-01-01" max="2050-12-31" value="' + esc(f.birth) + '"><div class="hint">' + (sbt === 'lunar' ? '음력으로 적으면 그 해 양력 날짜로 바꾸어 표시합니다.' : '') + ' 가입이 승인되면 소속 부서 일정에 🎂 생일이 매년 자동으로 등록됩니다.</div></div>';
  h += '<div class="field"><label>소속 부서</label><div class="row wrap" style="gap:6px">';
  (S.state.departments || []).filter(d => !d._del).forEach(d => {
    h += '<button type="button" class="chip big ' + (st.depts.indexOf(d.id) >= 0 ? 'coral' : 'gray') + '" data-act="signup-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>';
  });
  h += '</div><div class="hint">교육부서담당·교사는 꼭 골라 주세요.</div></div>';
  h += '<div class="field"><label>소속 반 (교사·학부모)</label><input id="suClassName" value="' + esc(f.className) + '" placeholder="예: 믿음반"><div class="hint">로그인 전이라 반 목록을 읽을 수 없습니다. 반 이름을 적어 주시면 승인하는 담당자가 정확한 반으로 연결합니다.</div></div>';
  h += '<div class="field" id="suChildWrap"><label>자녀 이름 (학부모)</label><input id="suChild" value="' + esc(f.child) + '" placeholder="예: 박준희"></div>';
  h += '<div class="login-err" id="suErr"></div>';
  h += '<div class="row" style="margin-top:8px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="do-signup">가입 신청서 보내기</button></div>';
  openModal('회원가입 신청서', h, { focus: 'suName' });
}

function refreshSignupClasses() {
  const el = document.getElementById('suClassName');
  if (!el) return;
  const st = V.signup || { depts: [] };
  const names = (S.state.classes || []).filter(c => !c._del && (!st.depts.length || st.depts.indexOf(c.deptId) >= 0)).map(c => c.name);
  el.placeholder = names.length ? '예: ' + names[0] : '예: 믿음반';
}

/* 이미 가입했거나 신청한 기록과 겹치는지 확인합니다.
   신청서(pending·approved)는 평문이라 로그인 전에도 이름을 볼 수 있지만,
   이미 쓰고 있는 계정은 암호문이라 아이디로만 확인할 수 있습니다.
   그래서 같은 이름의 기존 회원은 [가입 승인] 화면에서 승인자가 한 번 더 확인합니다. */
async function duplicateSignupInfo(id, name) {
  const uid = await uidOf(id);
  const mine = await fetchAccount(uid);
  if (mine) {
    const info = appRowInfo(mine);
    if (info.kind === 'pending' || info.kind === 'approved') return { kind: 'same_id_pending' };
    if (info.kind === 'active') return { kind: 'same_id_active' };
  }
  let rows = [];
  try { const r = await Api.call({ action: 'acct_list' }, 15000); rows = r.rows || []; } catch (e) { rows = []; }
  const nm = String(name || '').trim();
  const same = [];
  if (nm) {
    rows.forEach(row => {
      if (String(row.uid) === String(uid) || String(row.deleted) === '1') return;
      const info = appRowInfo(row);
      if (info.kind !== 'pending' && info.kind !== 'approved') return;
      const a = info.app || {};
      if (String(a.name || '').trim() === nm) same.push({ id: a.id || '', roles: a.roles || [], approved: info.kind === 'approved' });
    });
  }
  return { kind: same.length ? 'same_name_app' : '', same: same };
}

async function doSignup() {
  captureSignupForm();
  const st = V.signup || { roles: [], depts: [] };
  const f = signupFormState();
  const name = String(f.name || '').trim(), id = normId(f.id);
  const pw = f.pw, pw2 = f.pw2;
  const clsName = String(f.className || '').trim();
  const child = String(f.child || '').trim();
  const birth = String(f.birth || '').trim();
  const err = document.getElementById('suErr');
  const fail = m => { if (err) { err.innerHTML = esc(m).replace(/\n/g, '<br>'); err.classList.add('show'); } else toast(m, 'err'); };
  if (!st.roles.length) return fail('역할을 하나 이상 골라 주세요.');
  if (!name) return fail('이름을 입력해 주세요.');
  if (!okAccountId(id)) return fail(idRuleText());
  if (pw.length < 8) return fail('비밀번호는 8자 이상으로 정해 주세요.');
  if (pw !== pw2) return fail('비밀번호가 서로 다릅니다.');
  if (!birth) return fail('생년월일(생일)을 넣어 주세요. 부서 일정에 생일이 자동 등록됩니다.');
  if ((V.signupBirthType || 'solar') === 'lunar' && !lunarYearInfo(Number(birth.slice(0, 4)))) return fail('음력 생일은 1930~2050년 사이로 넣어 주세요.');
  if ((st.roles.indexOf('edu') >= 0 || st.roles.indexOf('teacher') >= 0) && !st.depts.length) return fail('소속 부서를 골라 주세요.');
  if (st.roles.indexOf('parent') >= 0 && !child) return fail('자녀 이름을 적어 주세요.');

  const btn = document.querySelector('[data-act="do-signup"]');
  if (btn) { btn.disabled = true; btn.textContent = '신청 중…'; }
  try {
    const dup = await duplicateSignupInfo(id, name);
    if (dup.kind === 'same_id_pending') return fail('이미 가입 신청한 아이디입니다. 승인을 기다려 주세요.');
    if (dup.kind === 'same_id_active') return fail('이미 사용 중인 아이디입니다. 다른 아이디로 신청해 주세요.\n같은 이름이면 아이디 뒤에 숫자를 붙이면 됩니다. (예: ' + name + '2)');
    if (dup.kind === 'same_name_app') {
      const list = dup.same.map(x => '@' + x.id + (x.roles.length ? ' · ' + x.roles.map(r => roleDef(r).label).join('/') : '') + (x.approved ? ' (승인됨)' : ' (승인 대기)')).join(', ');
      return fail('이미 같은 이름(' + name + ')으로 가입 신청한 기록이 있습니다.\n' + list + '\n같은 분이면 승인을 기다려 주세요. 다른 분이면 담당자에게 알려 주세요.');
    }
    const depts = st.depts.slice();
    const bt = V.signupBirthType === 'lunar' ? 'lunar' : 'solar';
    const app = await buildApplication({
      id: id, password: pw, name: name, roles: st.roles, depts: depts, birth: birth,
      birthType: bt, birthLunar: bt === 'lunar' ? birthdayMmdd(birth) : '',
      classes: [], className: clsName, childName: child, note: ''
    });
    await saveAccountRow(app);
    closeModal();
    V.signup = null;
    V.signupForm = null;
    showLogin();
    showLoginError('가입 신청을 보냈습니다.\n' + roleDef(st.roles[0]).label + '의 윗단계 담당자가 승인하면 바로 로그인할 수 있습니다.');
    toast('가입 신청 완료', 'ok');
  } catch (e) {
    fail('신청을 보내지 못했습니다: ' + ((e && e.message) || e));
  } finally {
    const b = document.querySelector('[data-act="do-signup"]');
    if (b) { b.disabled = false; b.textContent = '가입 신청서 보내기'; }
  }
}

/* ================= 2. 가입 승인 ================= */
const V2 = {};   // 신청 목록 등 화면 임시 값 (V 는 ui.js 공용)

function canApprove(a) {
  const appRoles = (a.app && a.app.roles) || a.rec.roles || [];
  const appRank = rankOfKeys(appRoles);
  const myR = myRank();
  if (!myR || myR <= appRank) return false;
  const base = roleDef(S.roleKey).base;
  if (base === 'admin' || base === 'pastor') return true;
  const myDepts = S.me.depts || [];
  const myClasses = S.me.classes || [];
  const appDepts = ((a.app && a.app.depts) || a.rec.depts || []).map(canonDeptId);
  const appClasses = (a.app && a.app.classes) || a.rec.classes || [];
  if (!myDepts.length && !myClasses.length) return true;
  if (!appDepts.length && !appClasses.length) return true;   // 신청서에 부서·반이 적히지 않은 경우 — 승인하면서 지정
  if (appDepts.some(d => myDepts.indexOf(d) >= 0)) return true;
  if (appClasses.some(c => myClasses.indexOf(c) >= 0)) return true;
  return false;
}

async function loadApps(force) {
  if (V.appsLoading) return;
  if (V.apps && !force) return;
  V.appsLoading = true;
  renderApp();
  try {
    const list = await listAccounts();
    V.appRows = list;
    V.apps = list.filter(a => a.status && a.status !== 'active');
    V.appsErr = '';
  } catch (e) {
    V.appsErr = '가입 신청 목록을 불러오지 못했습니다: ' + ((e && e.message) || e);
    V.apps = [];
  }
  V.appsLoading = false;
  renderApp();
}

function approveView() {
  if (!can('user.approve')) return '<div class="card">' + emptyBox('🔒', '가입 승인 권한이 없습니다') + '</div>';
  if (V.apps === undefined || V.apps === null) { loadApps(); return '<div class="card"><p class="muted" style="margin:0">가입 신청을 불러오는 중…</p></div>'; }
  let h = subHead('가입 승인', '바로 윗단계 담당자가 승인하면 가입이 완료됩니다',
    '<button class="btn sm" data-act="reload-apps">↻ 새로고침</button>');
  if (V.appsErr) h += '<div class="banner coral">' + esc(V.appsErr) + '</div>';
  const mine = V.apps.filter(a => a.status === 'pending' && canApprove(a));
  const notMine = V.apps.filter(a => a.status === 'pending' && !canApprove(a));
  const done = V.apps.filter(a => a.status !== 'pending');
  const chg = pendingChanges();
  const chgMine = chg.filter(r => canApproveChange(r));
  const chgOthers = chg.filter(r => !canApproveChange(r));

  /* 역할·부서 변경 신청 — 가입 승인과 함께 여기서 처리합니다 */
  if (chgMine.length) {
    h += '<div class="sect-title">🔁 역할·부서 변경 신청 ' + chgMine.length + '건</div>';
    chgMine.forEach(r => { h += changeRequestCard(r); });
  }
  if (chgOthers.length) {
    h += '<div class="sect-title">다른 담당자가 승인할 변경 신청</div><div class="list">';
    chgOthers.forEach(r => { h += '<div class="item"><span class="av">🔁</span><span class="tx"><b>' + esc(r.name || '') + '</b><span>' + esc(roleSetText((r.to || {}).roles, (r.to || {}).depts)) + ' · 윗단계 승인 대기</span></span></div>'; });
    h += '</div>';
  }

  if (!mine.length) h += '<div class="card">' + emptyBox('👋', '내가 승인할 가입 신청이 없습니다',
    myRank() <= 2 ? '교사는 학부모 가입을, 교육부서담당은 교사 가입을 승인합니다' : '아랫단계 신청이 들어오면 여기에 나타납니다') + '</div>';
  mine.forEach(a => {
    const ap = a.app || {};
    const depts = (ap.depts || []).map(d => (deptById(d) || {}).name).filter(Boolean).join(', ');
    const cls = (ap.classes || []).map(c => (classById(c) || {}).name).filter(Boolean).join(', ');
    h += '<div class="card"><h3>' + esc(ap.name || a.rec.name) + '<span class="sp"></span>' + roleChipOf((ap.roles || [])[0] || 'parent') + '</h3>';
    h += '<div class="kv"><span>아이디</span><b>' + esc(ap.id || a.rec.id) + '</b></div>';
    if (depts) h += '<div class="kv"><span>부서</span><b>' + esc(depts) + '</b></div>';
    if (cls || ap.className) h += '<div class="kv"><span>반</span><b>' + esc(cls || ap.className) + '</b></div>';
    if (ap.childName) h += '<div class="kv"><span>자녀</span><b>' + esc(ap.childName) + '</b></div>';
    if (ap.birth) h += '<div class="kv"><span>생일</span><b>' + esc(String(ap.birth).replace(/-/g, '.')) + '</b></div>';
    h += '<div class="kv"><span>신청</span><b>' + timeAgo(ap.at || a.updated) + '</b></div>';
    const warn = dupAppWarn(a);
    if (warn) h += '<div class="banner amber" style="margin-top:8px">⚠️ ' + esc(warn) + '</div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="reject-app" data-uid="' + esc(a.uid) + '">반려</button><span class="sp"></span><button class="btn primary" data-act="approve-app" data-uid="' + esc(a.uid) + '">승인</button></div></div>';
  });
  if (notMine.length) {
    h += '<div class="sect-title">다른 담당자가 승인할 신청</div><div class="list">';
    notMine.forEach(a => {
      const ap = a.app || {};
      h += '<div class="item"><span class="av">' + esc((ap.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(ap.name || a.rec.name) + '</b><span>' + esc(((ap.roles || []).map(r => roleDef(r).label).join(' · '))) + ' · 윗단계 승인 대기</span></span></div>';
    });
    h += '</div>';
  }
  if (done.length) {
    h += '<div class="sect-title">최근 처리</div><div class="list">';
    done.slice(0, 8).forEach(a => {
      const ap = a.app || {};
      const label = a.status === 'approved' ? '승인됨 (첫 로그인 전)' : '반려';
      h += '<div class="item" style="opacity:.85"><span class="av">' + (a.status === 'approved' ? '✅' : '✖️') + '</span><span class="tx"><b>' + esc(ap.name || a.rec.name) + '</b><span>' + esc(label) + ' · ' + timeAgo(a.updated) + '</span></span><span class="rt"><span class="chip ' + (a.status === 'approved' ? 'mint' : 'rose') + '">' + esc(label) + '</span></span></div>';
    });
    h += '</div>';
  }
  h += '<p class="muted" style="margin-top:12px">승인하면 이 신청자만 열 수 있는 열쇠로 자료 열쇠를 감싸 전달합니다. 신청자의 비밀번호는 알 필요도, 저장할 필요도 없습니다. 같은 이름의 회원이 이미 있으면 카드에 표시되니 중복 가입인지 확인해 주세요.</p>';
  return h;
}

async function approveApp(uid, overrides) {
  const a = (V.appRows || []).find(x => x.uid === uid);
  if (!a) return toast('신청서를 찾지 못했습니다', 'err');
  const raw = await Api.call({ action: 'acct_get', uid: uid }, 12000);
  if (!raw.ok || !raw.row) return toast('신청서를 불러오지 못했습니다', 'err');
  const info = appRowInfo(raw.row);
  if (info.kind !== 'pending') return toast('이미 처리된 신청입니다', 'err');
  await saveAccountRow(await approveApplication(raw.row, overrides));
  try {
    const ov = overrides || {};
    /* 자녀 연결 — 승인하면서 고른 자녀를 아이 쪽에도 학부모로 남깁니다 */
    const sids = (ov.students || (info.app || {}).students || []);
    sids.forEach(sid => {
      const s = (S.state.students || []).find(x => x.id === sid && !x._del);
      if (!s) return;
      addGuardianTo(s, uid);
      if (!s.guardianName) s.guardianName = (info.app || {}).name || '';
    });
    const birth = ov.birth !== undefined ? ov.birth : (info.app || {}).birth;
    syncBirthEvent('account', uid, (info.app || {}).name || a.rec.name, birth, ov.depts || (info.app || {}).depts || [], (info.app || {}).birthType, (info.app || {}).birthLunar);
    await Sync.save();
  } catch (e) { /* 생일 등록은 실패해도 승인은 유지 */ }
  closeModal();
  V.apps = (V.apps || []).filter(x => x.uid !== uid);
  if (V.appRows) V.appRows = V.appRows.filter(x => x.uid !== uid);
  renderApp();
  toast((a.app && a.app.name ? a.app.name : '신청자') + ' 님 가입을 승인했습니다', 'ok');
  await loadApps(true);
}

/* 승인 전에 부서·반을 바로잡는 창 */
function approveModal(uid) {
  const a = (V.appRows || []).find(x => x.uid === uid);
  if (!a) return;
  const ap = a.app || {};
  V.apprEdit = { uid: uid, depts: (ap.depts || []).slice(), classes: (ap.classes || []).slice(), students: (ap.students || []).slice(), birth: ap.birth || '' };
  const depts = (S.state.departments || []).filter(d => !d._del);
  let h = '<div class="banner sky">' + esc(ap.name || a.rec.name) + ' · ' + esc(((ap.roles || []).map(r => roleDef(r).label).join(' / '))) + '</div>';
  h += '<div class="field"><label>아이디</label><input value="' + esc(ap.id || a.rec.id) + '" readonly></div>';
  h += '<div class="field"><label>생일 ' + (ap.birthType === 'lunar' ? '(음력)' : '(양력)') + ' · 부서 일정에 자동 등록</label><input id="apBirth" type="date" value="' + esc(ap.birth || '') + '"></div>';
  h += '<div class="field"><label>담당 부서</label><div class="row wrap" style="gap:6px">' + depts.map(d => '<button type="button" class="chip big ' + (V.apprEdit.depts.indexOf(d.id) >= 0 ? 'coral' : 'gray') + '" data-act="appr-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div></div>';
  h += '<div class="field"><label>담당 반</label><div class="row wrap" id="apClsBox" style="gap:6px">' + approveClassChips() + '</div><div class="hint">고른 담당 부서의 반만 보입니다.</div></div>';
  const stus = (S.state.students || []).filter(s => !s._del && inYear(s));
  if (stus.length) {
    h += '<div class="field"><label>자녀 연결 (학부모)</label><div class="row wrap" style="gap:6px">';
    stus.slice(0, 40).forEach(s => {
      h += '<button type="button" class="chip big ' + (V.apprEdit.students.indexOf(s.id) >= 0 ? 'coral' : 'gray') + '" data-act="appr-stu" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>';
    });
    h += '</div><div class="hint">' + (ap.childName ? '신청서에 적힌 자녀: ' + esc(ap.childName) : '신청서에 자녀 이름이 없습니다.') + '</div></div>';
  }
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="do-approve" data-uid="' + esc(uid) + '">승인하고 열쇠 전달</button></div>';
  openModal('가입 승인', h);
}

/* 가입 승인 창의 담당 반 칩 — 고른 담당 부서의 반만 */
function approveClassChips() {
  const ds = ((V.apprEdit && V.apprEdit.depts) || []).map(canonDeptId);
  const picked = (V.apprEdit && V.apprEdit.classes) || [];
  const cls = (S.state.classes || []).filter(c => !c._del && inYear(c) &&
    (!ds.length || ds.indexOf(canonDeptId(c.deptId)) >= 0 || picked.indexOf(c.id) >= 0));
  if (!cls.length) return '<span class="muted">이 부서에 등록된 반이 없습니다.</span>';
  return cls.map(c => {
    const on = picked.indexOf(c.id) >= 0;
    return '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="appr-cls" data-id="' + esc(c.id) + '">' +
      (ds.length ? '' : esc((deptById(c.deptId) || {}).name || '') + ' ') + esc(c.name) + '</button>';
  }).join('');
}

function rejectModal(uid) {
  const a = (V.appRows || []).find(x => x.uid === uid);
  const nm = a && a.app ? a.app.name : '이 신청';
  openModal('가입 반려', '<p class="muted">' + esc(nm) + ' 님의 가입 신청을 반려합니다. 사유는 신청자에게 안내됩니다.</p>' +
    '<div class="field"><label>반려 사유 (선택)</label><input id="rejWhy" placeholder="예: 소속 부서 확인이 필요합니다"></div>' +
    '<div class="row"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn" style="color:#c33e5f" data-act="do-reject" data-uid="' + esc(uid) + '">반려하기</button></div>');
}

async function doReject(uid) {
  const why = val('rejWhy');
  const raw = await Api.call({ action: 'acct_get', uid: uid }, 12000);
  if (!raw.ok || !raw.row) return toast('신청서를 불러오지 못했습니다', 'err');
  await saveAccountRow(rejectApplication(raw.row, why));
  closeModal();
  V.apps = (V.apps || []).filter(x => x.uid !== uid);
  if (V.appRows) V.appRows = V.appRows.filter(x => x.uid !== uid);
  renderApp();
  toast('반려했습니다', 'ok');
  await loadApps(true);
}

/* ================= 2-1. 역할·부서 변경 신청 =================
   학부모로 가입한 사람이 올해 교사로도 활동할 때 내 정보에서 직접 신청합니다.
   · 권한이 올라가는 변경(학부모 → 교사 등) → 윗단계(교육부서담당·목회자·관리자) 승인 뒤 적용
   · 부서만 옮기거나 역할을 줄이는 변경 → 바로 적용
   · 어느 쪽이든 연결된 자녀(students)·담임 반(classes)은 건드리지 않습니다. */
function roleLabelsOf(keys) { return (keys || []).map(k => roleDef(k).label).filter(Boolean).join(' · '); }
function deptNamesOf(ids) {
  const list = Array.from(new Set((ids || []).map(canonDeptId)));
  return list.map(d => (deptById(d) || {}).name).filter(Boolean).join(', ') || '전체';
}
function roleSetText(roles, depts) { return (roleLabelsOf(roles) || '역할 없음') + ' · ' + deptNamesOf(depts); }

/* 내 정보 화면 카드 */
function roleChangeCard() {
  if (!S.me) return '';
  const pend = myPendingChange();
  const done = changeRequests().filter(r => r.uid === S.me.uid && r.status !== 'pending')
    .sort((a, b) => (Number(b.at2) || Number(b.at) || 0) - (Number(a.at2) || Number(a.at) || 0))[0];
  let h = '<div class="card"><h3>🔁 역할·부서 변경</h3>';
  h += '<div class="kv"><span>지금</span><b>' + esc(roleSetText(S.me.roles, S.me.depts)) + '</b></div>';
  if (pend) {
    h += '<div class="banner sky">🕒 <b>' + esc(roleSetText(pend.to.roles, pend.to.depts)) + '</b> (으)로 바꾸는 신청이 승인을 기다리고 있습니다 · ' + timeAgo(pend.at) + (pend.note ? '<br>사유: ' + esc(pend.note) : '') + '</div>';
  } else if (done) {
    const ok = done.status === 'approved' || done.status === 'applied';
    const lbl = done.status === 'rejected' ? '↩ 반려되었습니다' : ok ? '✅ 바뀐 내용이 적용되었습니다' : '처리되었습니다';
    h += '<div class="banner ' + (done.status === 'rejected' ? 'coral' : 'mint') + '">' + lbl + (done.status !== 'applied' && done.byName ? ' · ' + esc(done.byName) : '') + (done.why ? '<br>사유: ' + esc(done.why) : '') + ' <span class="muted">' + timeAgo(done.at2 || done.at) + '</span></div>';
  }
  h += '<p class="hint" style="margin:0 0 8px">작년에 학부모로 가입했는데 올해 교사로도 활동한다면 여기서 신청하세요. 학부모 → 교사처럼 <b>권한이 올라가는 변경은 윗단계(교육부서담당·관리자) 승인</b> 뒤에 적용되고, <b>연결된 자녀는 그대로 남습니다</b>. 부서만 옮기는 변경은 바로 적용됩니다.</p>';
  h += '<button class="btn block" data-act="chg-open">' + (pend ? '신청 내용 바꾸기' : '역할·부서 변경 신청') + '</button>';
  h += '</div>';
  return h;
}

function changeApplyHint() {
  const e = V.changeEdit || {};
  const need = rankOfKeys(e.roles) > myRank();
  return need ? '윗단계(교육부서담당·관리자) 승인 뒤에 적용됩니다' : '바로 적용됩니다';
}
function refreshChangeHint() {
  const el = document.getElementById('chgApplyHint');
  if (el) el.textContent = changeApplyHint();
}

function roleChangeModal() {
  if (!S.me) return;
  const pend = myPendingChange();
  const src = pend ? pend.to : { roles: S.me.roles || [], depts: S.me.depts || [] };
  V.changeEdit = { roles: (src.roles || []).slice(), depts: Array.from(new Set((src.depts || []).map(canonDeptId))) };
  const roles = (S.state.roles || []).filter(r => !r._del && roleDef(r.key).base !== 'admin');
  const depts = (S.state.departments || []).filter(d => !d._del && d.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  let h = '<div class="banner sky">바꾸려는 역할·부서를 고르세요. <b>학부모와 교사</b>를 함께 고르면 교사로 활동하면서 자녀도 계속 볼 수 있습니다.</div>';
  h += '<div class="field"><label>역할 (여러 개 고를 수 있습니다)</label><div class="row wrap" style="gap:6px">';
  roles.forEach(r => {
    const on = V.changeEdit.roles.indexOf(r.key) >= 0;
    h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="chg-role" data-key="' + esc(r.key) + '">' + esc((r.emoji || '') + ' ' + r.label) + '</button>';
  });
  h += '</div><div class="hint">관리자 역할은 여기서 바꿀 수 없습니다. 필요하면 관리자에게 요청하세요.</div></div>';
  h += '<div class="field"><label>소속 부서</label><div class="row wrap" style="gap:6px">';
  depts.forEach(d => {
    const on = V.changeEdit.depts.indexOf(d.id) >= 0;
    h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="chg-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>';
  });
  h += '</div><div class="hint">자녀가 다니는 부서는 자동으로 함께 보입니다.</div></div>';
  h += '<div class="field"><label>신청 사유 (선택)</label><input id="chgNote" value="' + esc(pend ? pend.note || '' : '') + '" placeholder="예: 올해부터 초등부 교사로 함께 섬깁니다"></div>';
  h += '<div class="kv"><span>적용 방법</span><b id="chgApplyHint">' + esc(changeApplyHint()) + '</b></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="chg-send">' + (pend ? '신청 내용 바꾸기' : '신청하기') + '</button></div>';
  openModal('역할·부서 변경', h);
}

/* 내 계정 기록만 고쳐 바로 적용 (자녀·담임 반은 그대로) */
async function applySelfChange(roles, depts, note) {
  const from = { roles: (S.me.roles || []).slice(), depts: (S.me.depts || []).map(canonDeptId) };
  /* 부서를 하나도 고르지 않았으면 지금 부서를 그대로 둡니다 (교사가 부서 없이 남는 것을 막음) */
  const finalDepts = depts.length ? depts.slice() : from.depts.slice();
  const to = { roles: roles.slice(), depts: finalDepts };
  const rec = await updateAccountRec(S.me.uid, r => {
    r.roles = to.roles.slice();
    r.depts = finalDepts.slice();
    r.changeLog = (r.changeLog || []).concat([{ at: Date.now(), by: S.me.uid, byName: S.me.name, from: from, to: to, note: note || '' }]).slice(-12);
  });
  S.me.roles = to.roles.slice();
  S.me.depts = finalDepts.slice();
  if ((S.me.roles || []).indexOf(S.roleKey) < 0) S.roleKey = highestRoleKey(S.me.roles);
  if (rec) { try { syncBirthEventOf('account', S.me.uid, rec, S.me.depts); } catch (e) { } }
  saveSession();
  return rec;
}

async function submitRoleChange() {
  const e = V.changeEdit;
  if (!e) return;
  const roles = (e.roles || []).slice();
  if (!roles.length) return toast('역할을 하나 이상 골라 주세요', 'err');
  const depts = Array.from(new Set((e.depts || []).map(canonDeptId)));
  const note = val('chgNote');
  const needDept = roles.some(r => ['teacher', 'edu', 'pastor'].indexOf(roleDef(r).base) >= 0);
  if (needDept && !depts.length && !(S.me.depts || []).length) return toast('교사·교육부서담당은 소속 부서를 하나 이상 골라 주세요', 'err');
  const from = { roles: (S.me.roles || []).slice(), depts: (S.me.depts || []).map(canonDeptId) };
  if (sameKeySet(roles, from.roles) && sameKeySet(depts, from.depts)) return toast('바뀐 내용이 없습니다', 'err');
  const now = Date.now();
  const existing = myPendingChange();
  const need = rankOfKeys(roles) > myRank();

  if (!need) {
    try { await applySelfChange(roles, depts, note); }
    catch (err) { return toast((err && err.message) || '바꾸지 못했습니다', 'err'); }
    if (existing) { existing.status = 'replaced'; existing.u = now; touch(existing); }
    S.state.requests = S.state.requests || [];
    S.state.requests.push({
      id: 'rq-' + Crypto.uid(), uid: S.me.uid, accountId: S.me.id, name: S.me.name,
      from: from, to: { roles: roles, depts: depts }, note: note,
      status: 'applied', by: S.me.uid, byName: S.me.name, at: now, at2: now, u: now
    });
    await Sync.save();
    V.changeEdit = null;
    closeModal(); renderApp();
    toast('역할·부서를 바꿨습니다', 'ok');
    return;
  }

  S.state.requests = S.state.requests || [];
  if (existing) {
    existing.from = from; existing.to = { roles: roles, depts: depts }; existing.note = note;
    existing.at = now; existing.u = now; touch(existing);
  } else {
    S.state.requests.push({
      id: 'rq-' + Crypto.uid(), uid: S.me.uid, accountId: S.me.id, name: S.me.name,
      from: from, to: { roles: roles, depts: depts }, note: note,
      status: 'pending', at: now, u: now
    });
  }
  await Sync.save();
  V.changeEdit = null;
  closeModal(); renderApp();
  toast('변경 신청을 보냈습니다. 윗단계 승인 뒤에 적용됩니다', 'ok');
}

async function doApproveChange(id) {
  const req = changeRequests().find(r => r.id === id);
  if (!req) return toast('신청을 찾지 못했습니다', 'err');
  if (!canApproveChange(req)) return toast('이 신청을 승인할 단계가 아닙니다', 'err');
  const to = { roles: (req.to.roles || []).slice(), depts: Array.from(new Set((req.to.depts || []).map(canonDeptId))) };
  try {
    const rec = await updateAccountRec(req.uid, r => {
      r.roles = to.roles.slice();
      if (to.depts.length) r.depts = to.depts.slice();
      r.changeLog = (r.changeLog || []).concat([{ at: Date.now(), by: S.me.uid, byName: S.me.name, from: req.from || {}, to: to, note: req.note || '' }]).slice(-12);
    });
    if (rec) { try { syncBirthEventOf('account', req.uid, rec, (to.depts.length ? to.depts : (rec.depts || []))); } catch (e) { } }
    if (req.uid === S.me.uid) {
      S.me.roles = to.roles.slice();
      if (to.depts.length) S.me.depts = to.depts.slice();
      if ((S.me.roles || []).indexOf(S.roleKey) < 0) S.roleKey = highestRoleKey(S.me.roles);
      saveSession();
    }
    req.status = 'approved'; req.by = S.me.uid; req.byName = S.me.name; req.at2 = Date.now(); req.u = Date.now(); touch(req);
    await Sync.save();
    renderApp();
    const tea = to.roles.some(r => roleDef(r).base === 'teacher');
    toast((req.name || '신청자') + ' 님의 역할·부서를 바꿨습니다' + (tea ? ' · 담임 반은 교사·권한에서 지정하세요' : ''), 'ok');
    refreshMyAccount();
  } catch (e) {
    toast((e && e.message) || '적용하지 못했습니다', 'err');
  }
}

function rejectChangeModal(id) {
  const req = changeRequests().find(r => r.id === id);
  if (!req) return;
  let h = '<p class="muted">' + esc(req.name || '신청자') + ' 님의 역할·부서 변경 신청을 반려합니다. 사유는 신청자에게 보입니다.</p>';
  h += '<div class="field"><label>반려 사유 (선택)</label><input id="chgWhy" placeholder="예: 부서 담당 확인이 필요합니다"></div>';
  h += '<div class="row"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn" style="color:#c33e5f" data-act="chg-reject-go" data-id="' + esc(id) + '">반려하기</button></div>';
  openModal('변경 신청 반려', h);
}
async function confirmRejectChange(id) {
  const req = changeRequests().find(r => r.id === id);
  if (!req) return;
  req.status = 'rejected'; req.by = S.me.uid; req.byName = S.me.name;
  req.why = val('chgWhy'); req.at2 = Date.now(); req.u = Date.now(); touch(req);
  await Sync.save();
  closeModal(); renderApp();
  toast('반려했습니다', 'ok');
}

/* 승인 화면에 띄우는 내용 */
function changeRequestCard(req) {
  let h = '<div class="card"><h3>' + esc(req.name || nameOfUid(req.uid)) + '<span class="sp"></span><span class="chip amber">승인 대기</span></h3>';
  h += '<div class="kv"><span>아이디</span><b>' + esc(req.accountId || '') + '</b></div>';
  h += '<div class="kv"><span>지금</span><b>' + esc(roleSetText((req.from || {}).roles, (req.from || {}).depts)) + '</b></div>';
  h += '<div class="kv"><span>신청</span><b>' + esc(roleSetText((req.to || {}).roles, (req.to || {}).depts)) + '</b></div>';
  if (req.note) h += '<div class="kv"><span>사유</span><b>' + esc(req.note) + '</b></div>';
  h += '<div class="kv"><span>신청 시각</span><b>' + timeAgo(req.at) + '</b></div>';
  h += '<div class="hint">승인하면 바로 적용되고 연결된 자녀·기록은 그대로 남습니다.</div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="chg-reject" data-id="' + esc(req.id) + '">반려</button><span class="sp"></span><button class="btn primary" data-act="chg-approve" data-id="' + esc(req.id) + '">승인</button></div></div>';
  return h;
}

/* 승인 화면에서 같은 이름 회원이 있는지 — 같은 분이 중복 가입했는지 확인용 */
function dupAppWarn(a) {
  const ap = a.app || {};
  const nm = String(ap.name || '').trim();
  if (!nm) return '';
  const bases = (ap.roles || []).map(r => roleDef(r).base);
  const others = (V.appRows || []).filter(x => x.uid !== a.uid && x.status === 'active' && String((x.rec && x.rec.name) || '').trim() === nm);
  if (!others.length) return '';
  const sameRole = others.filter(x => (((x.rec && x.rec.roles) || []).some(r => bases.indexOf(roleDef(r).base) >= 0)));
  let t = '이미 같은 이름의 회원이 있습니다: ' + others.map(x => '@' + ((x.rec && x.rec.id) || '?')).join(', ');
  if (sameRole.length) t += ' · 같은 역할(' + sameRole.map(x => ((x.rec && x.rec.roles) || []).map(r => roleDef(r).label).join('/')).join(', ') + ')';
  t += '. 같은 분이 중복 가입한 것은 아닌지 확인해 주세요.';
  return t;
}

/* ================= 3. 결석 사유 ================= */
const ABSENT_REASONS = ['병결', '가족일정', '개인사정', '학교·학원'];

function absentReasonModal(s, date) {
  const a = attOf(date, s.id);
  const cur = (a && a.reason) || '';
  let h = '<p class="muted" style="margin:0 0 10px">' + esc(s.name) + ' · ' + esc(fmtDate(date)) + ' 결석</p>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">';
  ABSENT_REASONS.forEach(r => {
    h += '<button class="chip big ' + (cur === r ? 'coral' : 'gray') + '" data-act="pick-absent" data-v="' + esc(r) + '">' + esc(r) + '</button>';
  });
  h += '</div>';
  h += '<div class="field"><label>결석 사유 (직접 입력)</label><input id="absReason" value="' + esc(cur) + '" placeholder="예: 독감으로 결석"></div>';
  h += '<div class="row"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn" data-act="clear-absent" data-sid="' + esc(s.id) + '">출석으로 되돌리기</button><button class="btn primary" data-act="save-absent" data-sid="' + esc(s.id) + '">결석 저장</button></div>';
  openModal('결석 사유', h, { focus: 'absReason' });
}

function saveAbsent(studentId, reason) {
  const s = (S.state.students || []).find(x => x.id === studentId);
  if (!s) return;
  setAtt(V.date, s.deptId, s.classId, s.id, 'absent');
  const a = attOf(V.date, s.id);
  if (a) { a.reason = String(reason || '').trim(); touch(a); Sync.save(); }
  closeModal();
  renderApp();
  toast('결석 사유를 저장했습니다', 'ok');
  if (V.autoMsg && s.guardianPhone) messageModal({ student: s, text: attMsgText(s, 'absent', String(reason || '').trim()) });
}

/* ================= 4. 월별계획표 ================= */
function planState() {
  if (!V.planMonth) V.planMonth = monthKeyOf((typeof V !== 'undefined' && V.date) || ymd());
  return V.planMonth;
}
function planView() {
  if (!can('plan.read') && !can('plan.write')) return '<div class="card">' + emptyBox('🔒', '월별계획표를 볼 권한이 없습니다') + '</div>';
  const ym = planState();
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  if (!V.planDept || !depts.some(d => d.id === V.planDept)) V.planDept = depts[0].id;
  const dept = deptById(V.planDept);
  const items = plansOf(dept.id, ym);
  const byWeek = {};
  items.forEach(p => { const w = Number(p.week) || weekOfMonth(p.date) || 0; (byWeek[w] = byWeek[w] || []).push(p); });
  const maxW = Math.max(5, ...Object.keys(byWeek).map(Number).filter(n => n > 0));

  let h = subHead('월별계획표', '부서별 주차 계획·행사·공과를 적고, 주일보고와 연결됩니다',
    can('plan.write') ? '<button class="btn primary sm" data-act="new-plan">＋ 계획</button>' : '');
  h += '<div class="card flat" style="padding:12px">' + monthBar('planMonth', ym, 'plan-month') +
    '<div class="row wrap" style="gap:6px">' + depts.map(d => '<button class="chip big ' + (d.id === dept.id ? 'coral' : 'gray') + '" data-act="plan-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div>';
  if (can('plan.write')) {
    h += '<div class="row" style="gap:6px;margin-top:10px"><button class="btn sm" data-act="plan-hwpx">📄 한글파일(.hwpx) 올리기</button><span class="sp"></span><span class="muted">' + (items.length ? items.length + '건' : '아직 없음') + '</span></div>';
  }
  h += '</div>';

  h += '<div class="plan-table">';
  for (let w = 1; w <= maxW; w++) {
    const list = (byWeek[w] || []);
    h += '<div class="plan-week"><div class="plan-wnum">' + w + '주차</div><div class="plan-wbody">';
    if (!list.length) h += '<div class="plan-empty">—</div>';
    list.forEach(p => {
      h += '<div class="plan-row">';
      const editAttr = can('plan.write') ? ' data-act="edit-plan" data-id="' + esc(p.id) + '"' : '';
      h += '<button class="plan-date"' + editAttr + '>' + esc(p.date ? fmtShort(p.date) : '') + '</button>';
      h += '<span class="chip ' + (p.kind === '공과' ? 'sky' : p.kind === '행사' ? 'amber' : 'gray') + '">' + esc(p.kind || '계획') + '</span>';
      h += '<span class="plan-title"' + editAttr + '><b>' + esc(p.title) + '</b>' + (p.detail ? '<span>' + esc(p.detail) + '</span>' : '') + '</span>';
      if (can('plan.write')) h += '<button class="plan-del" data-act="del-plan" data-id="' + esc(p.id) + '">✕</button>';
      h += '</div>';
    });
    h += '</div></div>';
  }
  h += '</div>';
  if (!items.length) h += '<p class="muted" style="text-align:center">이 달 계획이 없습니다. ＋ 계획으로 추가하거나 한글파일을 올리면 자동으로 채워집니다.</p>';
  h += '<div class="card flat" style="margin-top:14px"><h3>📄 한글파일 자동 반영</h3><p class="muted" style="margin:0">한글(.hwpx) 문서의 표·날짜·주차를 읽어 계획표로 옮깁니다. 날짜(11/2, 11월 2일), 주차(2주), 행사/공과/계획 열을 알아서 찾습니다. 구버전 .hwp 는 한글에서 <b>다른 이름으로 저장 → .hwpx</b> 로 바꿔 올려 주세요.</p></div>';
  return h;
}

function planModal(item) {
  if (!can('plan.write')) return toast('계획을 고칠 권한이 없습니다', 'err');
  const isNew = !item;
  const p = item || { date: '', kind: '계획', title: '', detail: '', week: 0 };
  const ym = planState();
  const defDate = p.date || (ym + '-' + pad2(Math.min(new Date().getDate(), 28)));
  let h = '';
  h += '<div class="grid2"><div class="field"><label>날짜</label><input id="plDate" type="date" value="' + esc(defDate) + '" data-change="plan-date"></div>';
  h += '<div class="field"><label>구분</label><select id="plKind">' + opts([['계획', '계획'], ['행사', '행사'], ['공과', '공과'], ['교육', '교육'], ['기타', '기타']], p.kind) + '</select></div></div>';
  h += '<div class="field"><label>제목</label><input id="plTitle" value="' + esc(p.title) + '" placeholder="예: 추수감사주일 행사"></div>';
  h += '<div class="field"><label>내용·준비물</label><textarea id="plDetail" placeholder="예: 2부 예배 후 야외활동 / 간식 준비">' + esc(p.detail || '') + '</textarea></div>';
  h += '<div class="kv"><span>주차</span><b id="plWeek">' + (weekOfMonth(defDate) || '-') + '주차</b></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="save-plan" data-id="' + esc(isNew ? '' : item.id) + '">저장</button></div>';
  openModal(isNew ? '계획 추가' : '계획 수정', h, { focus: 'plTitle' });
}

function savePlan(id) {
  if (!can('plan.write')) return toast('계획을 고칠 권한이 없습니다', 'err');
  const title = val('plTitle');
  const date = val('plDate');
  if (!title) return toast('제목을 입력하세요', 'err');
  if (!date) return toast('날짜를 골라 주세요', 'err');
  const week = weekOfMonth(date);
  let item = null;
  if (id) {
    const p = (S.state.plans || []).find(x => x.id === id);
    if (!p) return;
    p.date = date; p.month = monthKeyOf(date); p.week = week; p.kind = val('plKind') || '계획';
    p.title = title; p.detail = val('plDetail'); touch(p);
    item = p;
  } else {
    item = { id: 'pl-' + Crypto.uid(), deptId: V.planDept, date: date, month: monthKeyOf(date), year: yearOfDate(date) || curYear(), week: week, kind: val('plKind') || '계획', title: title, detail: val('plDetail'), by: S.me.uid, u: Date.now() };
    S.state.plans.push(item);
  }
  syncPlanEvent(item);
  closeModal();
  Sync.save().then(() => { renderApp(); toast('계획을 저장했습니다 · 부서 일정에도 반영', 'ok'); });
}

/* ---------- 한글(.hwpx) 읽기 ---------- */
function fileInput(accept, onPick) {
  let el = document.getElementById('eduFilePicker');
  if (!el) {
    el = document.createElement('input');
    el.type = 'file';
    el.id = 'eduFilePicker';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  el.value = '';
  el.accept = accept;
  el.onchange = () => { const f = el.files && el.files[0]; if (f) onPick(f); };
  el.click();
}

function elTag(el, name) { let n = el; while (n && n.nodeType === 1) { if (String(n.nodeName).split(':').pop().toLowerCase() === name) return n; n = n.parentNode; } return null; }

function hwpxText(el) {
  const parts = [];
  const walk = n => {
    if (n.nodeType === 1 && String(n.nodeName).split(':').pop() === 't') parts.push(n.textContent || '');
    if (n.childNodes) for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
  };
  walk(el);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function dateFromText(txt, ym) {
  const s = String(txt || '');
  const y = Number(String(ym).slice(0, 4)), mo = Number(String(ym).slice(5, 7));
  let m = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) return ymd(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return ymd(new Date(y, Number(m[1]) - 1, Number(m[2])));
  m = s.match(/(?:^|[^\d])(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:[^\d]|$)/);
  if (m) { const mm = Number(m[1]), dd = Number(m[2]); if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return ymd(new Date(y, mm - 1, dd)); }
  m = s.match(/(\d{1,2})\s*일/);
  if (m) { const dd = Number(m[1]); if (dd >= 1 && dd <= 31) return ymd(new Date(y, mo - 1, dd)); }
  return '';
}
function weekFromText(txt) {
  const m = String(txt || '').match(/(\d)\s*주/);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 6) return n; }
  return 0;
}
function kindFromText(txt) {
  const s = String(txt || '');
  if (/공과|말씀|성경|교리/.test(s)) return '공과';
  if (/행사|축제|예배|찬양|체험|소풍|발표|성탄|부활|감사|바자|수련|캠프/.test(s)) return '행사';
  if (/교육|훈련|세미나|강습|교사/.test(s)) return '교육';
  return '계획';
}

/* ---------------- ZIP(한글 .hwpx) 풀기 ----------------
   바깥 라이브러리 없이 ZIP 중앙목록을 직접 읽고, 압축 해제는 브라우저 내장
   DecompressionStream('deflate-raw')으로 합니다. 아주 예전 브라우저에서만 JSZip 을 씁니다. */
function zipEntries(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength || buf.length);
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('압축 파일 구조를 읽지 못했습니다');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const list = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length) break;
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const xlen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    let name = '';
    for (let i = 0; i < nlen; i++) name += String.fromCharCode(bytes[off + 46 + i]);
    try { name = decodeURIComponent(escape(name)); } catch (e) { }
    list.push({ name: name, method: method, csize: csize, lho: lho });
    off += 46 + nlen + xlen + clen;
  }
  return { list: list, dv: dv, bytes: bytes };
}

async function zipRead(zi, entry) {
  const dv = zi.dv, bytes = zi.bytes, lho = entry.lho;
  if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('압축 항목을 읽지 못했습니다');
  const nlen = dv.getUint16(lho + 26, true);
  const xlen = dv.getUint16(lho + 28, true);
  const start = lho + 30 + nlen + xlen;
  const raw = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return raw;
  if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(raw).body.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* .hwpx 안의 본문 XML 문자열들 */
async function hwpxSections(buf) {
  const zi = zipEntries(buf);
  const names = zi.list.map(e => e.name).filter(n => /Contents\/section\d+\.xml$/i.test(n)).sort();
  if (!names.length) throw new Error('한글 문서 본문(section.xml)을 찾지 못했습니다. .hwpx 파일인지 확인해 주세요.');
  const out = [];
  for (const nm of names) {
    const entry = zi.list.find(e => e.name === nm);
    if (!entry) continue;
    let raw;
    try { raw = await zipRead(zi, entry); }
    catch (e) {
      if (e && e.message === 'no-inflate' && window.JSZip) {
        const zip = await JSZip.loadAsync(buf);
        raw = await zip.file(nm).async('uint8array');
      } else throw e;
    }
    out.push(new TextDecoder('utf-8').decode(raw));
  }
  return out;
}

function readFileBytes(file) {
  if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('파일을 읽지 못했습니다'));
    fr.readAsArrayBuffer(file);
  });
}

async function parseHwpxFile(file, ym) {
  const buf = await readFileBytes(file);
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isCfb = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isCfb) throw new Error('구버전 한글(.hwp) 파일입니다. 한글에서 [다른 이름으로 저장] → [한글 문서(*.hwpx)]로 저장한 뒤 올려 주세요.');
  if (!isZip) throw new Error('한글(.hwpx) 파일이 아닙니다. 확장자를 확인해 주세요.');
  const sections = await hwpxSections(buf);
  const parser = new DOMParser();
  const out = [];
  for (const xml of sections) {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) continue;
    // ① 표 먼저
    const tables = Array.prototype.slice.call(doc.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'tbl');
    tables.forEach(tbl => {
      const trs = Array.prototype.slice.call(tbl.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'tr' && elTag(e.parentNode, 'tbl') === tbl);
      const rows = trs.map(tr => {
        const tcs = Array.prototype.slice.call(tr.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'tc' && elTag(e.parentNode, 'tr') === tr);
        return tcs.map(tc => hwpxText(tc));
      }).filter(r => r.some(c => c));
      if (rows.length < 1) return;
      let header = rows[0], start = 1;
      const looksHeader = rows[0].some(c => /날짜|일자|일시|주차|행사|계획|공과|내용|제목|프로그램|구분/.test(c));
      let di = -1, wi = -1, ti = -1, ki = -1, gi = -1;
      const idx = re => header.findIndex(c => re.test(c));
      if (looksHeader) {
        di = idx(/날짜|일자|일시|날/); wi = idx(/주차|주/); ti = idx(/행사|계획|내용|제목|프로그램|일정/); ki = idx(/구분|종류/); gi = idx(/공과|말씀|성경|교리/);
      } else { start = 0; }
      if (di < 0 && !looksHeader) di = 0;
      if (ti < 0) ti = rows[0].length > 1 ? 1 : 0;
      rows.slice(start).forEach(row => {
        if (!row.some(c => c)) return;
        const dText = di >= 0 ? row[di] : '';
        const date = dateFromText(dText, ym) || dateFromText(row.join(' '), ym);
        let title = ti >= 0 ? row[ti] : '';
        if (!title) title = row.slice().sort((a, b) => b.length - a.length)[0] || '';
        const rest = row.filter((c, i) => i !== di && i !== ti && i !== gi && i !== wi && c);
        const week = weekFromText(wi >= 0 ? row[wi] : '') || weekFromText(row.join(' ')) || (date ? weekOfMonth(date) : 0);
        if (!title) return;
        out.push({ date: date, week: week, kind: kindFromText((ki >= 0 ? row[ki] : '') + ' ' + title), title: title, detail: rest.join(' · ') });
        /* 공과 열이 따로 있으면 공과 항목으로 한 줄 더 */
        const lessonCell = gi >= 0 ? String(row[gi] || '').trim() : '';
        if (lessonCell && lessonCell !== title) out.push({ date: date, week: week, kind: '공과', title: lessonCell, detail: '' });
      });
    });
    // ② 표 밖 문단
    if (!tables.length) {
      const ps = Array.prototype.slice.call(doc.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'p' && !elTag(e.parentNode, 'tbl'));
      ps.forEach(p => {
        const txt = hwpxText(p);
        if (!txt || txt.length < 2) return;
        const date = dateFromText(txt, ym);
        const week = weekFromText(txt);
        if (!date && !week) return;
        const title = txt.replace(/^\s*[\d.\/\-월일()\[\]주차\s:~]+/, '').trim() || txt;
        out.push({ date: date, week: week || (date ? weekOfMonth(date) : 0), kind: kindFromText(txt), title: title, detail: '' });
      });
    }
  }
  // 중복 제거
  const seen = {};
  return out.filter(it => {
    const k = (it.date || '') + '|' + (it.week || '') + '|' + it.title;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  }).filter(it => it.title && (it.date || it.week));
}

async function importHwpx(file) {
  const ym = planState();
  toast('한글파일을 읽는 중…');
  try {
    const items = await parseHwpxFile(file, ym);
    if (!items.length) return toast('계획으로 옮길 날짜·행사를 찾지 못했습니다', 'err');
    V.hwpxPreview = items.map((it, i) => Object.assign({}, it, { on: true }));
    V.hwpxPreviewName = file.name;
    hwpxPreviewModal(file.name, ym);
  } catch (e) {
    toast((e && e.message) || '한글파일을 읽지 못했습니다', 'err');
  }
}

function hwpxPreviewModal(fname, ym) {
  const items = V.hwpxPreview || [];
  let h = '<div class="banner sky">' + esc(fname) + ' 에서 ' + items.length + '건을 찾았습니다. 계획표에 넣을 항목만 남겨 주세요.</div>';
  h += '<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="hwpx-all" data-v="1">전체 선택</button><button class="btn sm ghost" data-act="hwpx-all" data-v="0">전체 해제</button></div>';
  h += '<div class="list">';
  items.forEach((it, i) => {
    h += '<button class="item" data-act="hwpx-toggle" data-i="' + i + '"><span class="av">' + (it.on ? '☑' : '☐') + '</span><span class="tx"><b>' + esc(it.title) + '</b><span>' + (it.date ? esc(fmtDate(it.date)) : '') + (it.week ? ' · ' + it.week + '주차' : '') + ' · ' + esc(it.kind) + (it.detail ? ' · ' + esc(it.detail) : '') + '</span></span></button>';
  });
  h += '</div>';
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="hwpx-import">계획표에 반영</button></div>';
  openModal('한글파일 → 월별계획표', h);
}

async function doHwpxImport() {
  const items = (V.hwpxPreview || []).filter(it => it.on);
  if (!items.length) return toast('반영할 항목을 골라 주세요', 'err');
  items.forEach(it => {
    const item = {
      id: 'pl-' + Crypto.uid(), deptId: V.planDept, date: it.date || '', month: monthKeyOf(it.date || (planState() + '-01')),
      year: yearOfDate(it.date) || curYear(),
      week: it.week || (it.date ? weekOfMonth(it.date) : 0), kind: it.kind || '계획', title: it.title, detail: it.detail || '',
      by: S.me.uid, from: 'hwpx', u: Date.now()
    };
    S.state.plans.push(item);
    syncPlanEvent(item);
  });
  closeModal();
  V.hwpxPreview = null;
  await Sync.save();
  renderApp();
  toast(items.length + '건을 계획표와 부서 일정에 반영했습니다', 'ok');
}

/* ================= 5. 회계 ================= */
function ledgerState() {
  if (!V.ledMonth) V.ledMonth = monthKeyOf((typeof V !== 'undefined' && V.date) || ymd());
  if (V.ledDept === undefined) V.ledDept = '';
  return V.ledMonth;
}
function ledgerView() {
  if (!can('ledger.manage')) return '<div class="card">' + emptyBox('🔒', '회계는 교육부서담당·목회자·관리자만 볼 수 있습니다') + '</div>';
  const ym = ledgerState();
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  const all = (S.state.ledger || []).filter(e => !e._del && inYear(e));
  const scopeAll = V.ledDept ? all.filter(e => e.deptId === V.ledDept) : all;
  const list = scopeAll.filter(e => monthKeyOf(e.date) === ym).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const inc = incomeTotal(list), exp = expenseTotal(list);
  const cumInc = incomeTotal(scopeAll.filter(e => monthKeyOf(e.date) <= ym));
  const cumExp = expenseTotal(scopeAll.filter(e => monthKeyOf(e.date) <= ym));

  let h = subHead('회계 관리', '부서 수입·지출과 영수증을 한 곳에서 정리합니다',
    '<button class="btn sm" data-act="led-print">🖨 인쇄</button>');
  h += '<div class="card flat" style="padding:12px">' + monthBar('ledMonth', ym, 'led-month') +
    '<div class="row wrap" style="gap:6px"><button class="chip big ' + (!V.ledDept ? 'coral' : 'gray') + '" data-act="led-dept" data-id="">전체 부서</button>' +
    depts.map(d => '<button class="chip big ' + (d.id === V.ledDept ? 'coral' : 'gray') + '" data-act="led-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div></div>';

  h += '<div class="stat-grid" style="margin-bottom:12px"><div class="stat present"><b>' + money(inc) + '</b><span>이번 달 수입</span></div><div class="stat absent"><b>' + money(exp) + '</b><span>이번 달 지출</span></div><div class="stat enroll"><b>' + money(inc - exp) + '</b><span>이번 달 수지</span></div><div class="stat new"><b>' + money(cumInc - cumExp) + '</b><span>누계 잔액</span></div></div>';

  h += '<div class="row" style="margin-bottom:10px"><button class="btn primary" data-act="new-ledger" data-type="in">＋ 수입 기록</button><button class="btn" data-act="new-ledger" data-type="out">－ 지출 기록</button></div>';

  if (!list.length) h += '<div class="card">' + emptyBox('💰', '이 달 회계 기록이 없습니다', '수입·지출을 기록하면 주일보고 수입란에 자동으로 연결됩니다') + '</div>';
  else {
    h += '<div class="list">';
    list.forEach(e => {
      const d = deptById(e.deptId) || {};
      h += '<div class="item led-item"><span class="av" style="background:' + (e.type === 'in' ? '#e7f7ee' : '#fdeaf0') + ';color:' + (e.type === 'in' ? '#2c7d59' : '#c33e5f') + '">' + (e.type === 'in' ? '＋' : '－') + '</span>';
      h += '<span class="tx" data-act="edit-ledger" data-id="' + esc(e.id) + '"><b>' + esc(e.category || (e.type === 'in' ? '수입' : '지출')) + (e.memo ? ' · ' + esc(e.memo) : '') + '</b><span>' + esc(fmtShort(e.date)) + ' · ' + esc(d.name || '공통') + (e.receipt ? ' · 📷 영수증' : '') + '</span></span>';
      h += '<span class="rt"><b style="color:' + (e.type === 'in' ? '#2c7d59' : '#c33e5f') + '">' + money(e.amount) + '원</b>';
      if (e.receipt) h += '<button class="btn sm ghost" data-act="led-receipt" data-id="' + esc(e.id) + '">보기</button>';
      h += '</span></div>';
    });
    h += '</div>';
    h += '<div class="kv" style="margin-top:10px"><span>수입 합계</span><b>' + money(inc) + '원</b></div><div class="kv"><span>지출 합계</span><b>' + money(exp) + '원</b></div>';
  }
  h += '<p class="muted" style="margin-top:12px">주일보고에는 이 주(일~토)의 <b>수입만</b> 연결됩니다. 지출은 주일보고에 들어가지 않습니다.</p>';
  return h;
}

function ledgerModal(entry, type) {
  const isNew = !entry;
  const e = entry || { date: ymd(), type: type || 'in', category: '', memo: '', amount: '', deptId: V.ledDept || (visibleDepts()[0] || {}).id || '' };
  V.receiptDraft = e.receipt || null;
  const cats = e.type === 'in' ? ['헌금', '주일헌금', '감사헌금', '특별헌금', '찬조', '기타수입'] : ['교육자료', '간식·식비', '행사물품', '선물·상품', '교통비', '기타지출'];
  let h = '';
  h += '<div class="row" style="gap:6px;margin-bottom:10px"><button class="chip big ' + (e.type === 'in' ? 'mint' : 'gray') + '" data-act="led-type" data-v="in">수입</button><button class="chip big ' + (e.type === 'out' ? 'rose' : 'gray') + '" data-act="led-type" data-v="out">지출</button></div>';
  h += '<div class="grid2"><div class="field"><label>날짜</label><input id="lgDate" type="date" value="' + esc(e.date) + '"></div>';
  h += '<div class="field"><label>금액(원)</label><input id="lgAmount" type="text" inputmode="numeric" value="' + esc(e.amount === '' ? '' : money(e.amount).replace(/,/g, '')) + '" placeholder="0"></div></div>';
  h += '<div class="field"><label>항목</label><select id="lgCat">' + opts(cats.map(c => [c, c]).concat([['직접입력', '＋ 직접 입력…']]), e.category) + '</select></div>';
  h += '<div class="field"><label>내용</label><input id="lgMemo" value="' + esc(e.memo || '') + '" placeholder="예: 11월 둘째주일 헌금"></div>';
  h += '<div class="field"><label>부서</label><select id="lgDept">' + opts(visibleDepts().map(d => [d.id, d.name]), e.deptId) + '</select></div>';
  h += '<div class="field"><label>영수증 사진</label><div class="row"><button class="btn sm" data-act="pick-receipt">📷 사진 올리기</button><span class="sp"></span><span class="muted" id="rcvInfo">' + (V.receiptDraft ? '첨부됨' : '없음') + '</span></div><div id="rcvBox">' + (V.receiptDraft ? receiptImg(V.receiptDraft, 120) : '') + '</div><div class="hint">사진은 이 기기에서 줄이고 암호화해 저장합니다(원본은 보내지 않습니다).</div></div>';
  h += '<div class="row" style="margin-top:10px">' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-ledger" data-id="' + esc(e.id) + '">삭제</button>') + '<span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-ledger" data-id="' + esc(isNew ? '' : e.id) + '">저장</button></div>';
  openModal(isNew ? (e.type === 'in' ? '수입 기록' : '지출 기록') : '회계 수정', h, { focus: 'lgAmount' });
  V.ledDraftType = e.type;
}

function receiptImg(r, w) {
  if (!r || !r.b64) return '';
  return '<img class="receipt-thumb" style="max-width:' + (w || 200) + 'px" src="data:image/jpeg;base64,' + r.b64 + '" alt="영수증">';
}

function readImage(file) {
  return new Promise((res, rej) => {
    if (window.createImageBitmap) {
      createImageBitmap(file).then(b => res(b)).catch(() => viaImg());
    } else viaImg();
    function viaImg() {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했습니다')); };
      img.src = url;
    }
  });
}

async function compressReceipt(file) {
  const img = await readImage(file);
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  let side = 900;
  for (let a = 0; a < 6; a++) {
    const sc = Math.min(1, side / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * sc)), hh = Math.max(1, Math.round(ih * sc));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
    ctx.drawImage(img, 0, 0, w, hh);
    let q = 0.75;
    for (let k = 0; k < 6; k++) {
      const url = cv.toDataURL('image/jpeg', q);
      if (url.length <= 42000) return { b64: url.split(',')[1], w: w, h: hh };
      q = Math.max(0.28, q - 0.12);
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('영수증 사진을 줄이지 못했습니다. 다른 사진으로 시도해 주세요.');
}

function saveLedger(id) {
  const amount = Number(String(val('lgAmount')).replace(/[^0-9]/g, '')) || 0;
  const date = val('lgDate');
  let cat = val('lgCat');
  if (cat === '직접입력') cat = prompt('항목 이름을 입력하세요', '') || '기타';
  if (!amount) return toast('금액을 입력하세요', 'err');
  if (!date) return toast('날짜를 골라 주세요', 'err');
  const type = V.ledDraftType || 'in';
  const row = {
    date: date, type: type, category: cat || (type === 'in' ? '수입' : '지출'),
    memo: val('lgMemo'), amount: amount, deptId: val('lgDept') || '', receipt: V.receiptDraft || null
  };
  if (id) {
    const e = (S.state.ledger || []).find(x => x.id === id);
    if (!e) return;
    Object.assign(e, row); touch(e);
  } else {
    S.state.ledger.push(Object.assign({ id: 'lg-' + Crypto.uid(), year: yearOfDate(row.date) || curYear(), by: S.me.uid, u: Date.now() }, row));
  }
  closeModal();
  V.receiptDraft = null;
  Sync.save().then(() => { renderApp(); toast('저장했습니다', 'ok'); });
}

function printLedger() {
  const ym = ledgerState();
  const depts = visibleDepts();
  const all = (S.state.ledger || []).filter(e => !e._del && monthKeyOf(e.date) === ym && (!V.ledDept || e.deptId === V.ledDept));
  const inc = incomeTotal(all), exp = expenseTotal(all);
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  const rows = all.map((e, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(e.date) + '</td><td>' + esc((deptById(e.deptId) || {}).name || '공통') + '</td><td>' + esc(e.category || '') + '</td><td>' + esc(e.memo || '') + '</td><td class="num">' + (e.type === 'in' ? money(e.amount) : '') + '</td><td class="num">' + (e.type === 'out' ? money(e.amount) : '') + '</td></tr>').join('');
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>회계보고</title><style>' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;padding:24px;color:#222}h1{font-size:19px;text-align:center;margin:0 0 4px}h2{font-size:12px;color:#777;text-align:center;margin:0 0 16px;font-weight:600}' +
    'table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px 7px}th{background:#f4f0ec}td.num{text-align:right}tfoot td{font-weight:700;background:#faf7f4}' +
    '</style></head><body><h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 회계보고</h1>' +
    '<h2>' + esc(monthLabel(ym)) + (V.ledDept ? ' · ' + esc((deptById(V.ledDept) || {}).name || '') : ' · 전체 부서') + '</h2>' +
    '<table><thead><tr><th>번호</th><th>날짜</th><th>부서</th><th>항목</th><th>내용</th><th>수입</th><th>지출</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" style="text-align:center">기록 없음</td></tr>') + '</tbody>' +
    '<tfoot><tr><td colspan="5">합계</td><td class="num">' + money(inc) + '</td><td class="num">' + money(exp) + '</td></tr>' +
    '<tr><td colspan="5">이번 달 수지</td><td class="num" colspan="2">' + money(inc - exp) + '</td></tr></tfoot></table>' +
    '<p style="font-size:10px;color:#999;text-align:center;margin-top:14px">덕신교회 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}

/* ================= 6. 출석통계 ================= */
function statState() {
  if (!V.statMonth) V.statMonth = monthKeyOf((typeof V !== 'undefined' && V.date) || ymd());
  return V.statMonth;
}
function statYear() {
  if (!V.statYear) V.statYear = Number(String((typeof V !== 'undefined' && V.date) || ymd()).slice(0, 4));
  return V.statYear;
}
function yearBar() {
  return '<div class="daybar"><button class="icon-btn" data-act="stat-year" data-v="-1">‹</button>' +
    '<div class="month-label">' + statYear() + '년</div>' +
    '<button class="icon-btn" data-act="stat-year" data-v="1">›</button></div>';
}
/* 전 부서 통합 통계 (목회자 주일보고 허브·출석통계 전체 보기에서 함께 씀) */
function integratedStatsHtml(ym, depts, withAnnual) {
  ym = ym || statState();
  depts = depts || visibleDepts();
  let h = '';

    const rowsAll = (S.state.attendance || []).filter(a => !a._del && !a.staff && monthKeyOf(a.date) === ym && depts.some(d => d.id === a.deptId));
    const totalP = rowsAll.filter(a => a.status === 'present').length;
    const totalA = rowsAll.filter(a => a.status === 'absent').length;
    const totalE = rowsAll.filter(a => a.status === 'excused').length;
    const totalT = totalP + totalA + totalE;
    const rateAll = totalT ? Math.round(((totalP + totalE) / totalT) * 100) : 0;
    const enrolledAll = depts.reduce((n, d) => n + studentsOfDeptIn(d.id, Number(String(ym).slice(0, 4))).length, 0);
    h += '<div class="stat-grid" style="margin-bottom:12px"><div class="stat present"><b>' + rateAll + '%</b><span>전체 출석률</span></div><div class="stat enroll"><b>' + enrolledAll + '</b><span>전체 재적</span></div><div class="stat absent"><b>' + totalA + '</b><span>전체 결석</span></div><div class="stat new"><b>' + totalE + '</b><span>전체 인정</span></div></div>';

    h += '<div class="card"><h3>🏫 부서별 비교 <span class="sp"></span><small>' + esc(monthLabel(ym)) + '</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>부서</th><th class="num">재적</th><th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
    depts.forEach(d => {
      const rs = rowsAll.filter(a => a.deptId === d.id);
      const p = rs.filter(a => a.status === 'present').length, ab = rs.filter(a => a.status === 'absent').length, ex = rs.filter(a => a.status === 'excused').length;
      const t = p + ab + ex;
      h += '<tr><td>' + esc((d.emoji || '') + ' ' + d.name) + '</td><td class="num">' + studentsOfDeptIn(d.id, Number(String(ym).slice(0, 4))).length + '</td><td class="num">' + p + '</td><td class="num">' + ab + '</td><td class="num">' + ex + '</td><td class="num"><b>' + (t ? Math.round(((p + ex) / t) * 100) : 0) + '%</b></td></tr>';
    });
    h += '</tbody></table></div></div>';

    h += '<div class="card"><h3>👥 전체 명단 <span class="sp"></span><small>' + enrolledAll + '명</small></h3>';
    if (!enrolledAll) h += '<p class="muted" style="margin:0">등록된 학생이 없습니다.</p>';
    else {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>부서</th><th>반</th><th>이름</th><th>생일</th><th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
      depts.forEach(d => {
        studentsOfDeptIn(d.id, Number(String(ym).slice(0, 4))).forEach(s => {
          const rs = rowsAll.filter(a => a.studentId === s.id);
          const p = rs.filter(a => a.status === 'present').length, ab = rs.filter(a => a.status === 'absent').length, ex = rs.filter(a => a.status === 'excused').length;
          const t = p + ab + ex;
          h += '<tr><td>' + esc(d.name) + '</td><td>' + esc((classById(s.classId) || {}).name || '-') + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.birth ? birthShort(s.birth) : '-') + '</td><td class="num">' + p + '</td><td class="num">' + ab + '</td><td class="num">' + ex + '</td><td class="num"><b>' + (t ? Math.round(((p + ex) / t) * 100) : 0) + '%</b></td></tr>';
        });
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    if (withAnnual !== false) {
      h += '<div class="sect-title">📅 연간 통합 출결표 · ' + statYear() + '년</div>';
      h += annualSheetHtml({ year: statYear(), deptIds: depts.map(d => d.id), showDept: true, compact: true });
    }
  return h;
}

/* ================= 6-2. 기간별 통합 통계 (주간·월간·반기·연간) ================= */
function lastSundayOfMonth(y, m) {
  const d = new Date(y, m, 0);
  d.setDate(d.getDate() - d.getDay());
  return ymd(d);
}
function statPeriodRange(kind) {
  const ym = statState();
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  if (kind === 'year') {
    const yy = statYear();
    return { from: yy + '-01-01', to: yy + '-12-31', year: yy, label: yy + '년 연간' };
  }
  if (kind === 'week') {
    const today = ymd();
    const sun = (y === Number(today.slice(0, 4)) && m === Number(today.slice(5, 7))) ? lastSunday() : lastSundayOfMonth(y, m);
    const r = weekRangeAround(sun);
    return { from: r.from, to: r.to, year: y, label: fmtShort(r.from) + '~' + fmtShort(r.to) + ' 주간', sun: sun };
  }
  if (kind === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;          /* 1~3월 1분기 · 4~6월 2분기 · 7~9월 3분기 · 10~12월 4분기 */
    const fm = (q - 1) * 3 + 1, tm = fm + 2;
    const dim = new Date(y, tm, 0).getDate();
    return {
      from: y + '-' + pad2(fm) + '-01', to: y + '-' + pad2(tm) + '-' + pad2(dim), year: y, quarter: q,
      months: [fm, tm], label: y + '년 ' + q + '분기 (' + fm + '~' + tm + '월)'
    };
  }
  if (kind === 'half') {
    const first = m <= 6;
    return {
      from: y + (first ? '-01-01' : '-07-01'), to: y + (first ? '-06-30' : '-12-31'), year: y,
      half: first ? 1 : 2,
      label: y + '년 ' + (first ? '상반기 (1~6월)' : '하반기 (7~12월)')
    };
  }
  const dim = new Date(y, m, 0).getDate();
  return { from: ym + '-01', to: ym + '-' + pad2(dim), year: y, label: monthLabel(ym) };
}

/* 기간 이동 막대 — 주간은 1주, 월간은 1달, 분기는 3달, 반기는 6달씩 움직입니다 */
function periodNavBar(kind) {
  if (kind === 'year') return yearBar();
  const step = kind === 'quarter' ? 3 : kind === 'half' ? 6 : 1;
  const r = statPeriodRange(kind);
  const ym = statState();
  const mid = kind === 'half' ? (r.half === 1 ? '상반기' : '하반기') : kind === 'quarter' ? r.quarter + '분기' : monthLabel(ym);
  const sub = kind === 'half' || kind === 'quarter' ? ' <small style="font-weight:600;color:#999;font-size:10.5px">' + esc(ym.slice(0, 4)) + '년</small>' : '';
  return '<div class="daybar"><button class="icon-btn" data-act="stat-period-move" data-v="-' + step + '">‹</button>' +
    '<div class="month-label">' + esc(mid) + sub + '</div>' +
    '<button class="icon-btn" data-act="stat-period-move" data-v="' + step + '">›</button></div>';
}

/* 선택한 기간 안의 주일(일요일) 날짜 */
function periodSundays(r) {
  return sundaysOfYear(Number(r.year) || curYear()).filter(d => d >= r.from && d <= r.to);
}
/* 기간별 전체 아동 · 날짜별 출결 자료 */
function periodRoster(r, depts) {
  const sundays = periodSundays(r);
  const mark = {};
  (S.state.attendance || []).forEach(a => {
    if (!a || a._del || a.staff || !a.studentId) return;
    if (a.date < r.from || a.date > r.to) return;
    mark[a.studentId + '|' + a.date] = a.status;
  });
  const groups = [];
  (depts || []).forEach(d => {
    const studs = studentsOfDeptIn(d.id, r.year).slice().sort((a, b) => {
      const ca = classById(a.classId), cb = classById(b.classId);
      const oa = ca ? (ca.order || 0) : 999, ob = cb ? (cb.order || 0) : 999;
      if (oa !== ob) return oa - ob;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
    if (!studs.length) return;
    groups.push({ dept: d, studs: studs });
  });
  return { sundays: sundays, mark: mark, groups: groups, total: groups.reduce((n, g) => n + g.studs.length, 0) };
}
function rosterMark(st) { return st === 'present' ? '○' : st === 'absent' ? '✕' : st === 'excused' ? '◎' : '-'; }
function rosterCountOf(mark, sid, sundays) {
  const c = { p: 0, a: 0, e: 0, n: 0 };
  sundays.forEach(d => {
    const st = mark[sid + '|' + d];
    if (st === 'present') c.p++;
    else if (st === 'absent') c.a++;
    else if (st === 'excused') c.e++;
    else c.n++;
  });
  c.t = c.p + c.a + c.e;
  c.rate = c.t ? Math.round(((c.p + c.e) / c.t) * 100) : 0;
  return c;
}
/* 화면용 — 기간 안 주일별 출결 표 (옆으로 밀어서 봄) */
function periodRosterHtml(r, depts) {
  const data = periodRoster(r, depts);
  let h = '<div class="card"><h3>👥 전체 아동 · 날짜별 출결 <span class="sp"></span><small>' + data.total + '명 · 주일 ' + data.sundays.length + '회</small></h3>';
  if (!data.total) return h + '<p class="muted" style="margin:0">등록된 아동이 없습니다.</p></div>';
  h += '<p class="muted" style="margin:0 0 8px">○ 출석 · ✕ 결석 · ◎ 인정 · - 미기록 &nbsp;|&nbsp; 표를 옆으로 밀어 보세요. 인쇄는 🖨️ 인쇄 → <b>전체 아동 날짜별 출결</b>을 켜면 됩니다.</p>';
  data.groups.forEach(g => {
    h += '<div class="sect-title" style="margin:10px 0 6px">' + esc((g.dept.emoji || '') + ' ' + g.dept.name) + ' <small>' + g.studs.length + '명</small></div>';
    h += '<div class="tbl-wrap"><table class="tbl annual"><thead><tr><th>반</th><th>이름</th>';
    data.sundays.forEach(d => { h += '<th class="sun">' + esc(fmtShort(d)) + '</th>'; });
    h += '<th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
    g.studs.forEach(s => {
      const c = rosterCountOf(data.mark, s.id, data.sundays);
      h += '<tr><td>' + esc((classById(s.classId) || {}).name || '-') + '</td><td>' + esc(s.name) + (c.n === data.sundays.length ? '' : '') + '</td>';
      data.sundays.forEach(d => {
        const st = data.mark[s.id + '|' + d];
        h += '<td class="sun att-' + (st || 'none') + '">' + rosterMark(st) + '</td>';
      });
      h += '<td class="num">' + c.p + '</td><td class="num">' + c.a + '</td><td class="num">' + c.e + '</td><td class="num"><b>' + c.rate + '%</b></td></tr>';
    });
    /* 부서 소계 */
    const sum = g.studs.reduce((t, s) => { const c = rosterCountOf(data.mark, s.id, data.sundays); t.p += c.p; t.a += c.a; t.e += c.e; t.t += c.t; return t; }, { p: 0, a: 0, e: 0, t: 0 });
    h += '<tr style="background:#faf7f4"><td colspan="2"><b>소계</b></td>';
    for (let i = 0; i < data.sundays.length; i++) h += '<td class="sun"></td>';
    h += '<td class="num"><b>' + sum.p + '</b></td><td class="num"><b>' + sum.a + '</b></td><td class="num"><b>' + sum.e + '</b></td><td class="num"><b>' + (sum.t ? Math.round(((sum.p + sum.e) / sum.t) * 100) : 0) + '%</b></td></tr>';
    h += '</tbody></table></div>';
  });
  h += '</div>';
  return h;
}
function periodStatsHtml(kind, depts) {
  const r = statPeriodRange(kind);
  const rowsAll = (S.state.attendance || []).filter(a => !a._del && !a.staff && a.date >= r.from && a.date <= r.to && depts.some(d => d.id === a.deptId));
  const p = rowsAll.filter(a => a.status === 'present').length;
  const ab = rowsAll.filter(a => a.status === 'absent').length;
  const ex = rowsAll.filter(a => a.status === 'excused').length;
  const t = p + ab + ex;
  const rate = t ? Math.round(((p + ex) / t) * 100) : 0;
  const enrolled = depts.reduce((n, d) => n + studentsOfDeptIn(d.id, r.year).length, 0);
  const dates = Array.from(new Set(rowsAll.map(a => a.date))).sort();
  let h = '';

  h += '<div class="banner sky" style="margin-bottom:10px"><b>' + esc(r.label) + '</b> · 주일 ' + dates.length + '회 · ' + esc(fmtShort(r.from)) + '~' + esc(fmtShort(r.to)) + '</div>';
  h += '<div class="stat-grid" style="margin-bottom:12px"><div class="stat present"><b>' + rate + '%</b><span>전체 출석률</span></div><div class="stat enroll"><b>' + enrolled + '</b><span>전체 재적</span></div><div class="stat absent"><b>' + ab + '</b><span>전체 결석</span></div><div class="stat new"><b>' + ex + '</b><span>전체 인정</span></div></div>';

  h += '<div class="card"><h3>🏫 부서별 비교 <span class="sp"></span><small>' + esc(r.label) + '</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>부서</th><th class="num">재적</th><th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
  depts.forEach(d => {
    const rs = rowsAll.filter(a => a.deptId === d.id);
    const dp = rs.filter(a => a.status === 'present').length, da = rs.filter(a => a.status === 'absent').length, de = rs.filter(a => a.status === 'excused').length;
    const dt = dp + da + de;
    h += '<tr><td>' + esc((d.emoji || '') + ' ' + d.name) + '</td><td class="num">' + studentsOfDeptIn(d.id, r.year).length + '</td><td class="num">' + dp + '</td><td class="num">' + da + '</td><td class="num">' + de + '</td><td class="num"><b>' + (dt ? Math.round(((dp + de) / dt) * 100) : 0) + '%</b></td></tr>';
  });
  h += '<tr><td><b>전체</b></td><td class="num"><b>' + enrolled + '</b></td><td class="num"><b>' + p + '</b></td><td class="num"><b>' + ab + '</b></td><td class="num"><b>' + ex + '</b></td><td class="num"><b>' + rate + '%</b></td></tr>';
  h += '</tbody></table></div></div>';

  /* 기간이 두 달 이상이면 달별 추이 */
  const months = Array.from(new Set(rowsAll.map(a => monthKeyOf(a.date)))).sort();
  if (months.length > 1) {
    h += '<div class="card"><h3>🗓️ 달별 추이</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>달</th><th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
    months.forEach(mk => {
      const rs = rowsAll.filter(a => monthKeyOf(a.date) === mk);
      const mp = rs.filter(a => a.status === 'present').length, ma = rs.filter(a => a.status === 'absent').length, me = rs.filter(a => a.status === 'excused').length;
      const mt = mp + ma + me;
      h += '<tr><td>' + Number(mk.slice(5, 7)) + '월</td><td class="num">' + mp + '</td><td class="num">' + ma + '</td><td class="num">' + me + '</td><td class="num"><b>' + (mt ? Math.round(((mp + me) / mt) * 100) : 0) + '%</b></td></tr>';
    });
    h += '</tbody></table></div></div>';
  }

  /* 주일별 출석률 */
  if (dates.length) {
    h += '<div class="card"><h3>📈 주일별 출석률<span class="sp"></span><small>출석+인정 / 기록</small></h3>';
    dates.forEach(d => {
      const rs = rowsAll.filter(a => a.date === d);
      const dp = rs.filter(a => a.status === 'present').length, de = rs.filter(a => a.status === 'excused').length;
      const pct = rs.length ? Math.round(((dp + de) / rs.length) * 100) : 0;
      h += '<div class="bar-row"><span class="bar-lb">' + esc(fmtShort(d)) + ' 주일</span><span class="bar-track"><i style="width:' + pct + '%" class="' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low') + '"></i></span><span class="bar-val">' + pct + '% <small>(' + (dp + de) + '/' + rs.length + ')</small></span></div>';
    });
    h += '</div>';
  }

  /* 기간 안 전체 아동 · 주일별 출결표 */
  h += periodRosterHtml(r, depts);
  return h;
}
/* ================= 기간 통계 인쇄 (선택: 요약 / 전체 아동 날짜별 출결) ================= */
function printRosterTableHtml(g, sundays, mark) {
  /* 달 묶음 머리글 — 1월 · 2월 … */
  const months = [];
  sundays.forEach(d => {
    const k = String(d).slice(5, 7);
    const last = months[months.length - 1];
    if (last && last.k === k) last.n++;
    else months.push({ k: k, n: 1 });
  });
  let h = '<table class="roster"><colgroup><col class="c-cls"><col class="c-nm">';
  for (let i = 0; i < sundays.length; i++) h += '<col class="c-d">';
  h += '<col class="c-t"><col class="c-t"><col class="c-t"><col class="c-r"></colgroup><thead><tr>';
  h += '<th rowspan="2">반</th><th rowspan="2">이름</th>';
  months.forEach(m => { h += '<th colspan="' + m.n + '" class="m">' + Number(m.k) + '월</th>'; });
  h += '<th rowspan="2">출석</th><th rowspan="2">결석</th><th rowspan="2">인정</th><th rowspan="2">출석률</th></tr><tr>';
  sundays.forEach(d => { h += '<th class="d">' + Number(String(d).slice(5, 7)) + '/' + Number(String(d).slice(8, 10)) + '</th>'; });
  h += '</tr></thead><tbody>';
  let sum = { p: 0, a: 0, e: 0, t: 0 };
  g.studs.forEach(s => {
    const c = rosterCountOf(mark, s.id, sundays);
    sum.p += c.p; sum.a += c.a; sum.e += c.e; sum.t += c.t;
    h += '<tr><td class="cl">' + esc((classById(s.classId) || {}).name || '-') + '</td><td class="nm">' + esc(s.name) + '</td>';
    sundays.forEach(d => {
      const st = mark[s.id + '|' + d];
      h += '<td class="d ' + (st || 'none') + '">' + rosterMark(st) + '</td>';
    });
    h += '<td class="t">' + c.p + '</td><td class="t">' + c.a + '</td><td class="t">' + c.e + '</td><td class="t"><b>' + c.rate + '%</b></td></tr>';
  });
  h += '<tr class="sub"><td colspan="2">소계 · ' + g.studs.length + '명</td>';
  for (let i = 0; i < sundays.length; i++) h += '<td class="d"></td>';
  h += '<td class="t">' + sum.p + '</td><td class="t">' + sum.a + '</td><td class="t">' + sum.e + '</td><td class="t">' + (sum.t ? Math.round(((sum.p + sum.e) / sum.t) * 100) : 0) + '%</td></tr>';
  h += '</tbody></table>';
  return h;
}
function periodPrintHtml(kind, opts) {
  opts = opts || {};
  const withSummary = opts.summary !== false;
  const withRoster = opts.roster !== false;
  const r = statPeriodRange(kind);
  const depts = visibleDepts();
  const rowsAll = (S.state.attendance || []).filter(a => !a._del && !a.staff && a.date >= r.from && a.date <= r.to && depts.some(d => d.id === a.deptId));
  const p = rowsAll.filter(a => a.status === 'present').length, ab = rowsAll.filter(a => a.status === 'absent').length, ex = rowsAll.filter(a => a.status === 'excused').length;
  const t = p + ab + ex;
  const enrolled = depts.reduce((n, d) => n + studentsOfDeptIn(d.id, r.year).length, 0);
  const church = (S.state.settings && S.state.settings.church) || '덕신교회';
  let h = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>통합 출석통계 · ' + esc(r.label) + '</title><style>' +
    '@page{size:A4 ' + (withRoster ? 'landscape' : 'portrait') + ';margin:8mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#222;margin:0}' +
    'h1{font-size:16px;text-align:center;margin:0 0 2px}h2{font-size:11px;color:#666;text-align:center;margin:0 0 8px;font-weight:600}' +
    'h3{font-size:11.5px;margin:8px 0 3px}' +
    '.sum{display:flex;gap:6px;margin:0 0 7px;font-size:10px}.sum div{flex:1;border:1px solid #999;border-radius:5px;padding:4px;text-align:center}.sum b{display:block;font-size:13px}' +
    '.st{border-collapse:collapse;width:100%;font-size:10.5px;margin-bottom:6px}.st th,.st td{border:1px solid #999;padding:3px 5px}.st th{background:#f2eeea}.st td.num{text-align:right}' +
    '.roster{border-collapse:collapse;width:100%;table-layout:fixed;font-size:7px;margin-bottom:8px}' +
    '.roster th,.roster td{border:1px solid #aaa;padding:1px 0;text-align:center;line-height:1.15}' +
    '.roster thead{display:table-header-group}.roster tr{page-break-inside:avoid}' +
    '.roster th{background:#f2eeea;font-weight:700}.roster th.m{background:#eae4de}' +
    '.roster td.cl,.roster td.nm{text-align:left;padding-left:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.roster td.d.present{color:#137a4b;font-weight:700}.roster td.d.absent{color:#c02a4e;font-weight:700}.roster td.d.excused{color:#8a6d00}.roster td.d.none{color:#bbb}' +
    '.roster td.t{font-weight:700}.roster tr.sub td{background:#f7f4f1;font-weight:700}' +
    '.roster col.c-cls{width:44px}.roster col.c-nm{width:64px}.roster col.c-t{width:24px}.roster col.c-r{width:34px}' +
    '.brk{page-break-before:always}.foot{font-size:8px;color:#999;text-align:center;margin-top:6px}' +
    '</style></head><body>';
  h += '<h1>' + esc(church) + ' 교육부서 통합 출석통계</h1>';
  h += '<h2>' + esc(r.label) + ' · ' + esc(fmtShort(r.from)) + '~' + esc(fmtShort(r.to)) + ' · ' + (canSeeAllDepts() ? '전체 부서' : (depts.length ? depts.map(d => esc(d.name)).join(' · ') : '부서')) + '</h2>';
  h += '<div class="sum"><div><b>' + (t ? Math.round(((p + ex) / t) * 100) : 0) + '%</b>출석률</div><div><b>' + enrolled + '</b>재적</div><div><b>' + p + '</b>출석</div><div><b>' + ab + '</b>결석</div><div><b>' + ex + '</b>인정</div></div>';
  if (withSummary) {
    let body = '';
    depts.forEach(d => {
      const rs = rowsAll.filter(a => a.deptId === d.id);
      const dp = rs.filter(a => a.status === 'present').length, da = rs.filter(a => a.status === 'absent').length, de = rs.filter(a => a.status === 'excused').length;
      const dt = dp + da + de;
      body += '<tr><td>' + esc(d.name) + '</td><td class="num">' + studentsOfDeptIn(d.id, r.year).length + '</td><td class="num">' + dp + '</td><td class="num">' + da + '</td><td class="num">' + de + '</td><td class="num">' + (dt ? Math.round(((dp + de) / dt) * 100) : 0) + '%</td></tr>';
    });
    h += '<table class="st"><thead><tr><th>부서</th><th>재적</th><th>출석</th><th>결석</th><th>인정</th><th>출석률</th></tr></thead><tbody>' + body +
      '<tr><td><b>전체</b></td><td class="num"><b>' + enrolled + '</b></td><td class="num"><b>' + p + '</b></td><td class="num"><b>' + ab + '</b></td><td class="num"><b>' + ex + '</b></td><td class="num"><b>' + (t ? Math.round(((p + ex) / t) * 100) : 0) + '%</b></td></tr></tbody></table>';
  }
  if (withRoster) {
    const data = periodRoster(r, depts);
    h += '<h3>👥 전체 아동 · 날짜별 출결 (○ 출석 · ✕ 결석 · ◎ 인정 · - 미기록) · ' + data.total + '명 · 주일 ' + data.sundays.length + '회</h3>';
    if (!data.total) h += '<p style="font-size:10px;color:#777">등록된 아동이 없습니다.</p>';
    else if (!data.sundays.length) h += '<p style="font-size:10px;color:#777">이 기간에 주일이 없습니다.</p>';
    else {
      data.groups.forEach((g, i) => {
        h += '<div class="' + (i ? 'brk' : '') + '"><div style="font-size:10.5px;font-weight:800;margin:4px 0 2px">' + esc((g.dept.emoji || '') + ' ' + g.dept.name) + ' <span style="font-weight:600;color:#777">' + g.studs.length + '명</span></div>';
        h += printRosterTableHtml(g, data.sundays, data.mark) + '</div>';
      });
    }
  }
  if (!withSummary && !withRoster) h += '<p style="font-size:11px;text-align:center;color:#777">인쇄할 항목을 골라 주세요.</p>';
  h += '<p class="foot">' + esc(church) + ' 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  return h;
}
function printPeriodStats(kind, opts) {
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  const html = periodPrintHtml(kind, opts);
  w.document.open(); w.document.write(html); w.document.close();
}
/* 인쇄 옵션 — 요약만 / 전체 아동 날짜별 출결까지 */
function periodPrintModal(kind) {
  const k = kind || V.statPeriod || 'month';
  const labels = { week: '주간', month: '월간', quarter: '분기', half: '반기', year: '연간' };
  const r = statPeriodRange(k);
  const data = periodRoster(r, visibleDepts());
  let h = '<div class="banner sky"><b>' + esc(r.label) + '</b> 기준으로 인쇄합니다.</div>';
  h += '<div class="field"><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="prSummary" checked style="width:18px;height:18px"> 요약 통계 (부서별 비교 · 출석률)</label></div>';
  h += '<div class="field"><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="prRoster" checked style="width:18px;height:18px"> 전체 아동 명단 + 날짜별 출결 (' + data.total + '명 · 주일 ' + data.sundays.length + '회)</label><div class="hint">○ 출석 · ✕ 결석 · ◎ 인정 · - 미기록. 명단을 넣으면 A4 가로로 인쇄됩니다.</div></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="period-print-go" data-v="' + esc(k) + '">🖨️ 인쇄</button></div>';
  openModal(labels[k] + ' 통계 인쇄', h);
}
function statsView() {
  if (!can('attendance.stat')) return '<div class="card">' + emptyBox('🔒', '출석통계를 볼 권한이 없습니다') + '</div>';
  const ym = statState();
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  const allMode = V.statDept === '' && canSeeAllDepts();
  if (!allMode && (!V.statDept || !depts.some(d => d.id === V.statDept))) V.statDept = depts[0].id;
  const view = V.statView || 'month';
  const dept = allMode ? null : deptById(V.statDept);
  if (!allMode && !dept) return '<div class="card">' + emptyBox('🏫', '부서를 찾지 못했습니다', '부서를 다시 골라 주세요') + '</div>';
  const classes = dept ? classesOfDept(dept.id) : [];
  if (V.statCls && !classes.some(c => c.id === V.statCls)) V.statCls = '';

  const right = view === 'annual'
    ? '<button class="btn sm" data-act="annual-print">🖨 인쇄</button><button class="btn sm" data-act="annual-csv">⬇ CSV</button>'
    : '<button class="btn sm" data-act="stat-print">🖨 인쇄</button>';
  let h = subHead('출석통계', '출석률·추이·연간 출결표를 한눈에 봅니다', right);
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:8px"><button class="chip big ' + (view === 'month' ? 'coral' : 'gray') + '" data-act="stat-view" data-v="month">월별 통계</button><button class="chip big ' + (view === 'annual' ? 'coral' : 'gray') + '" data-act="stat-view" data-v="annual">📅 연간 출석부</button></div>';
  if (view === 'annual') h += yearBar(); else h += monthBar('statMonth', ym, 'stat-month');
  h += '<div class="row wrap" style="gap:6px">';
  if (canSeeAllDepts()) h += '<button class="chip big ' + (allMode ? 'coral' : 'gray') + '" data-act="stat-dept" data-id="">🏫 전체 부서</button>';
  h += depts.map(d => '<button class="chip big ' + (dept && d.id === dept.id ? 'coral' : 'gray') + '" data-act="stat-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('');
  h += '</div>';
  if (classes.length && view === 'month') {
    h += '<div class="row wrap" style="gap:6px;margin-top:8px"><button class="chip big ' + (!V.statCls ? 'coral' : 'gray') + '" data-act="stat-cls" data-id="">부서 전체</button>' +
      classes.map(c => '<button class="chip big ' + (c.id === V.statCls ? 'coral' : 'gray') + '" data-act="stat-cls" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>').join('') + '</div>';
  }
  h += '</div>';

  /* 연간 출석부 */
  if (view === 'annual') {
    h += annualSheetHtml({ year: statYear(), deptIds: allMode ? depts.map(d => d.id) : [V.statDept], showDept: allMode });
    return h;
  }

  /* 전체 부서 통합 통계 */
  if (allMode) {
    h += integratedStatsHtml(ym, depts);
    return h;
  }

  const studs = V.statCls ? studentsOfClass(V.statCls) : studentsOfDept(dept.id);
  const rows = (S.state.attendance || []).filter(a => !a._del && !a.staff && monthKeyOf(a.date) === ym && a.deptId === dept.id && (!V.statCls || a.classId === V.statCls));
  const dates = Array.from(new Set(rows.map(a => a.date))).sort();
  const perStudent = studs.map(s => {
    const rs = rows.filter(a => a.studentId === s.id);
    const p = rs.filter(a => a.status === 'present').length;
    const ab = rs.filter(a => a.status === 'absent').length;
    const ex = rs.filter(a => a.status === 'excused').length;
    const tot = rs.length;
    return { s: s, p: p, ab: ab, ex: ex, tot: tot, rate: tot ? Math.round(((p + ex) / tot) * 100) : 0, reasons: rs.filter(a => a.status === 'absent' && a.reason) };
  });
  const totalP = perStudent.reduce((n, x) => n + x.p, 0), totalA = perStudent.reduce((n, x) => n + x.ab, 0), totalE = perStudent.reduce((n, x) => n + x.ex, 0), totalT = totalP + totalA + totalE;
  const rate = totalT ? Math.round(((totalP + totalE) / totalT) * 100) : 0;

  h += '<div class="stat-grid" style="margin-bottom:12px"><div class="stat present"><b>' + rate + '%</b><span>출석률</span></div><div class="stat enroll"><b>' + studs.length + '</b><span>재적</span></div><div class="stat absent"><b>' + totalA + '</b><span>결석</span></div><div class="stat new"><b>' + totalE + '</b><span>인정결석</span></div></div>';

  // 주차별 추이
  h += '<div class="card"><h3>📈 주일별 출석 추이<span class="sp"></span><small>출석+인정 / 기록</small></h3>';
  if (!dates.length) h += '<p class="muted" style="margin:0">이 달 출석 기록이 없습니다.</p>';
  else {
    dates.forEach(d => {
      const rs = rows.filter(a => a.date === d);
      const p = rs.filter(a => a.status === 'present').length, ex = rs.filter(a => a.status === 'excused').length, ab = rs.filter(a => a.status === 'absent').length;
      const tot = rs.length || 1;
      const pct = Math.round(((p + ex) / tot) * 100);
      h += '<div class="bar-row"><span class="bar-lb">' + esc(fmtShort(d)) + ' 주일</span><span class="bar-track"><i style="width:' + pct + '%" class="' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low') + '"></i></span><span class="bar-val">' + pct + '% <small>(' + (p + ex) + '/' + rs.length + ')</small></span></div>';
    });
  }
  h += '</div>';

  // 학생별
  h += '<div class="card"><h3>👥 학생별 현황</h3>';
  if (!perStudent.length) h += '<p class="muted" style="margin:0">학생이 없습니다.</p>';
  else {
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>반</th><th>생일</th><th class="num">출석</th><th class="num">결석</th><th class="num">인정</th><th class="num">출석률</th></tr></thead><tbody>';
    perStudent.forEach(x => {
      h += '<tr><td>' + esc(x.s.name) + '</td><td>' + esc((classById(x.s.classId) || {}).name || '-') + '</td><td>' + esc(x.s.birth ? birthShort(x.s.birth) : '-') + '</td><td class="num">' + x.p + '</td><td class="num">' + x.ab + '</td><td class="num">' + x.ex + '</td><td class="num"><b>' + x.rate + '%</b></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  // 결석 사유
  const absRows = rows.filter(a => a.status === 'absent');
  h += '<div class="card"><h3>📝 결석 사유 모음<span class="sp"></span><small>' + absRows.length + '건</small></h3>';
  if (!absRows.length) h += '<p class="muted" style="margin:0">이 달 결석이 없습니다.</p>';
  else {
    const cnt = {};
    absRows.forEach(a => { const k = a.reason || '사유 없음'; cnt[k] = (cnt[k] || 0) + 1; });
    h += '<div class="row wrap" style="gap:6px;margin-bottom:8px">' + Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(k => '<span class="chip ' + (k === '사유 없음' ? 'gray' : 'rose') + '">' + esc(k) + ' ' + cnt[k] + '</span>').join('') + '</div>';
    h += '<div class="list">';
    absRows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40).forEach(a => {
      const st = (S.state.students || []).find(x => x.id === a.studentId) || {};
      h += '<div class="item" style="padding:9px 11px"><span class="attend-badge absent">결</span><span class="tx"><b>' + esc(st.name || '(학생)') + ' · ' + esc(a.reason || '사유 없음') + '</b><span>' + esc(fmtDate(a.date)) + ' · ' + esc((classById(a.classId) || {}).name || '') + '</span></span></div>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

function printStats() {
  const ym = statState();
  const dept = deptById(V.statDept) || {};
  const studs = V.statCls ? studentsOfClass(V.statCls) : studentsOfDept(V.statDept);
  const rows = (S.state.attendance || []).filter(a => !a._del && !a.staff && monthKeyOf(a.date) === ym && a.deptId === V.statDept && (!V.statCls || a.classId === V.statCls));
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  let body = '';
  studs.forEach(s => {
    const rs = rows.filter(a => a.studentId === s.id);
    const p = rs.filter(a => a.status === 'present').length, ab = rs.filter(a => a.status === 'absent').length, ex = rs.filter(a => a.status === 'excused').length;
    const rate = rs.length ? Math.round(((p + ex) / rs.length) * 100) : 0;
    const why = rs.filter(a => a.status === 'absent').map(a => fmtShort(a.date) + ' ' + (a.reason || '사유없음')).join(', ');
    body += '<tr><td>' + esc(s.name) + '</td><td>' + esc((classById(s.classId) || {}).name || '') + '</td><td class="num">' + p + '</td><td class="num">' + ab + '</td><td class="num">' + ex + '</td><td class="num">' + rate + '%</td><td>' + esc(why) + '</td></tr>';
  });
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>출석통계</title><style>body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;padding:24px;color:#222}h1{font-size:19px;text-align:center;margin:0 0 4px}h2{font-size:12px;color:#777;text-align:center;font-weight:600;margin:0 0 16px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px 7px}th{background:#f4f0ec}td.num{text-align:right}</style></head><body>' +
    '<h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 출석통계</h1><h2>' + esc(monthLabel(ym)) + ' · ' + esc(dept.name || '') + (V.statCls ? ' · ' + esc((classById(V.statCls) || {}).name || '') : '') + '</h2>' +
    '<table><thead><tr><th>이름</th><th>반</th><th>출석</th><th>결석</th><th>인정</th><th>출석률</th><th>결석 사유</th></tr></thead><tbody>' + (body || '<tr><td colspan="7" style="text-align:center">기록 없음</td></tr>') + '</tbody></table>' +
    '<p style="font-size:10px;color:#999;text-align:center;margin-top:14px">덕신교회 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p><script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}

/* ================= 7. 동작 연결 ================= */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      /* --- 회원가입 --- */
      case 'open-signup':
        if (!Api.on()) return showLoginError('동기화 서버에 연결할 수 없어 가입 신청을 할 수 없습니다.');
        V.signup = { roles: [], depts: [], classes: [] };
        V.signupForm = null;
        V.signupBirthType = 'solar';
        if (!(S.state.departments || []).length) {
          // 로그인 전에는 부서 목록이 없으므로 기본 부서 틀을 보여 줍니다
          S.state.departments = JSON.parse(JSON.stringify(DEFAULT_DEPTS));
        }
        signupModal(); return;
      case 'signup-role': { const st = V.signup || (V.signup = { roles: [], depts: [], classes: [] }); toggleIn(st.roles, t.dataset.key); t.classList.toggle('coral'); t.classList.toggle('gray'); return; }
      case 'signup-dept': {
        const st = V.signup || (V.signup = { roles: [], depts: [], classes: [] });
        toggleIn(st.depts, t.dataset.id); t.classList.toggle('coral'); t.classList.toggle('gray');
        refreshSignupClasses();
        return;
      }
      case 'do-signup': await doSignup(); return;

      /* --- 승인 --- */
      case 'reload-apps': V.apps = null; loadApps(true); return;
      case 'appr-dept': {
        if (!V.apprEdit) return;
        toggleIn(V.apprEdit.depts, t.dataset.id);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        const box = document.getElementById('apClsBox');
        if (box) box.innerHTML = approveClassChips();
        return;
      }
      case 'appr-cls': { if (!V.apprEdit) return; toggleIn(V.apprEdit.classes, t.dataset.id); t.classList.toggle('coral'); t.classList.toggle('gray'); return; }
      case 'appr-stu': { if (!V.apprEdit) return; toggleIn(V.apprEdit.students, t.dataset.id); t.classList.toggle('coral'); t.classList.toggle('gray'); return; }
      case 'approve-app': approveModal(t.dataset.uid); return;
      case 'do-approve': {
        const ed = V.apprEdit || {};
        const uid = t.dataset.uid;
        try { await approveApp(uid, { depts: ed.depts || [], classes: ed.classes || [], students: ed.students || [], birth: val('apBirth') || ed.birth || '' }); }
        catch (e) { toast((e && e.message) || '승인하지 못했습니다', 'err'); }
        return;
      }
      case 'reject-app': rejectModal(t.dataset.uid); return;
      case 'do-reject': await doReject(t.dataset.uid); return;

      /* --- 역할·부서 변경 신청 --- */
      case 'chg-open': roleChangeModal(); return;
      case 'chg-role': {
        if (!V.changeEdit) return;
        toggleIn(V.changeEdit.roles, t.dataset.key);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        refreshChangeHint();
        return;
      }
      case 'chg-dept': {
        if (!V.changeEdit) return;
        toggleIn(V.changeEdit.depts, t.dataset.id);
        t.classList.toggle('coral'); t.classList.toggle('gray');
        return;
      }
      case 'chg-send': await submitRoleChange(); return;
      case 'chg-approve': await doApproveChange(t.dataset.id); return;
      case 'chg-reject': rejectChangeModal(t.dataset.id); return;
      case 'chg-reject-go': await confirmRejectChange(t.dataset.id); return;

      /* --- 결석 사유 --- */
      case 'pick-absent': {
        const inp = document.getElementById('absReason');
        if (inp) inp.value = t.dataset.v;
        document.querySelectorAll('[data-act="pick-absent"]').forEach(b => { b.classList.toggle('coral', b === t); b.classList.toggle('gray', b !== t); });
        return;
      }
      case 'save-absent': saveAbsent(t.dataset.sid, val('absReason')); return;
      case 'clear-absent': { const s = (S.state.students || []).find(x => x.id === t.dataset.sid); if (s) { setAtt(V.date, s.deptId, s.classId, s.id, 'present'); closeModal(); renderApp(); } return; }

      /* --- 월별계획표 --- */
      case 'plan-month': V.planMonth = shiftMonth(planState(), Number(t.dataset.v)); renderApp(); return;
      case 'plan-dept': V.planDept = t.dataset.id; renderApp(); return;
      case 'new-plan': planModal(null); return;
      case 'edit-plan': { const p = (S.state.plans || []).find(x => x.id === t.dataset.id); if (p) planModal(p); return; }
      case 'save-plan': savePlan(t.dataset.id); return;
      case 'del-plan': {
        const id = t.dataset.id;
        confirmBox('계획 삭제', '이 계획을 지울까요? 부서 일정에 자동 등록된 항목도 함께 사라집니다.', '삭제', async () => {
          const p = (S.state.plans || []).find(x => x.id === id);
          if (p) { p._del = true; touch(p); dropPlanEvent(id); await Sync.save(); renderApp(); }
        });
        return;
      }
      case 'plan-hwpx': fileInput('.hwpx,.hwp', f => importHwpx(f)); return;
      case 'hwpx-toggle': { const i = Number(t.dataset.i); if (V.hwpxPreview[i]) V.hwpxPreview[i].on = !V.hwpxPreview[i].on; hwpxPreviewModal(V.hwpxPreviewName || '한글파일', planState()); return; }
      case 'hwpx-all': { const on = t.dataset.v === '1'; (V.hwpxPreview || []).forEach(it => it.on = on); hwpxPreviewModal(V.hwpxPreviewName || '한글파일', planState()); return; }
      case 'hwpx-import': { const n = (V.hwpxPreview || []).filter(x => x.on).length; confirmBox('계획표에 반영', n + '건을 ' + monthLabel(planState()) + ' 계획표에 넣을까요?', '반영', doHwpxImport); return; }

      /* --- 회계 --- */
      case 'led-month': V.ledMonth = shiftMonth(ledgerState(), Number(t.dataset.v)); renderApp(); return;
      case 'led-dept': V.ledDept = t.dataset.id; renderApp(); return;
      case 'new-ledger': ledgerModal(null, t.dataset.type); return;
      case 'edit-ledger': { const e = (S.state.ledger || []).find(x => x.id === t.dataset.id); if (e) ledgerModal(e); return; }
      case 'led-type': { V.ledDraftType = t.dataset.v; document.querySelectorAll('[data-act="led-type"]').forEach(b => { const on = b.dataset.v === t.dataset.v; b.classList.toggle('mint', on && t.dataset.v === 'in'); b.classList.toggle('rose', on && t.dataset.v === 'out'); b.classList.toggle('gray', !on); }); return; }
      case 'save-ledger': saveLedger(t.dataset.id); return;
      case 'del-ledger': {
        const id = t.dataset.id;
        confirmBox('회계 기록 삭제', '이 기록을 지울까요?', '삭제', async () => {
          const e = (S.state.ledger || []).find(x => x.id === id);
          if (e) { e._del = true; touch(e); closeModal(); await Sync.save(); renderApp(); }
        });
        return;
      }
      case 'pick-receipt': fileInput('image/*', async f => {
        try {
          toast('사진을 줄이는 중…');
          V.receiptDraft = await compressReceipt(f);
          const box = document.getElementById('rcvBox');
          if (box) box.innerHTML = receiptImg(V.receiptDraft, 150);
          const info = document.getElementById('rcvInfo');
          if (info) info.textContent = '첨부됨 (약 ' + Math.round(V.receiptDraft.b64.length / 1024) + 'KB)';
        } catch (e) { toast((e && e.message) || '사진을 올리지 못했습니다', 'err'); }
      }); return;
      case 'led-receipt': {
        const e = (S.state.ledger || []).find(x => x.id === t.dataset.id);
        if (!e || !e.receipt) return;
        openModal('영수증', '<div style="text-align:center">' + receiptImg(e.receipt, 560) + '</div><div class="kv"><span>금액</span><b>' + money(e.amount) + '원</b></div><div class="kv"><span>날짜</span><b>' + esc(fmtDate(e.date)) + '</b></div>');
        return;
      }
      case 'led-print': printLedger(); return;

      /* --- 주일보고 연계 --- */
      case 'rep-apply-income': {
        const rep = (S.state.reports || []).find(x => x.id === t.dataset.id);
        if (!rep) return;
        const total = incomeTotal(ledgerOfWeek(rep.deptId, rep.date));
        const inp = document.getElementById('rpOffering');
        if (inp) inp.value = String(total);
        readReportForm(rep); await Sync.save(); renderApp(); toast('수입 ' + money(total) + '원을 반영했습니다', 'ok');
        return;
      }
      case 'rep-apply-lesson': {
        const rep = (S.state.reports || []).find(x => x.id === t.dataset.id);
        if (!rep) return;
        const lesson = (plansOfWeek(rep.deptId, rep.date).find(p => p.kind === '공과') || {}).title || '';
        if (!lesson) return toast('이 주에 공과 계획이 없습니다', 'err');
        rep.lesson = lesson; touch(rep);
        await Sync.save(); renderApp(); toast('공과를 반영했습니다', 'ok');
        return;
      }

      /* --- 출석통계 --- */
      case 'stat-month': V.statMonth = shiftMonth(statState(), Number(t.dataset.v)); renderApp(); return;
      case 'stat-period-move': V.statMonth = shiftMonth(statState(), Number(t.dataset.v)); renderApp(); return;
      case 'period-print-go': {
        const sm = document.getElementById('prSummary');
        const rs = document.getElementById('prRoster');
        const opts = { summary: !sm || sm.checked, roster: !rs || rs.checked };
        closeModal();
        printPeriodStats(t.dataset.v || V.statPeriod || 'month', opts);
        return;
      }
      case 'stat-dept': V.statDept = t.dataset.id; V.statCls = ''; renderApp(); return;
      case 'stat-cls': V.statCls = t.dataset.id; renderApp(); return;
      case 'stat-print': printStatsSafe(); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});

/* 날짜 입력 변화 — 계획 주차 표시 */
document.addEventListener('change', function (ev) {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.change) return;
  if (t.dataset.change === 'plan-date') {
    const w = document.getElementById('plWeek');
    if (w) w.textContent = (weekOfMonth(t.value) || '-') + '주차';
  }
  if (t.dataset.change === 's-birth') {
    const hint = document.getElementById('sPromoHint');
    if (hint) {
      const p = promoOf({ birth: t.value }, curYear());
      hint.innerHTML = p.age
        ? '<b>' + curYear() + '년 기준 ' + p.age + '세 · ' + esc(p.label) + '</b> · 진급 부서: <b>' + esc(p.deptName) + '</b>'
        : '생년월일을 넣으면 나이·학년과 진급 부서를 바로 보여 줍니다.';
    }
  }
});

/* ---------------------------- 끝 ---------------------------- */
