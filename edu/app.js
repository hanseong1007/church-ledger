/* 덕신교회 부서업무 — 로그인 · 이벤트 · 실행 */
'use strict';

let pendingConfirm = null;

function toast(msg, kind) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.textContent = msg;
  wrap.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .25s'; }, kind === 'err' ? 3200 : 1800);
  setTimeout(() => d.remove(), kind === 'err' ? 3600 : 2200);
}

function confirmBox(title, text, okLabel, cb) {
  pendingConfirm = cb;
  openModal(title, '<p class="pre" style="margin:0 0 14px">' + esc(text) + '</p><div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="confirm-ok">' + esc(okLabel || '확인') + '</button></div>');
}

/* ---------------- 로그인 화면 ---------------- */
function showLogin(msg) {
  document.body.innerHTML = '<div id="root"></div><div id="modalRoot" style="display:none"></div><div id="toastWrap"></div>';
  const roles = [];
  let h = '';
  h += '<div class="login-wrap"><div class="login-card">';
  h += '<div class="login-brand"><div class="login-logo">🏫</div><h1>덕신교회 부서업무</h1><p>주일학교 · 교육부서 통합 관리</p></div>';
  h += '<div class="login-field"><label>아이디</label><input id="loginId" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="아이디"></div>';
  h += '<div class="login-field"><label>비밀번호</label><input id="loginPw" type="password" autocomplete="current-password" placeholder="비밀번호"></div>';
  h += '<div class="login-err" id="loginErr"></div>';
  h += '<button class="login-btn" id="loginBtn" data-act="do-login">로그인</button>';
  h += '<button class="login-signup" data-act="open-signup">회원가입 신청</button>';
  h += '<div class="login-note">' + (Api.on() ? '모든 자료는 암호화되어 기기 간에 동기화됩니다.<br>가입은 윗단계 담당자의 승인 후에 완료됩니다.' : '동기화 서버에 연결되지 않았습니다. 관리자에게 문의하세요.') + '</div>';
  h += '</div><div class="login-foot">덕신교회 교육부서 · 문의는 부서 담당자에게</div></div>';
  document.getElementById('root').innerHTML = h;
  const pw = document.getElementById('loginPw');
  const id = document.getElementById('loginId');
  if (id) id.focus();
  if (pw) pw.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  if (id) id.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPw').focus(); } });
  if (msg) showLoginError(msg);
}

function showLoginError(m) {
  const e = document.getElementById('loginErr');
  if (e) { e.innerHTML = esc(m).replace(/\n/g, '<br>'); e.classList.add('show'); }
}

async function doLogin() {
  const id = val('loginId'), pw = (document.getElementById('loginPw') || {}).value || '';
  const btn = document.getElementById('loginBtn');
  if (!id) return showLoginError('아이디를 입력해 주세요.');
  if (!pw) return showLoginError('비밀번호를 입력해 주세요.');
  if (!Api.on()) return showLoginError('동기화 서버에 연결할 수 없습니다. 관리자에게 문의해 주세요.');
  if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
  try {
    const uid = await uidOf(id);
    const row = await fetchAccount(uid);
    if (!row) { showLoginError('아이디 또는 비밀번호가 맞지 않습니다.'); return; }
    const info = appRowInfo(row);
    if (info.kind === 'pending') {
      const lbl = info.app && (info.app.roles || []).length ? roleDef(info.app.roles[0]).label : '담당';
      showLoginError('아직 승인 전입니다.\n' + lbl + '의 윗단계 담당자가 [가입 승인]에서 승인하면 로그인할 수 있습니다.');
      return;
    }
    if (info.kind === 'rejected') {
      showLoginError('가입 신청이 반려되었습니다.' + (info.note ? '\n사유: ' + info.note : '') + '\n다시 신청하시려면 [회원가입 신청]을 눌러 주세요.');
      return;
    }

    let dek = null, raw = null, rec = null;
    if (info.kind === 'approved') {
      try {
        const boot = await activateApproved(row, pw, info);
        dek = boot.dek; raw = boot.raw; rec = boot.rec;
      } catch (e) {
        showLoginError('승인은 되었지만 열쇠를 풀지 못했습니다. 비밀번호를 확인해 주세요.');
        return;
      }
    } else {
      try {
        const kek = await Crypto.kek(pw, row.salt);
        raw = await Crypto.open(kek, JSON.parse(row.wrap));
      } catch (e) { showLoginError('아이디 또는 비밀번호가 맞지 않습니다.'); return; }
      dek = await Crypto.importDek(raw);
      try { rec = await Crypto.openJson(dek, JSON.parse(row.rec)); } catch (e) { showLoginError('계정 정보를 읽을 수 없습니다. 관리자에게 문의하세요.'); return; }
    }
    if (rec.active === false) { showLoginError('사용이 중지된 계정입니다. 관리자에게 문의하세요.'); return; }
    const st = accountStatusOf(rec);
    if (st !== 'normal') {
      showLoginError((st === 'paused' ? '일시중지된 계정입니다.' : '차단된 계정입니다.') + '\n사유: ' + (rec.statusNote || '담당자에게 문의해 주세요') + '\n' + (st === 'paused' ? '사정이 해결되면 담당자가 정상으로 되돌릴 수 있습니다.' : '담당자에게 문의해 주세요.'));
      return;
    }

    S.dek = dek; S.wkRaw = raw;
    S.me = { uid: uid, id: rec.id, name: rec.name, roles: rec.roles || [], depts: Array.from(new Set((rec.depts || []).map(canonDeptId))), classes: rec.classes || [], students: rec.students || [], birth: rec.birth || '', grants: rec.grants || {}, birthType: birthTypeOf(rec), birthLunar: rec.birthLunar || '', status: accountStatusOf(rec), statusNote: rec.statusNote || '' };
    S.chosen = [];
    S.roleKey = highestRoleKey(S.me.roles);
    S.screen = 'home';
    S.rev = 0;
    S.state = emptyState(false);
    await afterLogin();
  } catch (e) {
    showLoginError('로그인하지 못했습니다: ' + ((e && e.message) || e));
  } finally {
    const b = document.getElementById('loginBtn');
    if (b) { b.disabled = false; b.textContent = '로그인'; }
  }
}

/* 역할이 여러 개면 가장 높은 단계로 시작합니다 (내 정보에서 바꿀 수 있습니다) */
function highestRoleKey(keys) {
  const list = (keys || []).slice().sort((a, b) => rankOfRoleKey(b) - rankOfRoleKey(a));
  return list[0] || 'parent';
}

async function afterLogin() {
  S.ready = false;
  await Sync.pull(true);
  S.ready = true;
  /* 예전 부서(유아부·중등부) 자료를 세 부서로 이어 붙입니다 */
  const deptFix = normalizeDeptRefs(true);
  const before = JSON.stringify(S.state.people || {});
  rememberMe();
  const isAdmin = roleDef(S.roleKey).base === 'admin';
  if (S.rev === 0 || deptFix || before !== JSON.stringify(S.state.people || {})) {
    // 첫 자료(관리자)이거나 내 이름 정보가 시트에 없을 때 한 번 올린다
    await Sync.save();
  }
  if (!(S.state.departments || []).length && isAdmin) {
    S.state.departments = JSON.parse(JSON.stringify(DEFAULT_DEPTS));
    await Sync.save();
  }
  V.date = lastSunday();
  V.reportDate = lastSunday();
  if (!S.year) S.year = new Date().getFullYear();
  V.planMonth = '';
  V.ledMonth = '';
  V.statMonth = '';
  V.statYear = 0;
  V.myBirthType = '';
  V.stuBirthType = '';
  V.stuNewcomer = false;
  V.gradeOpen = false;
  V.rollOpen = false;
  V.promoteOpen = false;
  V.rollYear = 0;
  V.promoSel = {};
  V.gradeAccts = undefined;
  V.gradeTeachers = {};
  const ds = visibleDepts();
  V.dept = ds.length ? ds[0].id : '';
  V.cls = '';
  if (roleDef(S.roleKey).base === 'pastor') S.screen = 'report';
  saveSession();
  renderHomeShell();
  if (can('user.approve')) loadApps(true);
  Sync.timer = setInterval(() => {
    if (document.hidden) return;
    if (S.screen === 'attendance' && document.activeElement && document.activeElement.tagName === 'INPUT') return;
    Sync.pull(true).then(ch => { if (ch) renderApp(); });
    S.tick = (S.tick || 0) + 1;
    if (S.tick % 4 === 0) refreshMyAccount();
  }, 9000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.dek) Sync.pull(true).then(ch => { if (ch) renderApp(); }); });
}

function renderHomeShell() {
  document.body.innerHTML = '<div id="root"></div><div id="modalRoot" style="display:none"></div><div id="toastWrap"></div>';
  renderApp();
}

/* ---------------- 첫 설정 ---------------- */
function showSetup() {
  let h = '<div class="login-wrap"><div class="login-card">';
  h += '<div class="login-brand"><div class="login-logo">🏫</div><h1>처음 설정</h1><p>덕신교회 부서업무 · 관리자 계정 만들기</p></div>';
  h += '<div class="banner sky">아직 등록된 계정이 없습니다. 첫 관리자 계정을 만들면 이후에는 이 화면이 나오지 않습니다.</div>';
  h += '<div class="login-field"><label>관리자 이름</label><input id="setupName" placeholder="예: 박한성"></div>';
  h += '<div class="login-field"><label>아이디</label><input id="setupId" autocapitalize="none" spellcheck="false" placeholder="영문·숫자"></div>';
  h += '<div class="login-field"><label>비밀번호 (8자 이상)</label><input id="setupPw" type="password"></div>';
  h += '<div class="login-field"><label>비밀번호 확인</label><input id="setupPw2" type="password"></div>';
  h += '<div class="login-err" id="loginErr"></div>';
  h += '<button class="login-btn" data-act="do-setup">관리자 계정 만들기</button>';
  h += '</div></div>';
  document.body.innerHTML = '<div id="root"></div><div id="modalRoot" style="display:none"></div><div id="toastWrap"></div>';
  document.getElementById('root').innerHTML = h;
}

async function doSetup() {
  const name = val('setupName'), id = val('setupId');
  const pw = (document.getElementById('setupPw') || {}).value || '';
  const pw2 = (document.getElementById('setupPw2') || {}).value || '';
  if (!name) return showLoginError('이름을 입력해 주세요.');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(id)) return showLoginError('아이디는 영문·숫자 3~24자로 정해 주세요.');
  if (pw.length < 8) return showLoginError('비밀번호는 8자 이상으로 정해 주세요.');
  if (pw !== pw2) return showLoginError('비밀번호가 서로 다릅니다.');
  try {
    const dek = await Crypto.newDek();
    const raw = await Crypto.rawDek(dek);
    const row = await buildAccount(dek, { id: id, password: pw, name: name, roles: ['admin'], depts: [], classes: [], students: [], active: true });
    await saveAccountRow(row);
    S.deck = dek;
    S.dek = dek; S.wkRaw = raw;
    S.me = { uid: row.uid, id: normId(id), name: name, roles: ['admin'], depts: [], classes: [], students: [] };
    S.chosen = ['admin'];
    S.roleKey = 'admin';
    S.rev = 0;
    S.state = emptyState();
    S.state.rev = 0;
    touch(S.state.settings);
    await Sync.save();
    await afterLogin();
  } catch (e) {
    showLoginError('계정을 만들지 못했습니다: ' + ((e && e.message) || e));
  }
}

/* ---------------- 동작 ---------------- */
function setScreen(key) {
  S.screen = key;
  if (key === 'admin' && can('user.manage')) { V.accounts = null; loadAccounts(); }
  if (key === 'staff' && can('staff.manage')) { V.staffAccts = null; loadStaffAccounts(true); }
  if (key === 'approve' && can('user.approve')) { V.apps = null; loadApps(true); }
  renderApp();
}

function shiftDate(cur, days) {
  const d = parseYmd(cur);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

async function doLogout() {
  if (Sync.timer) clearInterval(Sync.timer);
  clearSession();
  S.dek = null; S.me = null; S.state = emptyState(); S.rev = 0;
  showLogin();
}

function readReportForm(rep) {
  const c = deptCounts(rep.deptId, rep.date);
  rep.counts = {
    enrolled: c.enrolled, present: c.present, absent: c.absent, excused: c.excused,
    newcomer: newcomerRowsOf(rep.deptId, rep.date).length, teacherPresent: c.staffPresent, teacherTotal: c.staffTotal
  };
  rep.scripture = val('rpScripture');
  rep.lesson = val('rpLesson');
  rep.offering = val('rpOffering');
  rep.notes = val('rpNotes');
  rep.prayer = val('rpPrayer');
  touch(rep);
  return rep;
}

function createReport(deptId, date) {
  let rep = reportOf(deptId, date);
  if (rep) return rep;
  const c = deptCounts(deptId, date);
  rep = {
    id: 'rp-' + Crypto.uid(), date: date, year: yearOfDate(date) || curYear(), deptId: deptId, service: '주일예배',
    scripture: '', lesson: '', offering: '', notes: '', prayer: '',
    status: 'draft', author: S.me.uid, authorName: S.me.name,
    counts: { enrolled: c.enrolled, present: c.present, absent: c.absent, excused: c.excused, newcomer: newcomerRowsOf(deptId, date).length, teacherPresent: c.staffPresent, teacherTotal: c.staffTotal },
    at: Date.now(), u: Date.now()
  };
  S.state.reports.push(rep);
  return rep;
}

function reportDetailModal(r) {
  const dept = deptById(r.deptId) || {};
  const cn = r.counts || {};
  let h = '<div class="row" style="gap:6px;margin-bottom:10px">' + deptChip(dept) + statusChip(r.status) + '</div>';
  h += '<h2 style="font-size:17px;margin:0 0 2px">' + esc(fmtDate(r.date)) + ' 주일보고</h2>';
  h += '<div class="muted">' + esc(r.authorName || '') + ' 작성' + (r.submittedAt ? ' · 제출 ' + timeAgo(r.submittedAt) : '') + '</div>';
  h += '<div class="stat-grid" style="margin:12px 0"><div class="stat enroll"><b>' + (cn.enrolled || 0) + '</b><span>재적</span></div><div class="stat present"><b>' + (cn.present || 0) + '</b><span>출석</span></div><div class="stat absent"><b>' + (cn.absent || 0) + '</b><span>결석</span></div><div class="stat new"><b>' + (cn.newcomer || 0) + '</b><span>신입</span></div></div>';
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="kv"><span>교사 출석</span><b>' + (cn.teacherPresent || 0) + ' / ' + (cn.teacherTotal || 0) + '</b></div>';
  h += '<div class="kv"><span>헌금</span><b>' + esc(r.offering ? Number(String(r.offering).replace(/[^0-9]/g, '') || 0).toLocaleString('ko-KR') + '원' : '-') + '</b></div>';
  h += '<div class="kv"><span>예배 말씀</span><b>' + esc(r.scripture || '-') + '</b></div>';
  h += '<div class="kv"><span>공과</span><b>' + esc(r.lesson || '-') + '</b></div>';
  if (cn.excused) h += '<div class="kv"><span>인정 결석</span><b>' + cn.excused + '</b></div>';
  h += '</div>';
  if (r.notes) h += '<div class="sect-title">특이사항</div><div class="pre">' + esc(r.notes) + '</div>';
  if (r.prayer) h += '<div class="sect-title">기도제목</div><div class="pre">' + esc(r.prayer) + '</div>';

  /* 결석자·신입 자동 기입 */
  const absR = absentRowsOf(r.deptId, r.date);
  const newR = newcomerRowsOf(r.deptId, r.date);
  if (absR.length || newR.length) {
    h += '<div class="card flat" style="padding:12px;margin-top:10px"><h3>📝 결석자·신입</h3>';
    if (absR.length) {
      h += '<div class="sect-title" style="margin:0 0 6px">결석 ' + absR.length + '명</div>';
      absR.forEach(x => { h += '<div class="kv" style="padding:4px 0"><span>' + esc(x.cls) + ' · ' + esc(x.name) + '</span><b>' + esc(x.reason || '사유 없음') + '</b></div>'; });
    }
    if (newR.length) {
      h += '<div class="sect-title" style="margin:8px 0 6px">신입 ' + newR.length + '명</div>';
      newR.forEach(x => { h += '<div class="kv" style="padding:4px 0"><span>★ ' + esc(x.name) + '</span><b>' + esc(x.cls) + '</b></div>'; });
    }
    h += '</div>';
  }
  if (reopenPending(r)) {
    h += '<div class="banner sky" style="margin-top:10px">📩 부서에서 반려를 요청했습니다 · ' + timeAgo(r.reopen.at) + (r.reopen.reason ? '<br>사유: ' + esc(r.reopen.reason) : '') + '<br>아래 반려 사유에 그대로 들어 있습니다. 반려하면 부서가 다시 작성합니다.</div>';
  }

  /* 이 주의 월별계획·수입 내역 */
  const wp = plansOfWeek(r.deptId, r.date);
  const wi = ledgerOfWeek(r.deptId, r.date).filter(e => e.type === 'in');
  if (wp.length || wi.length) {
    h += '<div class="card flat" style="padding:12px;margin-top:12px"><h3>🗓️ 이 주 계획·수입</h3>';
    if (wp.length) {
      h += '<div class="list">' + wp.map(p => '<div class="item" style="padding:8px 10px;box-shadow:none"><span class="av" style="background:#efe9fd">' + esc(fmtShort(p.date)) + '</span><span class="tx"><b>' + esc(p.title) + '</b><span>' + esc(p.kind || '계획') + (p.detail ? ' · ' + esc(p.detail) : '') + '</span></span></div>').join('') + '</div>';
    }
    if (wi.length) {
      h += '<div class="list" style="margin-top:6px">' + wi.map(e => '<div class="item" style="padding:8px 10px;box-shadow:none"><span class="av" style="background:#e7f7ee">＋</span><span class="tx"><b>' + esc(e.category || '수입') + '</b><span>' + esc(fmtShort(e.date)) + (e.memo ? ' · ' + esc(e.memo) : '') + '</span></span><span class="rt"><b>' + money(e.amount) + '원</b></span></div>').join('') + '</div>';
      h += '<div class="kv"><span>이 주 수입 합계</span><b>' + money(incomeTotal(wi)) + '원</b></div>';
    }
    h += '</div>';
  }

  if (r.status === 'rejected') h += '<div class="banner coral" style="margin-top:12px">↩ 반려된 보고서입니다' + (r.rejectedByName ? ' · ' + esc(r.rejectedByName) : '') + (r.rejectReason ? '<br>사유: ' + esc(r.rejectReason) : '') + '</div>';
  if (r.status === 'checked') {
    h += '<div class="banner mint" style="margin-top:12px">✅ ' + esc(r.checkedByName || '목회자') + ' 확인 완료' + (r.checkedAt ? ' · ' + timeAgo(r.checkedAt) : '') + '</div>';
    if (r.comment) h += '<div class="notice-body pre">' + esc(r.comment) + '</div>';
  }
  if (can('report.review')) {
    h += '<div class="field" style="margin-top:12px"><label>목회자 코멘트</label><textarea id="rvComment" placeholder="부서에 전할 한마디">' + esc(r.comment || '') + '</textarea></div>';
    h += '<div class="field"><label>반려 사유 (반려할 때)</label><textarea id="rjReason" placeholder="예: 헌금란 금액을 다시 확인해 주세요">' + esc(reopenPending(r) ? r.reopen.reason : '') + '</textarea></div>';
    h += '<div class="row wrap" style="gap:8px"><button class="btn" data-act="modal-close">닫기</button><button class="btn" data-act="print-report" data-id="' + esc(r.id) + '">🖨️ 인쇄</button><span class="sp"></span>';
    h += '<button class="btn" style="color:#c33e5f" data-act="reject-report" data-id="' + esc(r.id) + '">↩ 반려(재작성 요청)</button>';
    if (r.status !== 'checked') h += '<button class="btn mint" data-act="check-report" data-id="' + esc(r.id) + '">확인 완료</button>';
    h += '</div>';
  } else {
    h += '<div class="row wrap" style="gap:8px;margin-top:12px"><button class="btn" data-act="modal-close">닫기</button><button class="btn" data-act="print-report" data-id="' + esc(r.id) + '">🖨️ 인쇄</button></div>';
  }
  openModal('주일보고', h);
}

/* ---------------- 클릭 처리 ---------------- */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case 'pick-role': return;
      case 'do-login': await doLogin(); return;
      case 'do-setup': await doSetup(); return;
      case 'nav': setScreen(t.dataset.screen); return;
      case 'role-menu': roleMenuModal(); return;
      case 'use-role':
        S.roleKey = t.dataset.key; S.screen = 'home'; saveSession(); closeModal(); renderApp(); return;
      case 'modal-close': closeModal(); return;
      case 'modal-bg': if (ev.target === t) closeModal(); return;
      case 'confirm-ok': { const cb = pendingConfirm; pendingConfirm = null; closeModal(); if (cb) await cb(); return; }

      case 'go-att':
        if (t.dataset.cls) { const c = classById(t.dataset.cls); if (c) { V.dept = c.deptId; V.cls = c.id; } }
        if (t.dataset.dept) { V.dept = t.dataset.dept; V.cls = ''; }
        setScreen('attendance'); return;
      case 'go-report': setScreen('report'); return;
      case 'pick-dept': V.dept = t.dataset.id; V.cls = ''; renderApp(); return;
      case 'pick-cls': V.cls = t.dataset.id; renderApp(); return;
      case 'date-move': V.date = shiftDate(V.date, Number(t.dataset.v)); renderApp(); return;
      case 'report-date-move': V.reportDate = shiftDate(V.reportDate || V.date, Number(t.dataset.v)); renderApp(); return;
      case 'pick-report-dept': V.dept = t.dataset.id; renderApp(); return;
      case 'report-mode': V.reportMode = t.dataset.v; renderApp(); return;
      case 'inbox-filter': V.inboxFilter = t.dataset.v; renderApp(); return;

      case 'att': {
        const s = (S.state.students || []).find(x => x.id === t.dataset.sid);
        if (!s) return;
        if (t.dataset.v === 'absent') { absentReasonModal(s, V.date); return; }
        setAtt(V.date, s.deptId, s.classId, s.id, t.dataset.v);
        renderApp();
        if (V.autoMsg && t.dataset.v === 'present' && s.guardianPhone) messageModal({ student: s, text: attMsgText(s, 'present') });
        return;
      }
      case 'att-reason': {
        const s = (S.state.students || []).find(x => x.id === t.dataset.sid);
        if (s) absentReasonModal(s, V.date);
        return;
      }
      case 'att-staff':
        setStaffAtt(V.date, V.dept, t.dataset.uid, t.dataset.v);
        renderApp(); return;
      case 'mark-all': {
        const studs = V.cls ? studentsOfClass(V.cls) : studentsOfDept(V.dept);
        const v = t.dataset.v;
        studs.forEach(s => {
          if (v === 'none') {
            const rec = attOf(V.date, s.id);
            if (rec) { rec._del = true; rec.status = ''; touch(rec); }
          } else setAttSilent(V.date, s.deptId, s.classId, s.id, v);
        });
        await Sync.save(); renderApp(); return;
      }

      case 'open-report-new':
        V.dept = t.dataset.dept; V.reportDate = t.dataset.date;
        if (!reportOf(V.dept, V.reportDate)) createReport(V.dept, V.reportDate);
        V.reportMode = 'write';
        S.screen = 'report'; renderApp(); return;
      case 'create-report': {
        createReport(V.dept, V.reportDate || V.date);
        await Sync.save(); renderApp(); toast('보고서를 만들었습니다', 'ok'); return;
      }
      case 'save-report': {
        const rep = S.state.reports.find(x => x.id === t.dataset.id);
        if (rep) { readReportForm(rep); await Sync.save(); renderApp(); toast('저장했습니다', 'ok'); }
        return;
      }
      case 'submit-report': {
        const rep = S.state.reports.find(x => x.id === t.dataset.id);
        if (rep) {
          if (rep.status === 'submitted' || rep.status === 'checked') return toast('이미 제출한 보고서입니다. 고칠 일이 있으면 반려를 요청해 주세요', 'err');
          readReportForm(rep);
          rep.status = 'submitted'; rep.submittedAt = Date.now(); touch(rep);
          await Sync.save(); renderApp(); toast('목회자에게 제출했습니다', 'ok');
        }
        return;
      }
      case 'open-report': {
        const rep = S.state.reports.find(x => x.id === t.dataset.id);
        if (rep) reportDetailModal(rep);
        return;
      }
      case 'check-report': {
        const rep = S.state.reports.find(x => x.id === t.dataset.id);
        if (rep) {
          rep.status = 'checked'; rep.checkedAt = Date.now(); rep.checkedBy = S.me.uid; rep.checkedByName = S.me.name;
          rep.comment = val('rvComment');
          if (rep.reopen) { rep.reopen.done = true; rep.reopen.doneAt = Date.now(); }
          touch(rep);
          await Sync.save(); closeModal(); renderApp(); toast('확인 완료로 표시했습니다', 'ok');
        }
        return;
      }
      case 'print-report': {
        const rep = S.state.reports.find(x => x.id === t.dataset.id);
        if (rep) printReport(rep);
        return;
      }

      case 'new-notice': { if (!can('notice.write')) return; noticeWriteModal(); return; }
      case 'toggle-pin': t.classList.toggle('coral'); t.classList.toggle('gray'); return;
      case 'save-notice': {
        const title = val('nTitle');
        if (!title) return toast('제목을 입력하세요', 'err');
        const body = val('nBody');
        if (!body) return toast('내용을 입력하세요', 'err');
        const pinned = !!document.querySelector('[data-act="toggle-pin"].coral');
        const n = {
          id: 'nt-' + Crypto.uid(), deptId: val('nDept'), classId: val('nClass'), title: title, body: body,
          author: S.me.uid, authorName: S.me.name, at: Date.now(), date: ymd(), reads: {}, pinned: pinned, u: Date.now()
        };
        S.state.notices.push(n);
        closeModal(); await Sync.save(); renderApp(); toast('알림장을 보냈습니다', 'ok'); return;
      }
      case 'open-notice': {
        const n = S.state.notices.find(x => x.id === t.dataset.id);
        if (n) noticeModal(n);
        return;
      }
      case 'ack-notice': {
        const n = S.state.notices.find(x => x.id === t.dataset.id);
        if (n) {
          if (n.author === S.me.uid) return toast('내가 쓴 알림장은 확인 대상이 아닙니다', 'err');
          n.reads = n.reads || {};
          n.reads[S.me.uid] = Date.now();
          n.readU = Date.now();
          touch(n);
          await Sync.save(); closeModal(); renderApp(); toast('확인했어요. 미확인 알림이 줄었습니다', 'ok');
        }
        return;
      }
      case 'del-notice': {
        const id = t.dataset.id;
        confirmBox('알림장 삭제', '이 알림장을 삭제할까요?', '삭제', async () => {
          const n = S.state.notices.find(x => x.id === id);
          if (n) { n._del = true; touch(n); await Sync.save(); renderApp(); }
        });
        return;
      }

      case 'new-feed': { if (!can('feed.write')) return; feedWriteModal(); return; }
      case 'save-feed': {
        const title = val('fTitle'), body = val('fBody');
        if (!title || !body) return toast('제목과 내용을 입력하세요', 'err');
        S.state.feeds.push({ id: 'fd-' + Crypto.uid(), deptId: val('fDept'), title: title, body: body, author: S.me.uid, authorName: S.me.name, at: Date.now(), u: Date.now() });
        closeModal(); await Sync.save(); renderApp(); toast('올렸습니다', 'ok'); return;
      }
      case 'del-feed': {
        const id = t.dataset.id;
        confirmBox('글 삭제', '이 글을 삭제할까요?', '삭제', async () => {
          const f = S.state.feeds.find(x => x.id === id);
          if (f) { f._del = true; touch(f); await Sync.save(); renderApp(); }
        });
        return;
      }

      case 'new-class': classModal(null, t.dataset.dept); return;
      case 'edit-class': classModal(classById(t.dataset.id)); return;
      case 'save-class': {
        const id = t.dataset.id;
        const name = val('cName');
        if (!name) return toast('반 이름을 입력하세요', 'err');
        if (id) {
          const c = classById(id); if (!c) return;
          c.name = name; c.deptId = val('cDept'); c.note = val('cNote'); touch(c);
        } else {
          S.state.classes.push({ id: 'cl-' + Crypto.uid(), name: name, deptId: val('cDept'), note: val('cNote'), year: curYear(), order: (S.state.classes || []).length + 1, u: Date.now() });
        }
        closeModal(); await Sync.save(); renderApp(); return;
      }
      case 'del-class': {
        const id = t.dataset.id;
        confirmBox('반 삭제', '이 반을 삭제할까요? 학생은 반 미지정으로 남습니다.', '삭제', async () => {
          const c = classById(id);
          if (c) { c._del = true; touch(c); (S.state.students || []).forEach(s => { if (s.classId === id) { s.classId = ''; touch(s); } }); await Sync.save(); renderApp(); }
        });
        return;
      }
      case 'new-student': studentModal(null, t.dataset.cls); return;
      case 's-newcomer': {
        V.stuNewcomer = !V.stuNewcomer;
        t.textContent = V.stuNewcomer ? '★ 신입으로 표시됨' : '☆ 신입으로 표시';
        t.classList.toggle('amber', !!V.stuNewcomer);
        t.classList.toggle('gray', !V.stuNewcomer);
        return;
      }
      case 'att-new': {
        const s = (S.state.students || []).find(x => x.id === t.dataset.sid);
        if (!s) return;
        const a = attOf(V.date, s.id);
        if (!a) return toast('먼저 출·결·인 중 하나를 눌러 주세요', 'err');
        a.isNew = !a.isNew;
        touch(a);
        await Sync.save(); renderApp();
        toast(a.isNew ? s.name + ' 학생을 ' + fmtShort(V.date) + ' 신입으로 표시했습니다' : '신입 표시를 껐습니다', 'ok');
        return;
      }
      case 'save-my-birth': await saveMyBirth(); return;
      case 'edit-student': studentModal((S.state.students || []).find(x => x.id === t.dataset.id)); return;
      case 'save-student': {
        const id = t.dataset.id;
        const name = val('sName');
        if (!name) return toast('학생 이름을 입력하세요', 'err');
        const clsId = val('sClass');
        const cls = classById(clsId);
        const bt = V.stuBirthType || 'solar';
        const birth = val('sBirth');
        let s = null;
        if (id) {
          s = S.state.students.find(x => x.id === id); if (!s) return;
          s.name = name; s.birth = birth; s.birthType = bt; s.birthLunar = bt === 'lunar' ? birthdayMmdd(birth) : '';
          s.gender = val('sGender'); s.classId = clsId; s.deptId = cls ? cls.deptId : s.deptId;
          s.guardianName = val('sGuardian'); s.guardianPhone = val('sPhone'); s.note = val('sNote');
          s.newcomer = !!V.stuNewcomer; touch(s);
        } else {
          s = { id: 'st-' + Crypto.uid(), personId: '', name: name, birth: birth, birthType: bt, birthLunar: bt === 'lunar' ? birthdayMmdd(birth) : '', gender: val('sGender'), classId: clsId, deptId: cls ? cls.deptId : V.dept, guardianName: val('sGuardian'), guardianPhone: val('sPhone'), note: val('sNote'), newcomer: !!V.stuNewcomer, active: true, joined: ymd(), year: curYear(), u: Date.now() };
          s.personId = s.id;
          S.state.students.push(s);
        }
        syncBirthEventOf('student', s.personId || s.id, s, s.deptId || V.dept || '');
        closeModal(); await Sync.save(); renderApp(); return;
      }
      case 'del-student': {
        const id = t.dataset.id;
        confirmBox('학생 삭제', '이 학생을 목록에서 지울까요? 출석 기록은 남고, 생일 일정도 함께 지워집니다.', '삭제', async () => {
          const s = S.state.students.find(x => x.id === id);
          if (s) {
            s._del = true; touch(s);
            syncBirthEvent('student', s.personId || s.id, s.name, '', []);
            await Sync.save(); renderApp();
          }
        });
        return;
      }

      case 'new-event': eventModal(null); return;
      case 'edit-event': eventModal((S.state.events || []).find(x => x.id === t.dataset.id)); return;
      case 'save-event': {
        const id = t.dataset.id;
        const title = val('eTitle');
        if (!title) return toast('제목을 입력하세요', 'err');
        if (id) {
          const e = S.state.events.find(x => x.id === id); if (!e) return;
          e.title = title; e.date = val('eDate'); e.time = val('eTime'); e.deptId = val('eDept'); e.place = val('ePlace'); e.desc = val('eDesc'); touch(e);
        } else {
          S.state.events.push({ id: 'ev-' + Crypto.uid(), title: title, date: val('eDate'), year: yearOfDate(val('eDate')) || curYear(), time: val('eTime'), deptId: val('eDept'), place: val('ePlace'), desc: val('eDesc'), by: S.me.uid, u: Date.now() });
        }
        closeModal(); await Sync.save(); renderApp(); return;
      }
      case 'del-event': {
        const id = t.dataset.id;
        confirmBox('일정 삭제', '이 일정을 삭제할까요?', '삭제', async () => {
          const e = S.state.events.find(x => x.id === id);
          if (e) { e._del = true; touch(e); await Sync.save(); renderApp(); }
        });
        return;
      }

      case 'admin-tab':
        V.adminTab = t.dataset.tab;
        if (S.screen !== 'admin') S.screen = 'admin';
        if (V.adminTab === 'users') { V.accounts = null; loadAccounts(); }
        renderApp(); return;
      case 'reload-users': V.accounts = null; loadAccounts(true); return;

      case 'new-user': userModal(null); return;
      case 'edit-user': {
        if (!V.accounts) return;
        const a = V.accounts.find(x => x.uid === t.dataset.uid);
        if (a) userModal(a);
        return;
      }
      case 'toggle-role': {
        if (!V.editUser) return;
        const k = t.dataset.key; const i = V.editUser.roles.indexOf(k);
        if (i >= 0) V.editUser.roles.splice(i, 1); else V.editUser.roles.push(k);
        t.classList.toggle('coral'); t.classList.toggle('gray'); return;
      }
      case 'toggle-dept': {
        if (!V.editUser) return;
        const k = t.dataset.id; const i = V.editUser.depts.indexOf(k);
        if (i >= 0) V.editUser.depts.splice(i, 1); else V.editUser.depts.push(k);
        t.classList.toggle('coral'); t.classList.toggle('gray'); return;
      }
      case 'toggle-class': {
        if (!V.editUser) return;
        const k = t.dataset.id; const i = V.editUser.classes.indexOf(k);
        if (i >= 0) V.editUser.classes.splice(i, 1); else V.editUser.classes.push(k);
        t.classList.toggle('coral'); t.classList.toggle('gray'); return;
      }
      case 'toggle-student': {
        if (!V.editUser) return;
        const k = t.dataset.id; const i = V.editUser.students.indexOf(k);
        if (i >= 0) V.editUser.students.splice(i, 1); else V.editUser.students.push(k);
        t.classList.toggle('coral'); t.classList.toggle('gray'); return;
      }
      case 'toggle-active': {
        if (!V.editUser) return;
        V.editUser.active = !V.editUser.active;
        t.textContent = V.editUser.active ? '사용 중' : '사용 중지';
        t.classList.toggle('mint', V.editUser.active); t.classList.toggle('gray', !V.editUser.active); return;
      }
      case 'save-user': await saveUser(); return;
      case 'del-user': {
        const uid = t.dataset.uid;
        const acct = (V.accounts || []).find(x => x.uid === uid);
        confirmBox('사용자 삭제', (acct ? acct.rec.name : '이 사용자') + ' 계정을 삭제할까요? 이 계정으로는 더 이상 로그인할 수 없습니다.', '삭제', async () => {
          await deleteAccountRow(uid);
          V.accounts = null; closeModal(); await loadAccounts(true); toast('삭제했습니다', 'ok');
        });
        return;
      }

      case 'new-dept': deptModal(null); return;
      case 'edit-dept': deptModal(deptById(t.dataset.id)); return;
      case 'save-dept': {
        const id = t.dataset.id;
        const name = val('dName');
        if (!name) return toast('부서 이름을 입력하세요', 'err');
        if (id) {
          const d = deptById(id); if (!d) return;
          d.name = name; d.emoji = val('dEmoji') || '📖'; d.color = val('dColor'); d.note = val('dNote'); d.order = num('dOrder', 1); touch(d);
        } else {
          S.state.departments.push({ id: 'dept-' + Crypto.uid(), name: name, emoji: val('dEmoji') || '📖', color: val('dColor'), note: val('dNote'), order: num('dOrder', 99), active: true, u: Date.now() });
        }
        closeModal(); await Sync.save(); renderApp(); return;
      }

      case 'new-role': roleModal(null); return;
      case 'edit-role': roleModal((S.state.roles || []).find(x => x.key === t.dataset.id)); return;
      case 'save-role': {
        const key = t.dataset.key;
        const label = val('rLabel');
        if (!label) return toast('역할 이름을 입력하세요', 'err');
        if (key) {
          const r = (S.state.roles || []).find(x => x.key === key); if (!r) return;
          r.label = label; r.emoji = val('rEmoji') || '🙂'; r.base = val('rBase'); touch(r);
        } else {
          const k = 'role-' + label.replace(/\s+/g, '').slice(0, 8) + '-' + Crypto.uid().slice(0, 4);
          S.state.roles.push({ key: k, label: label, emoji: val('rEmoji') || '🙂', base: val('rBase'), u: Date.now() });
        }
        closeModal(); await Sync.save(); renderApp(); return;
      }

      case 'force-pull': {
        const ch = await Sync.pull(false);
        renderApp(); toast(ch ? '새 자료를 불러왔습니다' : '최신 상태입니다', 'ok'); return;
      }
      case 'force-save': {
        const ok = await Sync.save();
        renderApp(); toast(ok ? '저장했습니다' : '저장하지 못했습니다', ok ? 'ok' : 'err'); return;
      }

      case 'pw-change': await changePassword(); return;
      case 'logout': doLogout(); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});

function setAttSilent(date, deptId, classId, studentId, status) {
  let rec = (S.state.attendance || []).find(a => !a._del && a.date === date && a.studentId === studentId);
  if (!rec) {
    rec = { id: 'at-' + Crypto.uid(), date: date, deptId: deptId, classId: classId, studentId: studentId, status: status, by: S.me.uid, at: Date.now(), u: 0 };
    S.state.attendance.push(rec);
  }
  rec.status = status; rec._del = false; rec.by = S.me.uid; rec.at = Date.now(); touch(rec);
}

/* 날짜 입력 */
document.addEventListener('change', function (ev) {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.change) return;
  if (t.dataset.change === 'att-date') { syncYearToDate(t.value); V.date = t.value; renderApp(); }
  if (t.dataset.change === 'report-date') { syncYearToDate(t.value); V.reportDate = t.value; renderApp(); }
});

/* ---------------- 관리자: 사용자 저장 ---------------- */
async function saveUser() {
  const e = V.editUser;
  if (!e) return;
  const id = e.uid ? e.id : normId(val('uId'));
  const name = val('uName');
  const pw = val('uPw');
  const birth = val('uBirth');
  const bt = e.birthType === 'lunar' ? 'lunar' : 'solar';
  const bLunar = bt === 'lunar' ? birthdayMmdd(birth) : '';
  const status = ACCOUNT_STATUS[e.status] ? e.status : 'normal';
  const statusNote = (document.getElementById('uStatusNote') || {}).value || e.statusNote || '';
  if (!id) return toast('아이디를 입력하세요', 'err');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(id)) return toast('아이디는 영문·숫자 3~24자입니다', 'err');
  if (!name) return toast('이름을 입력하세요', 'err');
  if (!e.roles.length) return toast('역할을 하나 이상 골라 주세요', 'err');
  if (!e.uid && pw.length < 8) return toast('비밀번호는 8자 이상입니다', 'err');
  if (pw && pw.length < 8) return toast('비밀번호는 8자 이상입니다', 'err');

  if (!e.uid) {
    const uid = await uidOf(id);
    const exist = await fetchAccount(uid);
    if (exist) return toast('이미 같은 아이디가 있습니다', 'err');
    const row = await buildAccount(S.dek, { id: id, password: pw, name: name, roles: e.roles, depts: e.depts, classes: e.classes, students: e.students, birth: birth, birthType: bt, birthLunar: bLunar, status: status, statusNote: statusNote, active: e.active });
    await saveAccountRow(row);
    syncBirthEvent('account', row.uid, name, birth, e.depts || [], bt, bLunar);
    await Sync.save();
    toast(name + ' 계정을 만들었습니다', 'ok');
  } else {
    const cur = await fetchAccount(e.uid);
    if (!cur) return toast('계정을 찾지 못했습니다', 'err');
    let salt = cur.salt, wrap = cur.wrap;
    if (pw) {
      salt = Crypto.randB64(16);
      const k = await Crypto.kek(pw, salt);
      wrap = JSON.stringify(await Crypto.seal(k, S.wkRaw));
    }
    const rec = await Crypto.sealJson(S.dek, { id: e.id, name: name, roles: e.roles, depts: e.depts, classes: e.classes, students: e.students, birth: birth, birthType: bt, birthLunar: bLunar, status: status, statusNote: statusNote, statusAt: Date.now(), grants: e.grants || {}, active: e.active, at: Date.now() });
    await saveAccountRow({ uid: e.uid, salt: salt, wrap: wrap, rec: JSON.stringify(rec), rev: Date.now(), updated: Date.now(), deleted: '' });
    syncBirthEvent('account', e.uid, name, birth, e.depts || [], bt, bLunar);
    await Sync.save();
    if (e.uid === S.me.uid) {
      S.me = Object.assign({}, S.me, { name: name, roles: e.roles, depts: e.depts, classes: e.classes, students: e.students, birth: birth, birthType: bt, birthLunar: bLunar, status: status, grants: e.grants || S.me.grants || {} });
      if (e.roles.indexOf(S.roleKey) < 0) S.roleKey = e.roles[0] || S.roleKey;
      saveSession();
    }
    toast('저장했습니다', 'ok');
  }
  V.editUser = null;
  closeModal();
  V.accounts = null;
  await loadAccounts(true);
}

async function changePassword() {
  const oldPw = val('pwOld'), n1 = val('pwNew'), n2 = val('pwNew2');
  if (!oldPw) return toast('현재 비밀번호를 입력하세요', 'err');
  if (n1.length < 8) return toast('새 비밀번호는 8자 이상입니다', 'err');
  if (n1 !== n2) return toast('새 비밀번호가 서로 다릅니다', 'err');
  try {
    const row = await fetchAccount(S.me.uid);
    if (!row) return toast('계정을 찾지 못했습니다', 'err');
    const kek = await Crypto.kek(oldPw, row.salt);
    try { await Crypto.open(kek, JSON.parse(row.wrap)); } catch (e) { return toast('현재 비밀번호가 맞지 않습니다', 'err'); }
    const salt = Crypto.randB64(16);
    const kek2 = await Crypto.kek(n1, salt);
    const wrap = await Crypto.seal(kek2, S.wkRaw);
    await saveAccountRow({ uid: S.me.uid, salt: salt, wrap: JSON.stringify(wrap), rec: row.rec, rev: Date.now(), updated: Date.now(), deleted: '' });
    document.getElementById('pwOld').value = '';
    document.getElementById('pwNew').value = '';
    document.getElementById('pwNew2').value = '';
    toast('비밀번호를 바꿨습니다', 'ok');
  } catch (e) {
    toast('바꾸지 못했습니다: ' + ((e && e.message) || e), 'err');
  }
}

/* ---------------- 인쇄 ---------------- */
function printReport(r) {
  const dept = deptById(r.deptId) || {};
  const cn = r.counts || {};
  const absR = absentRowsOf(r.deptId, r.date);
  const newR = newcomerRowsOf(r.deptId, r.date);
  const absText = absR.length ? absR.map(x => x.cls + ' ' + x.name + (x.reason ? ' (' + x.reason + ')' : '')).join(', ') : '없음';
  const newText = newR.length ? newR.map(x => x.cls + ' ' + x.name).join(', ') : '없음';
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다', 'err');
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주일보고</title>' +
    '<style>@page{size:A4 portrait;margin:14mm}body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;padding:18px;color:#222}h1{font-size:19px;text-align:center;margin:0 0 4px}h2{font-size:12px;text-align:center;color:#777;font-weight:600;margin:0 0 16px}table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid #ccc;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f7f3ef;width:104px;font-weight:700}.box{white-space:pre-wrap;min-height:52px}</style></head><body>' +
    '<h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 주일학교 주일보고</h1>' +
    '<h2>' + esc(fmtDate(r.date)) + ' · ' + esc(dept.name || '') + '</h2>' +
    '<table><tr><th>재적</th><td>' + (cn.enrolled || 0) + '</td><th>출석</th><td>' + (cn.present || 0) + '</td><th>결석</th><td>' + (cn.absent || 0) + '</td><th>신입</th><td>' + newR.length + '</td></tr>' +
    '<tr><th>교사 출석</th><td colspan="3">' + (cn.teacherPresent || 0) + ' / ' + (cn.teacherTotal || 0) + '</td><th>헌금</th><td colspan="3">' + esc(r.offering || '-') + '</td></tr>' +
    '<tr><th>결석자</th><td colspan="7">' + esc(absText) + '</td></tr>' +
    '<tr><th>신입</th><td colspan="7">' + esc(newText) + '</td></tr>' +
    '<tr><th>예배 말씀</th><td colspan="7">' + esc(r.scripture || '') + '</td></tr>' +
    '<tr><th>공과 내용</th><td colspan="7">' + esc(r.lesson || '') + '</td></tr>' +
    '<tr><th>특이사항</th><td colspan="7" class="box">' + esc(r.notes || '') + '</td></tr>' +
    '<tr><th>기도제목</th><td colspan="7" class="box">' + esc(r.prayer || '') + '</td></tr>' +
    '<tr><th>작성</th><td colspan="3">' + esc(r.authorName || '') + '</td><th>확인</th><td colspan="3">' + esc(r.checkedByName || '') + '</td></tr></table>' +
    '<p style="font-size:10px;color:#999;text-align:center;margin-top:16px">덕신교회 부서업무 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},200)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}

/* 내 정보 — 생일(양력·음력) 저장 */
async function saveMyBirth() {
  const birth = val('myBirth');
  const type = V.myBirthType === 'lunar' ? 'lunar' : (V.myBirthType === 'solar' ? 'solar' : birthTypeOf(S.me));
  if (!birth) return toast('생일을 골라 주세요', 'err');
  if (type === 'lunar' && !lunarYearInfo(Number(birth.slice(0, 4)))) return toast('음력 생일은 1930~2050년 사이로 넣어 주세요', 'err');
  const lunarMmdd = type === 'lunar' ? birthdayMmdd(birth) : '';
  try {
    await updateAccountRec(S.me.uid, rec => {
      rec.birth = birth; rec.birthType = type; rec.birthLunar = lunarMmdd;
    });
  } catch (e) {
    return toast((e && e.message) || '생일을 저장하지 못했습니다', 'err');
  }
  S.me.birth = birth; S.me.birthType = type; S.me.birthLunar = lunarMmdd;
  syncBirthEventOf('account', S.me.uid, S.me, S.me.depts || []);
  await Sync.save();
  saveSession();
  renderApp();
  const occ = birthOccDate(S.me, curYear());
  toast('생일을 저장했습니다' + (occ ? ' · ' + curYear() + '년 ' + fmtShort(occ) + '에 일정 표시' : ''), 'ok');
}

/* ---------------- 시작 ---------------- */
async function boot() {
  document.body.innerHTML = '<div id="root"></div><div id="modalRoot" style="display:none"></div><div id="toastWrap"></div>';
  document.getElementById('root').innerHTML = '<div class="login-wrap"><div class="login-card"><div class="login-brand"><div class="login-logo">🏫</div><h1>덕신교회 부서업무</h1><p>불러오는 중…</p></div></div></div>';
  if (!Api.on()) { showLogin('동기화 서버 주소가 설정되지 않았습니다.'); return; }
  let accountsExist = true;
  try {
    const r = await Api.call({ action: 'acct_list' }, 12000);
    accountsExist = !!(r.ok && (r.rows || []).filter(x => String(x.deleted) !== '1').length);
  } catch (e) {
    showLogin('동기화 서버에 연결하지 못했습니다: ' + ((e && e.message) || e));
    return;
  }
  if (!accountsExist) { showSetup(); return; }
  const restored = await restoreSession();
  if (restored) {
    try {
      S.state = emptyState(false);
      S.ready = false;
      await Sync.pull(true);
      S.ready = true;
      rememberMe();
      V.date = lastSunday(); V.reportDate = lastSunday();
      if (!S.year) S.year = new Date().getFullYear();
      const ds = visibleDepts(); V.dept = ds.length ? ds[0].id : '';
      renderHomeShell();
      Sync.timer = setInterval(() => {
        if (document.hidden || !S.dek) return;
        Sync.pull(true).then(ch => { if (ch) renderApp(); });
        S.tick = (S.tick || 0) + 1;
        if (S.tick % 4 === 0) refreshMyAccount();
      }, 9000);
      return;
    } catch (e) { /* 세션 복원 실패 → 로그인 */ }
  }
  showLogin();
}

window.addEventListener('DOMContentLoaded', boot);
