/* 덕신교회 부서업무 — 화면 */
'use strict';

const V = {
  date: lastSunday(),
  dept: '', cls: '',
  reportDate: lastSunday(), reportId: '',
  noticeId: '',
  adminTab: 'users',
  accounts: null, accountsLoading: false, accountsErr: '',
  memberClass: '',
  editUser: null,
  showRoleMenu: false,
  historyUid: ''
};

function el(id) { return document.getElementById(id); }
function val(id) { const e = el(id); return e ? String(e.value || '').trim() : ''; }
function num(id, dflt) { const n = Number(val(id)); return isFinite(n) ? n : (dflt || 0); }
function opts(list, sel) { return list.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join(''); }

/* ---------------- 역할 화면 목록 ---------------- */
function screensFor(roleKey) {
  const r = roleDef(roleKey);
  const P = permsOf(roleKey);
  /* 목회자는 주일보고(수신함·통합 통계·연간 출결부) 중심으로 깔끔하게 */
  if (r.base === 'pastor') {
    const out = [{ key: 'report', label: '주일보고', icon: '📋' }];
    if (P['user.approve']) out.push({ key: 'approve', label: '가입 승인', icon: '👋' });
    out.push({ key: 'me', label: '내 정보', icon: '🙂' });
    return out;
  }
  const out = [{ key: 'home', label: '홈', icon: '🏠' }];
  if (P['attendance.check'] || P['attendance.self'] || P['attendance.stat']) out.push({ key: 'attendance', label: (P['attendance.self'] && !P['attendance.check']) ? '자녀 출석' : '출석', icon: '✅' });
  if (P['attendance.stat']) out.push({ key: 'stats', label: '출석통계', icon: '📊' });
  if (P['report.write'] || P['report.review']) out.push({ key: 'report', label: (P['report.review'] && !P['report.write']) ? '주일보고 수신함' : '주일보고', icon: '📋' });
  if (P['plan.read'] || P['plan.write']) out.push({ key: 'plan', label: '월별계획표', icon: '🗓️' });
  if (P['ledger.manage']) out.push({ key: 'ledger', label: '회계', icon: '💰' });
  if (P['notice.read'] || P['notice.write']) out.push({ key: 'notice', label: '알림장', icon: '📌' });
  if (P['feed.read'] || P['feed.write']) out.push({ key: 'feed', label: '부서 피드', icon: '💬' });
  if (P['member.manage']) out.push({ key: 'members', label: '반·학생', icon: '👥' });
  if (P['staff.manage']) out.push({ key: 'staff', label: '교사·권한', icon: '🧑‍🏫' });
  out.push({ key: 'schedule', label: '일정', icon: '📅' });
  if (P['year.manage']) out.push({ key: 'years', label: '연도·진급', icon: '🎓' });
  if (P['user.approve']) out.push({ key: 'approve', label: '가입 승인', icon: '👋' });
  if (P['user.manage'] || P['dept.manage']) out.push({ key: 'admin', label: '관리', icon: '⚙️' });
  out.push({ key: 'me', label: '내 정보', icon: '🙂' });
  return out;
}

function pendingReports() {
  if (!can('report.review')) return 0;
  return (S.state.reports || []).filter(r => !r._del && r.status === 'submitted' && inYear(r)).length;
}
function unreadNotices() {
  const uid = S.me ? S.me.uid : '';
  return noticesForMe().filter(n => n.author !== uid && !(n.reads || {})[uid]).length;
}
function pendingApprovals() {
  if (!can('user.approve')) return 0;
  return (V.apps || []).filter(a => a.status === 'pending' && canApprove(a)).length;
}

/* ---------------- 공통 조각 ---------------- */
function deptChip(d) { if (!d) return ''; return '<span class="chip" style="background:' + esc(d.color) + '22;border-color:' + esc(d.color) + '55">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</span>'; }
function emptyBox(em, text, sub) {
  return '<div class="empty"><span class="em">' + em + '</span>' + esc(text) + (sub ? '<div style="margin-top:6px;font-size:11.5px;font-weight:600">' + esc(sub) + '</div>' : '') + '</div>';
}
function statusChip(st) {
  if (st === 'submitted') return '<span class="chip sky">제출완료</span>';
  if (st === 'checked') return '<span class="chip mint">확인완료</span>';
  if (st === 'rejected') return '<span class="chip rose">반려</span>';
  return '<span class="chip gray">작성중</span>';
}
function attLabel(s) { return s === 'present' ? '출석' : s === 'absent' ? '결석' : s === 'excused' ? '인정' : '-'; }

function myStudents() {
  if (!S.me) return [];
  const base = roleDef(S.roleKey).base;
  if (base === 'parent') {
    const ids = S.me.students || [];
    return (S.state.students || []).filter(s => !s._del && inYear(s) && (ids.indexOf(s.id) >= 0 || s.guardianUid === S.me.uid));
  }
  if (base === 'teacher') {
    const cls = S.me.classes || [];
    return (S.state.students || []).filter(s => !s._del && inYear(s) && cls.indexOf(s.classId) >= 0);
  }
  return allStudentsIn(curYear());
}

function myClassList() {
  const base = roleDef(S.roleKey).base;
  if (base === 'teacher') return (S.state.classes || []).filter(c => !c._del && inYear(c) && (S.me.classes || []).indexOf(c.id) >= 0);
  return (S.state.classes || []).filter(c => !c._del && inYear(c));
}

function noticesForMe() {
  const depts = visibleDepts().map(d => d.id);
  const isParent = roleDef(S.roleKey).base === 'parent';
  const kids = isParent ? myStudents() : [];
  return (S.state.notices || []).filter(n => !n._del && depts.indexOf(n.deptId) >= 0)
    .filter(n => {
      if (!n.classId) return true;
      if (!isParent) return true;
      return kids.some(k => k.classId === n.classId);
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

function eventsForMe() {
  const depts = visibleDepts().map(d => d.id);
  const y = curYear();
  const out = [];
  (S.state.events || []).filter(e => !e._del && depts.indexOf(e.deptId) >= 0).forEach(e => {
    if (e.auto === 'birth') {
      [y, y + 1].forEach(yy => {
        const d = birthOccDate(e, yy);
        if (d) out.push(Object.assign({}, e, { date: d, occYear: yy, occId: e.id + '@' + yy }));
      });
    } else if (inYear(e)) out.push(e);
  });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* ---------------- 헤더 · 탭 ---------------- */
function renderApp() {
  const role = activeRole();
  const scr = screensFor(S.roleKey);
  if (!scr.some(s => s.key === S.screen)) S.screen = scr.length ? scr[0].key : 'home';
  const badge = { report: pendingReports(), notice: unreadNotices(), approve: pendingApprovals() };
  const deptTxt = roleDef(S.roleKey).base === 'parent' ? (myStudents()[0] ? (deptById(myStudents()[0].deptId) || {}).name || '' : '') : '';

  let html = '';
  html += '<div class="appbar">';
  html += '<div class="mark">🏫</div>';
  html += '<div class="who"><b>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 부서업무</b><span>' + esc(S.me.name) + (deptTxt ? ' · ' + esc(deptTxt) : '') + '</span></div>';
  html += '<button class="sync-dot ' + S.sync + '" id="syncDot" data-act="force-pull" title="눌러서 새로 불러오기"><i></i><span>' + esc(S.syncMsg) + '</span></button>';
  if (myRoleDefs().length > 1) html += '<button class="role-switch" data-act="role-menu">' + esc(role.emoji || '') + ' ' + esc(role.label) + ' ⇄</button>';
  else html += '<span class="chip coral big">' + esc(role.emoji || '') + ' ' + esc(role.label) + '</span>';
  html += '</div>';

  html += '<div class="tabs">';
  scr.forEach(s => {
    html += '<button class="' + (S.screen === s.key ? 'on' : '') + '" data-act="nav" data-screen="' + s.key + '">' + s.icon + ' ' + esc(s.label) +
      (badge[s.key] ? ' <span class="bdg">' + badge[s.key] + '</span>' : '') + '</button>';
  });
  html += '</div>';

  /* 연도 선택기 — 출석·보고·계획·회계·일정이 이 연도 기준으로 보입니다 */
  const yrs = availableYears();
  const yi = yrs.indexOf(curYear());
  html += '<div class="yearbar">';
  html += '<button class="year-btn" data-act="year-menu">📅 ' + curYear() + '년 <span>▾</span></button>';
  if (yrs.length > 1) {
    html += '<button class="year-nav" data-act="year-move" data-v="-1"' + (yi <= 0 ? ' disabled' : '') + '>‹</button>';
    html += '<button class="year-nav" data-act="year-move" data-v="1"' + (yi >= yrs.length - 1 ? ' disabled' : '') + '>›</button>';
  }
  html += '<span class="year-note">학생 ' + allStudentsIn(curYear()).length + '명 · 주일 ' + (S.state.reports || []).filter(r => !r._del && inYear(r)).length + '건 보고</span>';
  if (can('year.manage') && S.screen !== 'years') html += '<button class="year-nav wide" data-act="nav" data-screen="years">🎓 연도·진급</button>';
  html += '</div>';

  html += '<div class="main" id="main">' + screenHtml() + '</div>';
  el('root').innerHTML = html;
  setSync(S.sync, S.syncMsg);
}

function screenHtml() {
  try {
    switch (S.screen) {
      case 'home': return homeView();
      case 'attendance': return attendanceView();
      case 'report': return reportView();
      case 'notice': return noticeView();
      case 'feed': return feedView();
      case 'members': return membersView();
      case 'staff': return staffView();
      case 'schedule': return scheduleView();
      case 'plan': return planView();
      case 'ledger': return ledgerView();
      case 'stats': return statsView();
      case 'approve': return approveView();
      case 'years': return yearsView();
      case 'admin': return adminView();
      case 'me': return meView();
      default: return homeView();
    }
  } catch (e) {
    console.error(e);
    return '<div class="card"><h3>화면을 그리지 못했습니다</h3><p class="muted">' + esc(e.message) + '</p></div>';
  }
}

/* ---------------- 홈 ---------------- */
function homeView() {
  const base = roleDef(S.roleKey).base;
  const name = S.me.name;
  const hour = new Date().getHours();
  const greet = hour < 11 ? '좋은 아침이에요' : hour < 18 ? '안녕하세요' : '수고 많으셨어요';
  const sun = V.date || lastSunday();
  const curMonth = String(sun).slice(0, 7);
  const noticeList = noticesForMe();
  const myNotices = noticeList.slice(0, 3);
  const evs = eventsForMe().filter(e => e.date >= ymd()).slice(0, 3);
  let h = '';

  h += '<div class="page-head"><div><h2>' + esc(name) + '님, ' + greet + ' 🙏</h2><p>' + esc(fmtDate(sun)) + ' 주일 기준</p></div></div>';

  if (base === 'parent') {
    const kids = myStudents();
    if (!kids.length) {
      h += '<div class="banner coral">아직 연결된 자녀가 없습니다. 부서 담당 교사에게 자녀 연결을 요청해 주세요.</div>';
    }
    kids.forEach(k => {
      const d = deptById(k.deptId);
      const st = monthStats(k.id, curMonth);
      h += '<div class="card"><h3>' + esc(k.name) + ' <small>' + esc((classById(k.classId) || {}).name || '') + ' · ' + esc((d || {}).name || '') + '</small><span class="sp"></span><span class="chip mint">이번 달 ' + st.rate + '%</span></h3>';
      h += '<div class="stat-grid"><div class="stat present"><b>' + st.present + '</b><span>출석</span></div><div class="stat absent"><b>' + st.absent + '</b><span>결석</span></div><div class="stat new"><b>' + st.excused + '</b><span>인정</span></div><div class="stat enroll"><b>' + st.total + '</b><span>주일</span></div></div>';
      h += '</div>';
    });
    const unread = myNotices.filter(n => !(n.reads || {})[S.me.uid]);
    if (unread.length) h += '<div class="banner">📌 확인하지 않은 알림장이 ' + unread.length + '개 있어요.</div>';
  }

  if (base === 'teacher' || base === 'edu' || base === 'admin') {
    const depts = visibleDepts();
    if (base === 'teacher') {
      const cls = myClassList().filter(c => !V.dept || c.deptId === V.dept);
      cls.forEach(c => {
        const studs = studentsOfClass(c.id);
        const done = studs.filter(s => attOf(sun, s.id)).length;
        h += '<div class="card"><h3>' + esc((deptById(c.deptId) || {}).emoji || '') + ' ' + esc(c.name) + '<span class="sp"></span>' + (studs.length && done === studs.length ? '<span class="chip mint">출석 완료</span>' : '<span class="chip amber">출석 ' + done + '/' + studs.length + '</span>') + '</h3>';
        h += '<button class="btn primary block" data-act="go-att" data-cls="' + esc(c.id) + '">' + fmtShort(sun) + ' 출석 체크하기</button></div>';
      });
      if (!myClassList().length) h += '<div class="banner">담당 반이 아직 지정되지 않았습니다. 교육부서담당에게 요청해 주세요.</div>';
    } else {
      h += '<div class="card"><h3>📊 ' + fmtShort(sun) + ' 부서 출석<span class="sp"></span><small>눌러서 확인</small></h3>';
      h += '<div class="list">';
      depts.forEach(d => {
        const c = deptCounts(d.id, sun);
        const rp = reportOf(d.id, sun);
        h += '<button class="item" data-act="go-att" data-dept="' + esc(d.id) + '">';
        h += '<span class="av" style="background:' + esc(d.color) + '33">' + esc(d.emoji || '📖') + '</span>';
        h += '<span class="tx"><b>' + esc(d.name) + '</b><span>재적 ' + c.enrolled + ' · 출석 ' + c.present + ' · 결석 ' + c.absent + '</span></span>';
        h += '<span class="rt">' + statusChip(rp ? rp.status : 'draft') + '</span></button>';
      });
      if (!depts.length) h += emptyBox('🏫', '아직 부서가 없습니다', '관리 → 부서 관리에서 추가하세요');
      h += '</div></div>';
    }
  }

  if (base === 'pastor') {
    const open = (S.state.reports || []).filter(r => !r._del && r.status === 'submitted' && inYear(r));
    h += '<div class="card"><h3>📥 제출된 주일보고<span class="sp"></span>' + (open.length ? '<span class="chip rose">' + open.length + '건 확인 대기</span>' : '<span class="chip mint">모두 확인</span>') + '</h3>';
    if (!open.length) h += '<p class="muted" style="margin:0">지금은 확인할 보고서가 없습니다.</p>';
    else h += '<div class="list">' + open.slice(0, 4).map(r => '<button class="item" data-act="open-report" data-id="' + esc(r.id) + '"><span class="av">📄</span><span class="tx"><b>' + esc((deptById(r.deptId) || {}).name || '부서') + ' · ' + esc(fmtShort(r.date)) + '</b><span>' + esc(r.authorName || '') + ' · 출석 ' + (r.counts ? r.counts.present : 0) + '/' + (r.counts ? r.counts.enrolled : 0) + '</span></span><span class="rt">' + statusChip(r.status) + '</span></button>').join('') + '</div>';
    h += '<button class="btn block" style="margin-top:10px" data-act="go-report">주일보고 수신함 열기</button></div>';
  }

  if (base === 'admin') {
    h += '<div class="card"><h3>⚙️ 관리<span class="sp"></span><small>사용자·부서·역할</small></h3><div class="tile-grid">';
    h += '<button class="tile" data-act="nav" data-screen="admin"><span class="ic">👤</span><span><b>사용자 관리</b><span>계정·역할·부서</span></span></button>';
    h += '<button class="tile" data-act="admin-tab" data-tab="depts"><span class="ic">🏫</span><span><b>부서 관리</b><span>' + visibleDepts().length + '개 부서</span></span></button>';
    h += '<button class="tile" data-act="admin-tab" data-tab="roles"><span class="ic">🎭</span><span><b>역할 관리</b><span>' + (S.state.roles || []).length + '개 역할</span></span></button>';
    h += '</div></div>';
  }

  // 가입 승인 대기 안내
  const pend = pendingApprovals();
  if (pend) h += '<button class="banner coral" style="width:100%;text-align:left" data-act="nav" data-screen="approve">👋 가입 신청 ' + pend + '건이 승인을 기다리고 있습니다. 눌러서 확인하세요.</button>';

  // 빠른 실행
  h += '<div class="sect-title">빠른 실행</div><div class="tile-grid">';
  if (base === 'edu' || base === 'teacher' || base === 'admin') h += '<button class="tile" data-act="go-att"><span class="ic">✅</span><span><b>출석 체크</b><span>' + fmtShort(sun) + ' 주일</span></span></button>';
  if (can('plan.write') || can('plan.read')) h += '<button class="tile" data-act="nav" data-screen="plan"><span class="ic">🗓️</span><span><b>월별계획표</b><span>계획·행사·공과</span></span></button>';
  if (can('ledger.manage')) h += '<button class="tile" data-act="nav" data-screen="ledger"><span class="ic">💰</span><span><b>회계 관리</b><span>수입·지출·영수증</span></span></button>';
  if (can('attendance.stat')) h += '<button class="tile" data-act="nav" data-screen="stats"><span class="ic">📊</span><span><b>출석통계</b><span>출석률·결석 사유</span></span></button>';
  if (base === 'edu' || base === 'admin') h += '<button class="tile" data-act="go-report"><span class="ic">📋</span><span><b>주일보고 작성</b><span>출석·계획·수입 연계</span></span></button>';
  if (can('notice.write')) h += '<button class="tile" data-act="new-notice"><span class="ic">📌</span><span><b>알림장 쓰기</b><span>학부모에게 전달</span></span></button>';
  if (base === 'parent') h += '<button class="tile" data-act="nav" data-screen="notice"><span class="ic">📌</span><span><b>알림장 확인</b><span>' + myNotices.filter(n => !(n.reads || {})[S.me.uid]).length + '개 미확인</span></span></button>';
  h += '<button class="tile" data-act="nav" data-screen="schedule"><span class="ic">🗓️</span><span><b>부서 일정</b><span>' + evs.length + '개 예정</span></span></button>';
  h += '</div>';

  // 최근 알림장
  h += '<div class="sect-title">최근 알림장</div>';
  if (!myNotices.length) h += '<div class="card">' + emptyBox('📭', '아직 알림장이 없습니다') + '</div>';
  else {
    h += '<div class="list">' + myNotices.map(n => {
      const d = deptById(n.deptId);
      const read = (n.reads || {})[S.me.uid];
      return '<button class="item" data-act="open-notice" data-id="' + esc(n.id) + '"><span class="av" style="background:' + esc((d || {}).color || '#ffb4a2') + '33">📌</span><span class="tx"><b>' + esc(n.title) + '</b><span>' + esc((d || {}).name || '') + ' · ' + timeAgo(n.at) + '</span></span><span class="rt">' + (read ? '<span class="chip mint">확인</span>' : n.author === S.me.uid ? '<span class="chip gray">내가 씀</span>' : '<span class="chip coral">새 알림</span>') + '</span></button>';
    }).join('') + '</div>';
  }

  if (evs.length) {
    h += '<div class="sect-title">다가오는 일정</div><div class="list">';
    evs.forEach(e => { h += '<div class="item"><span class="av">🗓️</span><span class="tx"><b>' + esc(e.title) + '</b><span>' + esc(fmtDate(e.date)) + (e.time ? ' ' + esc(e.time) : '') + (e.place ? ' · ' + esc(e.place) : '') + '</span></span></div>'; });
    h += '</div>';
  }
  return h;
}

/* ---------------- 출석 통계 도우미 ---------------- */
function attOf(date, studentId) {
  return (S.state.attendance || []).find(a => !a._del && a.date === date && a.studentId === studentId) || null;
}
function attOfStaff(date, uid) {
  return (S.state.attendance || []).find(a => !a._del && a.date === date && a.staff === uid) || null;
}
function deptCounts(deptId, date) {
  const studs = studentsOfDept(deptId);
  let present = 0, absent = 0, excused = 0, none = 0;
  studs.forEach(s => {
    const a = attOf(date, s.id);
    if (!a) none++;
    else if (a.status === 'present') present++;
    else if (a.status === 'absent') absent++;
    else if (a.status === 'excused') excused++;
    else none++;
  });
  const staff = staffOfDept(deptId);
  const staffPresent = staff.filter(p => { const a = attOfStaff(date, p.uid); return a && a.status === 'present'; }).length;
  return { enrolled: studs.length, present: present, absent: absent, excused: excused, none: none, staffTotal: staff.length, staffPresent: staffPresent };
}
function monthStats(studentId, ym) {
  const rows = (S.state.attendance || []).filter(a => !a._del && a.studentId === studentId && String(a.date).slice(0, 7) === ym);
  const present = rows.filter(a => a.status === 'present').length;
  const absent = rows.filter(a => a.status === 'absent').length;
  const excused = rows.filter(a => a.status === 'excused').length;
  const total = rows.length;
  return { present: present, absent: absent, excused: excused, total: total, rate: total ? Math.round(((present + excused) / total) * 100) : 0 };
}
function staffOfDept(deptId) {
  const out = [];
  Object.keys(S.state.people || {}).forEach(uid => {
    const p = S.state.people[uid];
    if (!p) return;
    const roles = p.roles || [];
    const isTeacher = roles.some(r => ['teacher', 'edu', 'admin'].indexOf(roleDef(r).base) >= 0);
    if (!isTeacher) return;
    const inDept = (p.depts || []).indexOf(deptId) >= 0;
    if (inDept) out.push({ uid: uid, name: p.name });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function setAtt(date, deptId, classId, studentId, status) {
  let rec = (S.state.attendance || []).find(a => !a._del && a.date === date && a.studentId === studentId);
  if (!rec) {
    rec = { id: 'at-' + Crypto.uid(), date: date, year: yearOfDate(date) || curYear(), deptId: deptId, classId: classId, studentId: studentId, status: status, by: S.me.uid, at: Date.now(), u: 0 };
    S.state.attendance.push(rec);
  }
  if (rec.status === status && !rec._del) { /* 그대로 */ }
  rec.status = status; rec._del = false; rec.by = S.me.uid; rec.at = Date.now();
  if (status !== 'absent') rec.reason = '';
  touch(rec);
  Sync.save();
}
function setStaffAtt(date, deptId, uid, status) {
  let rec = (S.state.attendance || []).find(a => !a._del && a.date === date && a.staff === uid);
  if (!rec) {
    rec = { id: 'at-' + Crypto.uid(), date: date, year: yearOfDate(date) || curYear(), deptId: deptId, staff: uid, status: status, by: S.me.uid, at: Date.now(), u: 0 };
    S.state.attendance.push(rec);
  }
  rec.status = status; rec._del = false; rec.by = S.me.uid; rec.at = Date.now(); touch(rec);
  Sync.save();
}

/* ---------------- 출석 화면 ---------------- */
function canSeeAllDepts() { return scopeDeptIds() === 'all'; }
function attMsgText(s, status, reason) {
  if (status === 'absent') return s.name + ' 학생이 오늘 결석하여 안부 여쭙습니다.' + (reason ? ' (사유: ' + reason + ')' : '');
  return '오늘 ' + s.name + ' 학생 출석했습니다.';
}
function attMsgButton(s) {
  return '<button class="msg-btn" data-act="msg-student" data-sid="' + esc(s.id) + '" title="보호자에게 문자·카톡">💬</button>';
}

function attendanceView() {
  const base = roleDef(S.roleKey).base;
  if (base === 'parent') return parentAttendanceView();
  let h = '';
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다', '관리자에게 부서 지정을 요청하세요') + '</div>';
  const allMode = V.dept === '' && canSeeAllDepts();
  if (!allMode && (!V.dept || !depts.some(d => d.id === V.dept))) V.dept = depts[0].id;
  const dept = allMode ? null : deptById(V.dept);
  if (!allMode && !dept) return '<div class="card">' + emptyBox('🏫', '부서를 찾지 못했습니다', '부서를 다시 지정해 주세요') + '</div>';

  h += '<div class="page-head"><div><h2>출석 체크</h2><p>주일 출석을 누르면 바로 저장됩니다</p></div></div>';
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="daybar"><button class="icon-btn" data-act="date-move" data-v="-7">‹</button><input type="date" id="attDate" value="' + esc(V.date) + '" data-change="att-date"><button class="icon-btn" data-act="date-move" data-v="7">›</button></div>';
  h += '<div class="row wrap" style="gap:6px">';
  if (canSeeAllDepts()) h += '<button class="chip big ' + (allMode ? 'coral' : 'gray') + '" data-act="pick-dept" data-id="">🏫 전체 부서</button>';
  h += depts.map(d => '<button class="chip big ' + (d.id === V.dept ? 'coral' : 'gray') + '" data-act="pick-dept" data-id="' + esc(d.id) + '">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</button>').join('');
  h += '</div>';
  h += '<div class="row" style="margin-top:10px;gap:8px">';
  h += '<button class="chip big ' + (V.autoMsg ? 'mint' : 'gray') + '" data-act="toggle-auto-msg">' + (V.autoMsg ? '🔔 출결 문자/카톡 바로 열기 · 켜짐' : '🔕 출결 문자/카톡 바로 열기 · 꺼짐') + '</button>';
  h += '<span class="muted" style="font-size:11px;flex:1">켜 두면 출/결을 누를 때 보호자 문자·카톡 창이 미리 채워져 열립니다.</span>';
  h += '</div>';
  h += '</div>';

  if (!allMode) {
    const cls = classesOfDept(dept.id);
    if (cls.length) {
      h += '<div class="row wrap" style="gap:6px;margin-bottom:10px"><button class="chip big ' + (!V.cls ? 'coral' : 'gray') + '" data-act="pick-cls" data-id="">전체</button>' +
        cls.map(c => '<button class="chip big ' + (c.id === V.cls ? 'coral' : 'gray') + '" data-act="pick-cls" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>').join('') + '</div>';
    }

    const studs = (V.cls ? studentsOfClass(V.cls) : studentsOfDept(dept.id));
    const c = deptCounts(dept.id, V.date);
    h += '<div class="stat-grid" style="margin-bottom:12px">';
    h += '<div class="stat enroll"><b>' + c.enrolled + '</b><span>재적</span></div>';
    h += '<div class="stat present"><b>' + c.present + '</b><span>출석</span></div>';
    h += '<div class="stat absent"><b>' + c.absent + '</b><span>결석</span></div>';
    h += '<div class="stat new"><b>' + c.none + '</b><span>미체크</span></div>';
    h += '</div>';

    h += '<div class="card"><h3>학생 <span class="sp"></span><small>' + esc(fmtDate(V.date)) + '</small></h3>';
    if (!studs.length) h += emptyBox('👶', '이 부서에 등록된 학생이 없습니다', '반·학생에서 먼저 등록하세요');
    else {
      h += '<div class="row" style="margin-bottom:6px"><button class="btn sm" data-act="mark-all" data-v="present">모두 출석</button><button class="btn sm ghost" data-act="mark-all" data-v="none">전체 해제</button></div>';
      studs.forEach(s => {
        const a = attOf(V.date, s.id);
        const st = a ? a.status : '';
        const isNew = !!(a && a.isNew) || !!s.newcomer;
        h += '<div class="stud-row"><span class="nm"><b>' + esc(s.name) + '</b><span>' + esc((classById(s.classId) || {}).name || '반 미지정') + (s.birth ? ' · ' + esc(birthShort(s.birth)) : '') + (s.guardianName ? ' · ' + esc(s.guardianName) : '') + '</span>';
        if (st === 'absent') {
          h += '<button class="reason-line" data-act="att-reason" data-sid="' + esc(s.id) + '">' + (a && a.reason ? '결석 사유: ' + esc(a.reason) : '＋ 결석 사유 적기') + '</button>';
        }
        if (can('attendance.check')) h += '<button class="new-line' + (isNew ? ' on' : '') + '" data-act="att-new" data-sid="' + esc(s.id) + '">' + (isNew ? '★ 신입' : '☆ 신입') + '</button>';
        h += '</span>';
        h += '<span class="people-toggle">';
        h += '<button class="present ' + (st === 'present' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="present" title="출석">출</button>';
        h += '<button class="absent ' + (st === 'absent' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="absent" title="결석">결</button>';
        h += '<button class="excused ' + (st === 'excused' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="excused" title="인정">인</button>';
        h += '</span>' + attMsgButton(s) + '</div>';
      });
    }
    h += '</div>';

    const staff = staffOfDept(dept.id);
    if (staff.length) {
      h += '<div class="card"><h3>교사 출석 <span class="sp"></span><small>' + staff.filter(p => { const a = attOfStaff(V.date, p.uid); return a && a.status === 'present'; }).length + '/' + staff.length + '</small></h3>';
      staff.forEach(p => {
        const a = attOfStaff(V.date, p.uid);
        const st = a ? a.status : '';
        h += '<div class="stud-row"><span class="nm"><b>' + esc(p.name) + '</b><span>교사</span></span><span class="people-toggle">';
        h += '<button class="present ' + (st === 'present' ? 'on' : '') + '" data-act="att-staff" data-uid="' + esc(p.uid) + '" data-v="present">출</button>';
        h += '<button class="absent ' + (st === 'absent' ? 'on' : '') + '" data-act="att-staff" data-uid="' + esc(p.uid) + '" data-v="absent">결</button>';
        h += '</span></div>';
      });
      h += '</div>';
    }

    if (can('report.write')) {
      h += '<button class="btn primary block" data-act="open-report-new" data-dept="' + esc(dept.id) + '" data-date="' + esc(V.date) + '">📋 이 출석으로 주일보고 작성</button>';
    }
    return h;
  }

  /* 전체 부서 통합 보기 (목회자·관리자) */
  const tot = { enrolled: 0, present: 0, absent: 0, excused: 0, none: 0 };
  depts.forEach(d => { const c = deptCounts(d.id, V.date); tot.enrolled += c.enrolled; tot.present += c.present; tot.absent += c.absent; tot.excused += c.excused; tot.none += c.none; });
  h += '<div class="stat-grid" style="margin-bottom:12px">';
  h += '<div class="stat enroll"><b>' + tot.enrolled + '</b><span>전체 재적</span></div>';
  h += '<div class="stat present"><b>' + tot.present + '</b><span>출석</span></div>';
  h += '<div class="stat absent"><b>' + tot.absent + '</b><span>결석</span></div>';
  h += '<div class="stat new"><b>' + tot.excused + '</b><span>인정</span></div>';
  h += '</div>';
  h += '<button class="btn block" style="margin-bottom:10px" data-act="nav" data-screen="stats">📊 부서별 비교·연간 통합 출결표 보기</button>';
  depts.forEach(d => {
    const c = deptCounts(d.id, V.date);
    const studs = studentsOfDept(d.id);
    h += '<div class="card"><h3>' + esc(d.emoji || '') + ' ' + esc(d.name) + '<span class="sp"></span><small>재적 ' + c.enrolled + ' · 출석 ' + c.present + ' · 결석 ' + c.absent + (c.none ? ' · 미체크 ' + c.none : '') + '</small></h3>';
    if (!studs.length) h += '<p class="muted" style="margin:0">등록된 학생이 없습니다.</p>';
    else {
      h += '<div class="list">';
      studs.forEach(s => {
        const a = attOf(V.date, s.id);
        const st = a ? a.status : '';
        h += '<div class="stud-row"><span class="nm"><b>' + esc(s.name) + '</b><span>' + esc((classById(s.classId) || {}).name || '반 미지정') + (s.birth ? ' · ' + esc(birthShort(s.birth)) : '') + '</span></span>';
        if (can('attendance.check')) {
          h += '<span class="people-toggle">';
          h += '<button class="present ' + (st === 'present' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="present">출</button>';
          h += '<button class="absent ' + (st === 'absent' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="absent">결</button>';
          h += '<button class="excused ' + (st === 'excused' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="excused">인</button>';
          h += '</span>';
        } else {
          h += '<span class="attend-badge ' + (st || 'none') + '">' + (st === 'present' ? '출' : st === 'absent' ? '결' : st === 'excused' ? '인' : '-') + '</span>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
  });
  return h;
}

function birthShort(b) {
  const s = String(b);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(2, 4) + '.' + s.slice(5, 7) + '.' + s.slice(8);
  return s;
}

function parentAttendanceView() {
  let h = '<div class="page-head"><div><h2>자녀 출석</h2><p>우리 아이 출석 기록입니다</p></div></div>';
  const kids = myStudents();
  if (!kids.length) return h + '<div class="card">' + emptyBox('👨‍👩‍👧', '연결된 자녀가 없습니다', '부서 담당 교사에게 요청해 주세요') + '</div>';
  kids.forEach(k => {
    const rows = (S.state.attendance || []).filter(a => !a._del && a.studentId === k.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    const st = monthStats(k.id, String(V.date || ymd()).slice(0, 7));
    h += '<div class="card"><h3>' + esc(k.name) + ' <small>' + esc((deptById(k.deptId) || {}).name || '') + ' · ' + esc((classById(k.classId) || {}).name || '') + '</small><span class="sp"></span><span class="chip mint">이번 달 ' + st.rate + '%</span></h3>';
    if (!rows.length) h += '<p class="muted" style="margin:0">아직 출석 기록이 없습니다.</p>';
    else {
      h += '<div class="list">';
      rows.forEach(a => {
        h += '<div class="item" style="padding:9px 11px"><span class="attend-badge ' + esc(a.status) + '">' + (a.status === 'present' ? '출' : a.status === 'absent' ? '결' : '인') + '</span><span class="tx"><b>' + esc(fmtDate(a.date)) + '</b><span>' + attLabel(a.status) + '</span></span></div>';
      });
      h += '</div>';
    }
    h += '</div>';
  });
  return h;
}

/* ---------------- 주일보고 ---------------- */
function reportOf(deptId, date) {
  return (S.state.reports || []).find(r => !r._del && r.deptId === deptId && r.date === date) || null;
}

function reportView() {
  if (roleDef(S.roleKey).base === 'pastor') return pastorHubView();
  if (can('report.write') && can('report.review')) return reportBothView();
  if (can('report.review')) return pastorInboxView();
  return reportWriteView();
}

/* 목회자 주일보고 허브 — 수신함 / 통합 출결·통계 / 연간 출결부 */
function pastorHubView() {
  if (canSeeAllDepts()) V.statDept = '';
  const tab = V.pastorTab || 'inbox';
  let h = subHead('주일보고', '부서별 보고 확인과 전 부서 출결·통계를 한곳에서',
    '<button class="btn sm" data-act="force-pull">↻ 새로고침</button>');
  h += '<div class="row wrap" style="gap:6px;margin-bottom:12px">';
  h += '<button class="chip big ' + (tab === 'inbox' ? 'coral' : 'gray') + '" data-act="pastor-tab" data-v="inbox">📋 주일보고 수신함</button>';
  h += '<button class="chip big ' + (tab === 'stats' ? 'coral' : 'gray') + '" data-act="pastor-tab" data-v="stats">📊 통합 출결·통계</button>';
  h += '<button class="chip big ' + (tab === 'annual' ? 'coral' : 'gray') + '" data-act="pastor-tab" data-v="annual">📅 연간 출결부</button>';
  h += '</div>';
  if (tab === 'stats') {
    const per = V.statPeriod || 'month';
    h += '<div class="card flat" style="padding:12px">';
    h += '<div class="row wrap" style="gap:6px;margin-bottom:9px">';
    [['week', '주간'], ['month', '월간'], ['quarter', '분기'], ['half', '반기'], ['year', '연간']].forEach(x => {
      h += '<button class="chip big ' + (per === x[0] ? 'coral' : 'gray') + '" data-act="stat-period" data-v="' + x[0] + '">' + x[1] + '</button>';
    });
    h += '<span class="sp" style="flex:1"></span><button class="btn sm" data-act="period-print">🖨️ 인쇄</button></div>';
    h += periodNavBar(per);
    h += '</div>';
    h += periodStatsHtml(per, visibleDepts());
    return h;
  }
  if (tab === 'annual') {
    h += yearBar();
    h += '<div class="row" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-act="annual-print">🖨 인쇄</button><button class="btn sm" data-act="annual-csv">⬇ CSV 내려받기</button></div>';
    h += annualSheetHtml({ year: statYear(), deptIds: visibleDepts().map(d => d.id), showDept: true });
    return h;
  }
  return h + pastorInboxView(true);
}

function reportBothView() {
  return '<div class="row" style="margin-bottom:10px"><button class="btn sm dark" data-act="report-mode" data-v="write">작성</button><button class="btn sm" data-act="report-mode" data-v="inbox">수신함</button></div>' + (V.reportMode === 'inbox' ? pastorInboxView() : reportWriteView());
}

function reportWriteView() {
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  if (!V.dept || !depts.some(d => d.id === V.dept)) V.dept = depts[0].id;
  const date = V.reportDate || V.date;
  const dept = deptById(V.dept);
  let rep = reportOf(dept.id, date);
  let h = '<div class="page-head"><div><h2>주일보고</h2><p>출석·결석자·신입은 자동으로 채워집니다</p></div></div>';

  h += '<div class="card flat" style="padding:12px"><div class="daybar"><button class="icon-btn" data-act="report-date-move" data-v="-7">‹</button><input type="date" id="repDate" value="' + esc(date) + '" data-change="report-date"><button class="icon-btn" data-act="report-date-move" data-v="7">›</button></div>';
  h += '<div class="row wrap" style="gap:6px">' + depts.map(d => '<button class="chip big ' + (d.id === dept.id ? 'coral' : 'gray') + '" data-act="pick-report-dept" data-id="' + esc(d.id) + '">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</button>').join('') + '</div></div>';

  if (!rep) {
    h += '<div class="banner sky">이 주일 ' + esc(dept.name) + ' 보고서가 아직 없습니다. 아래에서 새로 작성하세요.</div>';
    h += '<button class="btn primary block" data-act="create-report">＋ ' + esc(fmtShort(date)) + ' 주일보고 작성</button>';
    const c = deptCounts(dept.id, date);
    h += '<div class="stat-grid" style="margin-top:12px"><div class="stat enroll"><b>' + c.enrolled + '</b><span>재적</span></div><div class="stat present"><b>' + c.present + '</b><span>출석</span></div><div class="stat absent"><b>' + c.absent + '</b><span>결석</span></div><div class="stat new"><b>' + newcomerRowsOf(dept.id, date).length + '</b><span>신입</span></div></div>';
    return h;
  }

  const c = deptCounts(dept.id, date);
  const cn = rep.counts || {};
  const absentRows = absentRowsOf(dept.id, date);
  const newRows = newcomerRowsOf(dept.id, date);
  const locked = rep.status === 'submitted' || rep.status === 'checked';
  h += '<div class="card"><h3>' + esc(dept.emoji || '') + ' ' + esc(dept.name) + ' · ' + esc(fmtShort(date)) + '<span class="sp"></span>' + statusChip(rep.status) + '</h3>';
  if (rep.status === 'checked') {
    h += '<div class="banner mint">✅ 목회자 확인 완료 · ' + esc(rep.checkedByName || '목회자') + (rep.comment ? '<br>“' + esc(rep.comment) + '”' : '') + '</div>';
  }
  if (rep.status === 'rejected') {
    h += '<div class="banner coral">↩ 목회자가 반려했습니다' + (rep.rejectedByName ? ' · ' + esc(rep.rejectedByName) : '') + (rep.rejectReason ? '<br>사유: ' + esc(rep.rejectReason) : '') + '<br>내용을 고쳐 다시 제출해 주세요.</div>';
  }
  if (reopenPending(rep)) {
    h += '<div class="banner sky">📩 반려 요청을 보냈습니다 · ' + timeAgo(rep.reopen.at) + (rep.reopen.reason ? '<br>사유: ' + esc(rep.reopen.reason) : '') + '<br>목회자가 반려하면 다시 고쳐 쓸 수 있습니다.</div>';
  }
  h += '<div class="stat-grid"><div class="stat enroll"><b>' + c.enrolled + '</b><span>재적</span></div><div class="stat present"><b>' + c.present + '</b><span>출석</span></div><div class="stat absent"><b>' + c.absent + '</b><span>결석</span></div><div class="stat new"><b>' + newRows.length + '</b><span>신입</span></div></div>';
  h += '<p class="muted" style="margin:8px 0 0">교사 출석 ' + c.staffPresent + '/' + c.staffTotal + (c.excused ? ' · 인정 ' + c.excused : '') + ' · 저장 시 자동 반영</p></div>';

  const ro = rep.status === 'checked' ? ' readonly' : '';
  const weekPlan = plansOfWeek(dept.id, date);
  const weekMoney = ledgerOfWeek(dept.id, date);
  const weekIncome = incomeTotal(weekMoney);
  const planLesson = (weekPlan.find(p => p.kind === '공과') || {}).title || '';
  if (weekPlan.length) {
    h += '<div class="card flat" style="border:1.5px solid #ded3f7;background:#faf8ff"><h3>🗓️ 이 주 월별계획 연계<span class="sp"></span><small>' + esc(fmtShort(date)) + ' 주일이 속한 주</small></h3><div class="list">';
    weekPlan.forEach(p => {
      h += '<div class="item" style="padding:9px 11px;box-shadow:none"><span class="av" style="background:#efe9fd">' + esc(p.date ? fmtShort(p.date) : p.week + '주') + '</span><span class="tx"><b>' + esc(p.title) + '</b><span>' + esc(p.kind || '계획') + (p.detail ? ' · ' + esc(p.detail) : '') + '</span></span></div>';
    });
    h += '</div>';
    if (planLesson && !rep.lesson && rep.status !== 'checked') h += '<button class="btn sm mint block" style="margin-top:8px" data-act="rep-apply-lesson"  data-id="' + esc(rep.id) + '">공과 「' + esc(planLesson) + '」 반영</button>';
    h += '</div>';
  }
  h += '<div class="card flat" style="border:1.5px solid #cdeada;background:#f7fdfa"><h3>💰 이 주 수입 연계<span class="sp"></span><small>지출은 포함되지 않습니다</small></h3>';
  if (!weekMoney.filter(e => e.type === 'in').length) h += '<p class="muted" style="margin:0">이 주에 등록된 수입이 없습니다. 회계 → 수입 기록에서 입력하세요.</p>';
  else {
    h += '<div class="list">';
    weekMoney.filter(e => e.type === 'in').forEach(e => {
      h += '<div class="item" style="padding:9px 11px;box-shadow:none"><span class="av" style="background:#e7f7ee">＋</span><span class="tx"><b>' + esc(e.category || '수입') + '</b><span>' + esc(fmtShort(e.date)) + (e.memo ? ' · ' + esc(e.memo) : '') + '</span></span><span class="rt"><b>' + money(e.amount) + '원</b></span></div>';
    });
    h += '</div><div class="kv"><span>수입 합계</span><b>' + money(weekIncome) + '원</b></div>';
    if (rep.status !== 'checked') h += '<button class="btn sm mint block" style="margin-top:8px" data-act="rep-apply-income" data-id="' + esc(rep.id) + '">수입 ' + money(weekIncome) + '원을 헌금란에 반영</button>';
  }
  h += '</div>';

  h += '<div class="card"><h3>📝 결석자·신입 자동 기입<span class="sp"></span><small>출석 화면 기준</small></h3>';
  if (!absentRows.length && !newRows.length) h += '<p class="muted" style="margin:0">이 주일 결석자·신입이 없습니다.</p>';
  if (absentRows.length) {
    h += '<div class="sect-title" style="margin:2px 0 6px">결석 ' + absentRows.length + '명</div><div class="list">';
    absentRows.forEach(r => {
      h += '<div class="item" style="padding:9px 11px;box-shadow:none"><span class="attend-badge absent">결</span><span class="tx"><b>' + esc(r.name) + '</b><span>' + esc(r.cls) + ' · ' + esc(r.reason || '사유 없음') + '</span></span></div>';
    });
    h += '</div>';
  }
  if (newRows.length) {
    h += '<div class="sect-title" style="margin:10px 0 6px">신입 ' + newRows.length + '명</div><div class="list">';
    newRows.forEach(r => {
      h += '<div class="item" style="padding:9px 11px;box-shadow:none"><span class="av" style="background:#fdf3dd">★</span><span class="tx"><b>' + esc(r.name) + '</b><span>' + esc(r.cls) + (r.phone ? ' · ' + esc(r.phone) : '') + '</span></span></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  h += '<div class="card">';
  h += '<div class="field"><label>예배 말씀</label><input id="rpScripture" value="' + esc(rep.scripture || '') + '" placeholder="예: 창세기 1:1 / 만물을 창조하신 하나님"' + ro + '></div>';
  h += '<div class="field"><label>공과 내용</label><input id="rpLesson" value="' + esc(rep.lesson || planLesson) + '" placeholder="예: 3과 하나님이 만드신 세상"' + ro + '></div>';
  h += '<div class="grid3"><div class="field"><label>신입(자동)</label><input id="rpNew" type="number" min="0" value="' + newRows.length + '" readonly></div>';
  h += '<div class="field"><label>헌금(원)</label><input id="rpOffering" type="text" inputmode="numeric" value="' + esc(rep.offering || (weekIncome ? String(weekIncome) : '')) + '" placeholder="0"' + ro + '><div class="hint">' + (weekIncome ? '이 주 회계 수입 ' + money(weekIncome) + '원이 자동으로 채워졌습니다.' : '') + '</div></div>';
  h += '<div class="field"><label>출석 인원(자동)</label><input value="' + c.present + '" readonly></div></div>';
  h += '<div class="field"><label>특이사항</label><textarea id="rpNotes" placeholder="결석 사유, 새로 나온 친구, 전달 사항"' + ro + '>' + esc(rep.notes || '') + '</textarea></div>';
  h += '<div class="field"><label>기도제목</label><textarea id="rpPrayer" placeholder="부서 기도제목"' + ro + '>' + esc(rep.prayer || '') + '</textarea></div>';
  if (rep.status !== 'checked') {
    h += '<div class="row wrap" style="gap:8px"><button class="btn" data-act="save-report" data-id="' + esc(rep.id) + '">저장</button><button class="btn" data-act="print-report" data-id="' + esc(rep.id) + '">🖨️ 인쇄</button><span class="sp"></span>';
    if (locked) h += '<button class="btn primary" disabled title="이미 제출한 보고서입니다">🔒 제출 완료됨</button>';
    else h += '<button class="btn primary" data-act="submit-report" data-id="' + esc(rep.id) + '">목회자에게 제출</button>';
    h += '</div>';
    if (locked) h += '<p class="hint" style="margin-top:6px">제출한 보고서는 다시 제출할 수 없습니다. 고칠 일이 있으면 아래에서 반려를 요청하세요.</p>';
  } else {
    h += '<div class="row wrap" style="gap:8px"><button class="btn" data-act="print-report" data-id="' + esc(rep.id) + '">🖨️ 인쇄</button><span class="sp"></span><button class="btn primary" disabled>🔒 확인 완료됨</button></div>';
  }
  h += '</div>';

  if ((locked || rep.status === 'rejected') && rep.status !== 'checked') {
    h += '<div class="card flat" style="border:1.5px solid #cfe4f7;background:#f7fbff"><h3>📩 반려 요청</h3>';
    if (reopenPending(rep)) {
      h += '<p class="muted" style="margin:0">' + timeAgo(rep.reopen.at) + '에 요청했습니다. 목회자 확인을 기다리고 있습니다.</p>';
      h += '<button class="btn sm block" style="margin-top:8px" data-act="reopen-report" data-id="' + esc(rep.id) + '">요청 사유 바꾸기</button>';
    } else {
      h += '<p class="muted" style="margin:0 0 8px">제출한 보고서를 고쳐 써야 할 때 목회자에게 반려를 요청합니다.</p>';
      h += '<button class="btn block" data-act="reopen-report" data-id="' + esc(rep.id) + '">📩 목회자에게 반려 요청</button>';
    }
    h += '</div>';
  }
  h += '<p class="muted" style="text-align:center">작성 ' + esc(rep.authorName || '') + ' · ' + timeAgo(rep.u || rep.at) + (rep.submittedAt ? ' · 제출 ' + timeAgo(rep.submittedAt) : '') + '</p>';
  return h;
}

/* 자동 기입용 — 결석자·신입 */
function absentRowsOf(deptId, date) {
  const out = [];
  studentsOfDept(deptId).forEach(s => {
    const a = attOf(date, s.id);
    if (a && a.status === 'absent') out.push({ name: s.name, cls: (classById(s.classId) || {}).name || '반 미지정', reason: a.reason || '' });
  });
  return out;
}
function newcomerRowsOf(deptId, date) {
  const out = [];
  const from = ymd(new Date(parseYmd(date).getTime() - 56 * 86400000));
  studentsOfDept(deptId).forEach(s => {
    const a = attOf(date, s.id);
    const attended = a && (a.status === 'present' || a.status === 'excused');
    if (!attended) return;
    const marked = !!a.isNew || (s.newcomer && s.joined && s.joined <= date && s.joined >= from);
    if (!marked) return;
    out.push({ name: s.name, cls: (classById(s.classId) || {}).name || '반 미지정', phone: s.guardianPhone || '', sid: s.id });
  });
  return out;
}
function reopenPending(rep) { return !!(rep && rep.reopen && !rep.reopen.done && rep.reopen.at); }


function pastorInboxView(bare) {
  const all = (S.state.reports || []).filter(r => !r._del && inYear(r)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.deptId).localeCompare(String(b.deptId)));
  const st = V.inboxFilter || 'all';
  const list = all.filter(r => st === 'all' ? true : st === 'reopen' ? reopenPending(r) : r.status === st);
  let h = bare ? '' : '<div class="page-head"><div><h2>주일보고 수신함</h2><p>부서별 제출 현황을 한눈에 봅니다</p></div></div>';
  const sub = all.filter(r => r.status === 'submitted').length;
  const reopens = all.filter(r => reopenPending(r)).length;
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">';
  h += '<button class="chip big ' + (st === 'all' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="all">전체 ' + all.length + '</button>';
  h += '<button class="chip big ' + (st === 'submitted' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="submitted">확인 대기 ' + sub + '</button>';
  h += '<button class="chip big ' + (st === 'checked' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="checked">확인 완료</button>';
  h += '<button class="chip big ' + (st === 'rejected' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="rejected">반려</button>';
  if (reopens) h += '<button class="chip big ' + (st === 'reopen' ? 'rose' : 'rose') + '" data-act="inbox-filter" data-v="reopen">📩 반려 요청 ' + reopens + '</button>';
  h += '</div>';
  if (!list.length) return h + '<div class="card">' + emptyBox('📭', '해당하는 보고서가 없습니다') + '</div>';
  const byDate = {};
  list.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(d => {
    h += '<div class="sect-title">' + esc(fmtDate(d)) + '</div><div class="list">';
    byDate[d].forEach(r => {
      const dept = deptById(r.deptId) || {};
      const cn = r.counts || {};
      h += '<button class="item" data-act="open-report" data-id="' + esc(r.id) + '"><span class="av" style="background:' + esc(dept.color || '#ffb4a2') + '33">' + esc(dept.emoji || '📄') + '</span>';
      h += '<span class="tx"><b>' + esc(dept.name || '부서') + (reopenPending(r) ? ' <span class="chip rose">📩 반려 요청</span>' : '') + '</b><span>재적 ' + (cn.enrolled || 0) + ' · 출석 ' + (cn.present || 0) + ' · 결석 ' + (cn.absent || 0) + ' · 교사 ' + (cn.teacherPresent || 0) + '/' + (cn.teacherTotal || 0) + (reopenPending(r) && r.reopen.reason ? ' · ' + esc(r.reopen.reason) : '') + '</span></span>';
      h += '<span class="rt">' + statusChip(r.status) + '</span></button>';
    });
    h += '</div>';
  });
  return h;
}

/* ---------------- 알림장 ---------------- */
function noticeView() {
  const list = noticesForMe();
  let h = '<div class="page-head"><div><h2>알림장</h2><p>부서 소식을 확인하고 ‘확인’을 눌러 주세요</p></div><span class="sp"></span>' + (can('notice.write') ? '<button class="btn primary sm" data-act="new-notice">＋ 쓰기</button>' : '') + '</div>';
  if (!list.length) return h + '<div class="card">' + emptyBox('📭', '아직 알림장이 없습니다') + '</div>';
  h += '<div class="list">';
  list.forEach(n => {
    const d = deptById(n.deptId) || {};
    const readers = Object.keys(n.reads || {}).length;
    const mine = (n.reads || {})[S.me.uid];
    const isAuthor = n.author === S.me.uid;
    h += '<button class="item" data-act="open-notice" data-id="' + esc(n.id) + '">';
    h += '<span class="av" style="background:' + esc(d.color || '#ffb4a2') + '33">' + (n.pinned ? '📌' : '📄') + '</span>';
    h += '<span class="tx"><b>' + esc(n.title) + '</b><span>' + esc(d.name || '') + (n.classId ? ' · ' + esc((classById(n.classId) || {}).name || '') : '') + ' · ' + timeAgo(n.at) + (can('notice.write') ? ' · 확인 ' + readers + '명' : '') + '</span></span>';
    h += '<span class="rt">' + (mine ? '<span class="chip mint">확인</span>' : isAuthor ? '<span class="chip gray">내가 씀</span>' : '<span class="chip coral">새 알림</span>') + '</span></button>';
  });
  h += '</div>';
  return h;
}

/* ---------------- 피드 ---------------- */
function feedView() {
  const depts = visibleDepts().map(d => d.id);
  const list = (S.state.feeds || []).filter(f => !f._del && depts.indexOf(f.deptId) >= 0).sort((a, b) => (b.at || 0) - (a.at || 0));
  let h = '<div class="page-head"><div><h2>부서 피드</h2><p>부서의 소소한 소식을 나눠요</p></div><span class="sp"></span>' + (can('feed.write') ? '<button class="btn primary sm" data-act="new-feed">＋ 글쓰기</button>' : '') + '</div>';
  if (!list.length) return h + '<div class="card">' + emptyBox('💬', '아직 올라온 소식이 없습니다') + '</div>';
  list.forEach(f => {
    const d = deptById(f.deptId) || {};
    h += '<div class="card"><h3>' + esc(d.emoji || '') + ' ' + esc(d.name || '') + '<span class="sp"></span><small>' + timeAgo(f.at) + '</small></h3>';
    h += '<div style="font-size:14.5px;font-weight:800;margin-bottom:6px">' + esc(f.title) + '</div>';
    h += '<div class="pre">' + esc(f.body) + '</div>';
    h += '<div class="muted" style="margin-top:8px">' + esc(f.authorName || '') + (can('feed.write') ? ' · <button data-act="del-feed" data-id="' + esc(f.id) + '" style="color:#c33e5f;font-weight:700">삭제</button>' : '') + '</div></div>';
  });
  return h;
}

/* ---------------- 반·학생 ---------------- */
function membersView() {
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  if (!V.dept || !depts.some(d => d.id === V.dept)) V.dept = depts[0].id;
  const dept = deptById(V.dept);
  const cls = classesOfDept(dept.id);
  let h = '<div class="page-head"><div><h2>반·학생</h2><p>반과 학생, 보호자 정보를 관리합니다</p></div></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">' + depts.map(d => '<button class="chip big ' + (d.id === dept.id ? 'coral' : 'gray') + '" data-act="pick-dept" data-id="' + esc(d.id) + '">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</button>').join('') + '</div>';

  if (can('child.link')) h += childLinkCard(dept.id);

  if (can('member.manage')) {
    h += '<div class="card flat" style="padding:12px"><h3>📋 아동 명단</h3>';
    h += '<div class="row wrap" style="gap:6px"><button class="btn sm" data-act="roster-template">⬇ 명단 양식 다운로드</button><button class="btn sm" data-act="roster-upload">⬆ 작성한 명단 올리기</button></div>';
    h += '<p class="hint" style="margin:8px 0 0">양식: 반명 · 이름 · 생년월일 · 성별 · 보호자 · 연락처 · 메모. 엑셀은 .xlsx 로 저장해 올리는 것을 권합니다(한글 엑셀 CSV는 글자가 깨질 수 있음). 올리면 생일이 부서 일정에 자동으로 들어갑니다.</p></div>';
  }

  h += '<button class="btn block" data-act="new-class" data-dept="' + esc(dept.id) + '">＋ ' + esc(dept.name) + ' 반 추가</button>';

  const unassigned = studentsOfDept(dept.id).filter(s => !s.classId || !cls.some(c => c.id === s.classId));
  cls.forEach(c => {
    const studs = studentsOfClass(c.id);
    const teachers = (c.teacherNames || []).join(', ');
    h += '<div class="card" style="margin-top:12px"><h3>' + esc(c.name) + ' <small>' + studs.length + '명' + (teachers ? ' · ' + esc(teachers) : '') + '</small><span class="sp"></span><button class="btn sm" data-act="edit-class" data-id="' + esc(c.id) + '">반 수정</button></h3>';
    h += '<div class="list">';
    if (!studs.length) h += '<p class="muted" style="margin:0">학생이 없습니다.</p>';
    studs.forEach(s => {
      const pr = promoOf(s, curYear());
      const gradeTxt = pr.age ? esc(pr.label) : '';
      const moveTxt = (pr.deptId && pr.deptId !== s.deptId && pr.deptId !== 'graduate') ? ' · <span class="chip amber" style="margin-left:4px">' + esc(pr.deptName) + ' 진급</span>' : (pr.deptId === 'graduate' ? ' · <span class="chip gray" style="margin-left:4px">졸업</span>' : '');
      h += '<button class="item" data-act="edit-student" data-id="' + esc(s.id) + '"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + (gradeTxt ? ' <span class="chip sky">' + gradeTxt + '</span>' : '') + (s.guardianUid ? ' <span class="chip mint">학부모 연결</span>' : (s.guardianName ? ' <span class="chip amber">연결 필요</span>' : '')) + '</b><span>' + (s.birth ? esc(birthShort(s.birth)) + ' · ' : '') + esc(s.guardianName || '보호자 미등록') + (s.guardianPhone ? ' · ' + esc(s.guardianPhone) : '') + moveTxt + '</span></span><span class="rt"><span class="chip gray">' + esc(s.gender === 'm' ? '남' : s.gender === 'f' ? '여' : '') + '</span></span></button>';
    });
    h += '</div>';
    h += '<button class="btn block sm" style="margin-top:8px" data-act="new-student" data-cls="' + esc(c.id) + '">＋ 학생 추가</button>';
    h += '</div>';
  });
  if (unassigned.length) {
    h += '<div class="card" style="margin-top:12px"><h3>반 미지정 <small>' + unassigned.length + '명</small><span class="sp"></span><button class="btn sm" data-act="bulk-class" data-dept="' + esc(dept.id) + '">반 일괄 지정</button></h3><div class="list">';
    unassigned.forEach(s => { h += '<button class="item" data-act="edit-student" data-id="' + esc(s.id) + '"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + '</b><span>' + esc(s.guardianName || '보호자 미등록') + (s.guardianPhone ? ' · ' + esc(s.guardianPhone) : '') + ' · 반을 지정해 주세요</span></span></button>'; });
    h += '</div></div>';
  }
  if (!cls.length && !unassigned.length) h += '<div class="card" style="margin-top:12px">' + emptyBox('👥', '반을 먼저 만들어 주세요', '반을 만든 뒤 학생을 추가할 수 있어요') + '</div>';
  return h;
}

/* ---------------- 일정 ---------------- */
function scheduleView() {
  const evs = eventsForMe();
  const up = evs.filter(e => e.date >= ymd());
  const past = evs.filter(e => e.date < ymd()).reverse();
  let h = '<div class="page-head"><div><h2>부서 일정</h2><p>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 일정</p></div><span class="sp"></span>' + (can('schedule.manage') ? '<button class="btn primary sm" data-act="new-event">＋ 일정</button>' : '') + '</div>';
  h += '<p class="muted" style="margin:0 0 10px">🎂 생일과 🗓️ 월별계획표 항목은 자동으로 등록됩니다.</p>';
  if (!evs.length) return h + '<div class="card">' + emptyBox('🗓️', '등록된 일정이 없습니다') + '</div>';
  h += '<div class="sect-title">다가오는 일정</div>';
  if (!up.length) h += '<div class="card"><p class="muted" style="margin:0">예정된 일정이 없습니다.</p></div>';
  else up.forEach(e => {
    const d = deptById(e.deptId) || {};
    h += '<div class="card" style="padding:13px"><div class="row wrap" style="gap:6px"><span class="chip coral big">' + esc(fmtShort(e.date)) + '</span><span class="chip big">' + esc((d.emoji || '') + ' ' + (d.name || '전체')) + '</span>' + (e.auto === 'birth' ? '<span class="chip amber">생일</span>' : e.auto === 'plan' ? '<span class="chip sky">계획표</span>' : '') + '<span class="sp"></span>';
    if (can('schedule.manage') && e.auto !== 'birth') h += '<button class="btn sm" data-act="' + (e.auto === 'plan' ? 'edit-plan" data-id="' + esc(e.srcPlanId) : 'edit-event" data-id="' + esc(e.id)) + '">' + (e.auto === 'plan' ? '계획 수정' : '수정') + '</button>';
    h += '</div>';
    h += '<div style="font-weight:800;font-size:15px;margin:8px 0 2px">' + esc(e.title) + (e.occYear && Number(e.occYear) > new Date().getFullYear() ? ' <span class="muted" style="font-weight:600;font-size:11px">' + e.occYear + '년</span>' : '') + '</div>';
    h += '<div class="muted">' + esc(fmtDate(e.date)) + (e.time ? ' ' + esc(e.time) : '') + (e.place ? ' · ' + esc(e.place) : '') + '</div>';
    if (e.desc) h += '<div class="pre" style="margin-top:6px">' + esc(e.desc) + '</div>';
    h += '</div>';
  });
  if (past.length) {
    h += '<div class="sect-title">지난 일정</div><div class="list">';
    past.slice(0, 8).forEach(e => { h += '<div class="item" style="opacity:.72"><span class="av">' + (e.auto === 'birth' ? '🎂' : '🗓️') + '</span><span class="tx"><b>' + esc(e.title) + '</b><span>' + esc(fmtDate(e.date)) + '</span></span></div>'; });
    h += '</div>';
  }
  return h;
}

/* ---------------- 관리 ---------------- */
function adminView() {
  const tabs = [];
  if (can('user.manage')) tabs.push(['users', '사용자']);
  if (can('dept.manage')) tabs.push(['depts', '부서']);
  if (can('dept.manage')) tabs.push(['roles', '역할']);
  tabs.push(['sync', '동기화']);
  if (!tabs.some(t => t[0] === V.adminTab)) V.adminTab = tabs[0][0];
  let h = '<div class="page-head"><div><h2>관리</h2><p>' + esc(activeRole().label) + ' 전용 화면</p></div></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:12px">' + tabs.map(t => '<button class="chip big ' + (V.adminTab === t[0] ? 'coral' : 'gray') + '" data-act="admin-tab" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  if (V.adminTab === 'users') h += adminUsers();
  else if (V.adminTab === 'depts') h += adminDepts();
  else if (V.adminTab === 'roles') h += adminRoles();
  else h += adminSync();
  return h;
}

function adminUsers() {
  let h = '<div class="row" style="margin-bottom:10px"><button class="btn primary sm" data-act="new-user">＋ 사용자 추가</button><span class="sp"></span><button class="btn sm" data-act="reload-users">↻ 새로고침</button></div>';
  if (V.accountsLoading) return h + '<div class="card"><p class="muted" style="margin:0">계정을 불러오는 중…</p></div>';
  if (V.accountsErr) return h + '<div class="card"><div class="banner coral">' + esc(V.accountsErr) + '</div><button class="btn" data-act="reload-users">다시 시도</button></div>';
  if (!V.accounts) { h += '<div class="card"><p class="muted" style="margin:0">계정을 불러오는 중…</p></div>'; loadAccounts(); return h; }
  if (!V.accounts.length) return h + '<div class="card">' + emptyBox('👤', '등록된 사용자가 없습니다') + '</div>';
  h += '<div class="list">';
  V.accounts.forEach(a => {
    const roles = (a.rec.roles || []).map(r => roleDef(r).label).join(' · ');
    const depts = (a.rec.depts || []).map(d => (deptById(d) || {}).name).filter(Boolean).join(', ');
    const pend = a.status && a.status !== 'active';
    h += '<div class="item"><span class="av">' + esc((a.rec.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(a.rec.name) + (a.rec.active === false ? ' <span class="chip rose">중지</span>' : '') + (a.rec.status && a.rec.status !== 'normal' ? ' ' + accountStatusChip(a.rec) : '') + (pend ? ' <span class="chip amber">' + (a.status === 'rejected' ? '반려' : (a.status === 'approved' ? '승인됨·첫 로그인 전' : '가입 대기')) + '</span>' : '') + '</b><span>' + esc(roles || '역할 없음') + (depts ? ' · ' + esc(depts) : '') + '</span></span><span class="rt">' + (pend ? '<button class="btn sm" data-act="nav" data-screen="approve">승인 화면</button>' : '<button class="btn sm" data-act="edit-user" data-uid="' + esc(a.uid) + '">수정</button>') + '</span></div>';
  });
  h += '</div>';
  h += '<p class="muted" style="margin-top:10px">아이디는 저장되지 않고 해시로만 보관됩니다. 비밀번호는 계정마다 따로 감싼 형태로만 보관됩니다.</p>';
  return h;
}

function adminDepts() {
  const all = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  let h = '<div class="banner sky">교육부서는 <b>유치부 · 초등부 · 청소년부</b> 세 부서로 운영됩니다. (유치부 7세까지 · 초등부 초6까지 · 청소년부 고3까지) 예전 유아부·중등부 자료는 자동으로 유치부·청소년부로 이어 받았습니다.</div>';
  h += '<div class="list">';
  all.forEach(d => {
    const n = studentsOfDept(d.id).length;
    h += '<div class="item"><span class="av" style="background:' + esc(d.color) + '44">' + esc(d.emoji || '📖') + '</span><span class="tx"><b>' + esc(d.name) + '</b><span>학생 ' + n + '명 · 반 ' + classesOfDept(d.id).length + '개</span></span><span class="rt"><span class="chip gray">' + esc(ageRangeOfDept(d.id)) + '</span></span></div>';
  });
  h += '</div>';
  h += '<p class="muted" style="margin-top:10px">학생은 생년월일로 나이·학년이 계산되어 [연도·진급 → 2차 부서 진급]에서 부서가 정해집니다.</p>';
  return h;
}
function ageRangeOfDept(id) {
  const c = canonDeptId(id);
  if (c === 'dept-kids') return '7세까지';
  if (c === 'dept-elem') return '초1~초6';
  if (c === 'dept-teen') return '중1~고3';
  return '';
}

function adminRoles() {
  const roles = (S.state.roles || []).filter(r => !r._del);
  let h = '<div class="row" style="margin-bottom:10px"><button class="btn primary sm" data-act="new-role">＋ 역할 추가</button></div><div class="list">';
  roles.forEach(r => {
    const p = BASE_PERMS[r.base] || {};
    const names = PERM_LABELS.filter(x => p[x[0]]).map(x => x[1]).slice(0, 4).join(', ');
    h += '<div class="item"><span class="av">' + esc(r.emoji || '🙂') + '</span><span class="tx"><b>' + esc(r.label) + '</b><span>' + esc(names || '기본 권한 없음') + '</span></span><span class="rt">' + (['admin', 'pastor', 'edu', 'teacher', 'parent'].indexOf(r.key) >= 0 ? '<span class="chip gray">기본</span>' : '<button class="btn sm" data-act="edit-role" data-id="' + esc(r.key) + '">수정</button>') + '</span></div>';
  });
  h += '</div>';
  h += '<p class="muted" style="margin-top:10px">새 역할은 기존 5가지 화면 틀 중 하나를 골라 만들 수 있고, 필요한 기능만 켜고 끌 수 있습니다.</p>';
  return h;
}

function adminSync() {
  let h = '<div class="card"><h3>☁️ 구글 시트 동기화</h3>';
  h += '<div class="kv"><span>연결</span><b>' + (Api.on() ? '<span class="chip mint">연결됨</span>' : '<span class="chip rose">주소 없음</span>') + '</b></div>';
  h += '<div class="kv"><span>현재 판본</span><b>rev ' + S.rev + '</b></div>';
  h += '<div class="kv"><span>마지막 저장</span><b>' + (S.lastPull ? timeAgo(S.lastPull) : '-') + '</b></div>';
  h += '<div class="kv"><span>저장된 자료</span><b>학생 ' + (S.state.students || []).filter(x => !x._del).length + ' · 보고 ' + (S.state.reports || []).filter(x => !x._del).length + ' · 알림장 ' + (S.state.notices || []).filter(x => !x._del).length + '</b></div>';
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="force-pull">↻ 시트에서 새로 불러오기</button><button class="btn" data-act="force-save">☁️ 지금 저장</button></div>';
  h += '</div>';
  h += '<div class="card"><h3>🔒 보안</h3><p class="muted" style="margin:0">부서·학생·출석·보고서·알림장·일정은 모두 이 기기에서 AES-256-GCM 으로 암호화된 뒤에만 구글 시트로 전송됩니다. 시트에는 암호문만 남고, 열쇠는 계정 비밀번호로 감싸 보관합니다.</p></div>';
  return h;
}

async function loadAccounts(force) {
  if (V.accountsLoading) return;
  if (V.accounts && !force) return;
  V.accountsLoading = true; V.accountsErr = '';
  renderApp();
  try {
    V.accounts = await listAccounts();
  } catch (e) {
    V.accountsErr = '계정 목록을 불러오지 못했습니다: ' + ((e && e.message) || e);
    V.accounts = null;
  }
  V.accountsLoading = false;
  renderApp();
}

/* ---------------- 내 정보 ---------------- */
function meView() {
  const roles = myRoleDefs();
  const depts = (S.me.depts || []).map(d => (deptById(d) || {}).name).filter(Boolean);
  const cls = (S.me.classes || []).map(c => (classById(c) || {}).name).filter(Boolean);
  let h = '<div class="page-head"><div><h2>내 정보</h2><p>' + esc(S.me.name) + ' · ' + esc(S.me.id) + '</p></div></div>';
  h += '<div class="card"><h3>🙂 ' + esc(S.me.name) + '</h3>';
  h += '<div class="kv"><span>아이디</span><b>' + esc(S.me.id) + '</b></div>';
  h += '<div class="kv"><span>역할</span><b>' + esc(roles.map(r => r.emoji + ' ' + r.label).join(' / ') || '없음') + '</b></div>';
  h += '<div class="kv"><span>부서</span><b>' + esc(depts.join(', ') || '전체') + '</b></div>';
  if (cls.length) h += '<div class="kv"><span>담당 반</span><b>' + esc(cls.join(', ')) + '</b></div>';
  if (S.me.birth) h += '<div class="kv"><span>생일</span><b>' + esc(birthLabel(S.me)) + '</b></div>';
  else h += '<div class="kv"><span>생일</span><b><span class="chip amber">미입력</span></b></div>';
  h += '<div class="kv"><span>계정 상태</span><b>' + (accountStatusChip(S.me) || '<span class="chip mint">정상</span>') + (S.me.statusNote ? ' · ' + esc(S.me.statusNote) : '') + '</b></div>';
  const gr = grantedPerms();
  const grList = Object.keys(gr).filter(k => gr[k]).map(k => (PERM_LABELS.find(x => x[0] === k) || [k, k])[1]);
  if (grList.length) h += '<div class="kv"><span>위임받은 권한</span><b>' + esc(grList.join(', ')) + '</b></div>';
  if (roleDef(S.roleKey).base === 'parent') h += '<div class="kv"><span>자녀</span><b>' + esc(myStudents().map(s => s.name).join(', ') || '미연결') + '</b></div>';
  h += '</div>';

  h += '<div class="card"><h3>🎂 생일</h3>';
  const bt = V.myBirthType || birthTypeOf(S.me);
  h += '<div class="row wrap" style="gap:6px;margin-bottom:9px">';
  h += '<button class="chip big ' + (bt === 'solar' ? 'coral' : 'gray') + '" data-act="my-birth-type" data-v="solar">양력</button>';
  h += '<button class="chip big ' + (bt === 'lunar' ? 'coral' : 'gray') + '" data-act="my-birth-type" data-v="lunar">음력</button></div>';
  h += '<div class="field"><label>' + (bt === 'lunar' ? '음력 생년월일' : '양력 생년월일') + '</label><input id="myBirth" type="date" value="' + esc(S.me.birth || '') + '"></div>';
  h += '<div class="hint">' + (bt === 'lunar' ? '음력으로 적으면 그 해의 양력 날짜로 바꾸어 부서 일정에 표시합니다.' : '양력으로 적으면 그 날짜에 해마다 표시합니다.') + ' 생일은 지금 소속된 부서 일정에 매년 자동으로 나오며, 부서를 옮기면 옮긴 부서에 나옵니다.</div>';
  h += '<button class="btn primary block" style="margin-top:8px" data-act="save-my-birth">생일 저장</button></div>';

  if (myRoleDefs().length > 1) {
    h += '<div class="card"><h3>🎭 역할 전환</h3><div class="row wrap" style="gap:6px">' + myRoleDefs().map(r => '<button class="chip big ' + (r.key === S.roleKey ? 'coral' : 'gray') + '" data-act="use-role" data-key="' + esc(r.key) + '">' + esc(r.emoji + ' ' + r.label) + '</button>').join('') + '</div></div>';
  }

  h += '<div class="card"><h3>🔑 비밀번호 변경</h3>';
  h += '<div class="field"><label>현재 비밀번호</label><input type="password" id="pwOld" autocomplete="current-password"></div>';
  h += '<div class="field"><label>새 비밀번호</label><input type="password" id="pwNew" autocomplete="new-password" placeholder="8자 이상"><div class="hint">바꾸면 이 계정으로 들어오는 모든 기기에 새 비밀번호가 필요합니다.</div></div>';
  h += '<div class="field"><label>새 비밀번호 확인</label><input type="password" id="pwNew2" autocomplete="new-password"></div>';
  h += '<button class="btn primary block" data-act="pw-change">비밀번호 변경</button></div>';

  h += '<div class="card"><h3>☁️ 동기화</h3><div class="kv"><span>상태</span><b>' + ({ saved: '정상', saving: '저장 중', error: '오류', off: '꺼짐', idle: '대기' }[S.sync] || S.sync) + '</b></div><div class="kv"><span>판본</span><b>rev ' + S.rev + '</b></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="force-pull">새로 불러오기</button><button class="btn sm" data-act="force-save">지금 저장</button></div></div>';

  h += '<button class="btn block" style="margin-bottom:10px" data-act="logout">로그아웃</button>';
  h += '<p class="login-foot">덕신교회 부서업무 · 모든 자료는 암호화되어 저장됩니다</p>';
  return h;
}

/* ---------------- 모달 ---------------- */
let modalOpen = false;
function openModal(title, body, opts) {
  opts = opts || {};
  modalOpen = true;
  const root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-label="' + esc(title) + '">' +
    '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-x" data-act="modal-close">✕</button></div>' +
    body + '</div></div>';
  root.style.display = 'block';
  if (opts.focus) { const f = document.getElementById(opts.focus); if (f) setTimeout(() => f.focus(), 60); }
}
function closeModal() {
  modalOpen = false;
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  root.style.display = 'none';
}

function roleChecks(selected, nameAttr) {
  const roles = (S.state.roles || []).filter(r => !r._del);
  return '<div class="row wrap" style="gap:6px">' + roles.map(r => {
    const on = (selected || []).indexOf(r.key) >= 0;
    return '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-role" data-key="' + esc(r.key) + '" data-group="' + esc(nameAttr) + '">' + esc(r.emoji + ' ' + r.label) + '</button>';
  }).join('') + '</div>';
}

function deptChecks(selected) {
  const ds = (S.state.departments || []).filter(d => !d._del);
  return '<div class="row wrap" style="gap:6px">' + ds.map(d => {
    const on = (selected || []).indexOf(d.id) >= 0;
    return '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>';
  }).join('') + '</div>';
}

function noticeModal(n) {
  const d = deptById(n.deptId) || {};
  const mine = (n.reads || {})[S.me.uid];
  const readers = Object.keys(n.reads || {});
  let h = '<div class="row" style="gap:6px;margin-bottom:8px">' + deptChip(d) + (n.classId ? '<span class="chip">' + esc((classById(n.classId) || {}).name || '') + '</span>' : '') + (n.pinned ? '<span class="chip coral">📌 고정</span>' : '') + '</div>';
  h += '<h2 style="font-size:18px;margin:2px 0 4px">' + esc(n.title) + '</h2>';
  h += '<div class="muted">' + esc(n.authorName || '') + ' · ' + esc(fmtDate(n.date || ymd(new Date(n.at || Date.now())))) + ' ' + timeAgo(n.at) + '</div>';
  h += '<div class="notice-body pre">' + esc(n.body) + '</div>';
  if (can('notice.read')) {
    const isAuthor = n.author === S.me.uid;
    if (mine) h += '<div class="banner mint" style="margin-top:12px">✅ ' + esc(new Date(Number(mine)).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '에 확인했습니다</div>';
    else if (!isAuthor) h += '<button class="btn primary block" style="margin-top:12px" data-act="ack-notice" data-id="' + esc(n.id) + '">✅ 확인했어요</button>';
    else h += '<p class="muted" style="margin-top:12px">내가 쓴 알림장입니다. 학부모·교사 확인 여부는 아래에 표시됩니다.</p>';
  }
  if (can('notice.write')) {
    h += '<div class="divider"></div><div class="row"><b style="font-size:13px">확인 ' + readers.length + '명</b><span class="sp"></span>';
    h += '<button class="btn sm" data-act="del-notice" data-id="' + esc(n.id) + '">삭제</button></div>';
    if (readers.length) h += '<div class="muted" style="margin-top:6px">' + esc(readers.map(u => nameOfUid(u)).join(', ')) + '</div>';
    const kids = studentsOfDept(n.deptId).filter(s => !n.classId || s.classId === n.classId);
    const unread = kids.filter(s => s.guardianPhone && !(n.reads || {})[s.guardianUid]);
    if (unread.length) {
      h += '<div class="sect-title">아직 확인하지 않은 보호자 ' + unread.length + '명</div><div class="list">';
      unread.forEach(s => {
        h += '<div class="item" style="padding:9px 11px"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + '</b><span>' + esc(s.guardianName || '보호자') + ' · ' + esc(s.guardianPhone) + '</span></span>' + msgBtnHtml(s.id, '보호자에게 알림장 안내 문자·카톡') + '</div>';
      });
      h += '</div>';
    }
  }
  openModal('알림장', h);
}

function userModal(acct) {
  const isNew = !acct;
  const rec = acct ? acct.rec : { name: '', roles: ['teacher'], depts: [], classes: [], students: [], active: true };
  V.editUser = { uid: acct ? acct.uid : '', id: rec.id || '', roles: (rec.roles || []).slice(), depts: (rec.depts || []).slice(), classes: (rec.classes || []).slice(), students: (rec.students || []).slice(), salt: acct ? acct.salt : '', wrap: acct ? acct.wrap : '', birth: rec.birth || '', birthType: birthTypeOf(rec), birthLunar: rec.birthLunar || '', status: accountStatusOf(rec), statusNote: rec.statusNote || '', grants: Object.assign({}, rec.grants || {}), active: rec.active !== false };
  let h = '';
  h += '<div class="field"><label>아이디 ' + (isNew ? '' : '<span class="muted">(변경 불가)</span>') + '</label><input id="uId" value="' + esc(rec.id || '') + '" ' + (isNew ? 'placeholder="예: kim / teacher2"' : 'readonly') + ' autocomplete="off"></div>';
  h += '<div class="field"><label>이름</label><input id="uName" value="' + esc(rec.name || '') + '" placeholder="예: 김은혜"></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:5px"><button type="button" class="chip big ' + (V.editUser.birthType === 'solar' ? 'coral' : 'gray') + '" data-act="u-birth-type" data-v="solar">양력</button><button type="button" class="chip big ' + (V.editUser.birthType === 'lunar' ? 'coral' : 'gray') + '" data-act="u-birth-type" data-v="lunar">음력</button></div>';
  h += '<div class="field"><label id="uBirthLabel">생일 ' + (V.editUser.birthType === 'lunar' ? '(음력)' : '(양력)') + '</label><input id="uBirth" type="date" value="' + esc(rec.birth || '') + '"><div class="hint">부서 일정에 매년 자동 등록됩니다.</div></div>';
  h += '<div class="field"><label>비밀번호 ' + (isNew ? '' : '<span class="muted">(바꿀 때만 입력)</span>') + '</label><input id="uPw" type="password" placeholder="8자 이상" autocomplete="new-password"></div>';
  if (!isNew) h += '<p class="hint" style="margin:-4px 0 10px">비워 두면 기존 비밀번호가 그대로 유지됩니다.</p>';
  h += '<div class="field"><label>역할 (여러 개 선택 가능)</label>' + roleChecks(rec.roles, 'user') + '</div>';
  h += '<div class="field"><label>담당 부서</label>' + deptChecks(rec.depts) + '<div class="hint">목회자·관리자는 지정하지 않으면 전체 부서를 봅니다.</div></div>';
  h += '<div class="field"><label>담당 반</label><div class="row wrap" style="gap:6px">';
  const cls = (S.state.classes || []).filter(c => !c._del && inYear(c));
  if (!cls.length) h += '<span class="muted">등록된 반이 없습니다.</span>';
  cls.forEach(c => { const on = (rec.classes || []).indexOf(c.id) >= 0; h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-class" data-id="' + esc(c.id) + '">' + esc((deptById(c.deptId) || {}).name || '') + ' ' + esc(c.name) + '</button>'; });
  h += '</div></div>';
  h += '<div class="field"><label>자녀 연결 (학부모용)</label><div class="row wrap" style="gap:6px">';
  const studs = (S.state.students || []).filter(s => !s._del && inYear(s));
  if (!studs.length) h += '<span class="muted">등록된 학생이 없습니다.</span>';
  studs.slice(0, 60).forEach(s => { const on = (rec.students || []).indexOf(s.id) >= 0; h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-student" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>'; });
  h += '</div></div>';
  h += '<div class="field"><label>계정 상태</label><div class="row wrap" style="gap:6px">';
  [['normal', '정상'], ['paused', '⏸ 일시중지'], ['blocked', '⛔ 차단']].forEach(x => {
    h += '<button type="button" class="chip big ' + (V.editUser.status === x[0] ? (x[0] === 'blocked' ? 'rose' : x[0] === 'paused' ? 'amber' : 'mint') : 'gray') + '" data-act="u-status" data-v="' + x[0] + '">' + x[1] + '</button>';
  });
  h += '</div><div class="hint">일시중지·차단하면 그 계정은 로그인할 수 없고, 이전 기록은 그대로 남습니다. 언제든 정상으로 되돌릴 수 있습니다.</div></div>';
  h += '<div class="field"><label>상태 사유 (선택)</label><input id="uStatusNote" value="' + esc(V.editUser.statusNote || '') + '" placeholder="예: 이사로 인한 일시중지"></div>';
  h += '<div class="row" style="margin-top:6px">' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-user" data-uid="' + esc(acct.uid) + '">삭제</button>') + '<span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-user">저장</button></div>';
  openModal(isNew ? '사용자 추가' : '사용자 수정', h, { focus: isNew ? 'uId' : 'uName' });
}

function deptModal(d) {
  const isNew = !d;
  const dep = d || { name: '', emoji: '📖', color: '#ffb4a2', note: '', order: (S.state.departments || []).length + 1 };
  let h = '';
  h += '<div class="field"><label>부서 이름</label><input id="dName" value="' + esc(dep.name) + '" placeholder="예: 초등부"></div>';
  h += '<div class="grid2"><div class="field"><label>아이콘</label><input id="dEmoji" value="' + esc(dep.emoji) + '" maxlength="4"></div>';
  h += '<div class="field"><label>색</label><input id="dColor" type="color" value="' + esc(dep.color) + '" style="height:44px;padding:4px"></div></div>';
  h += '<div class="field"><label>순서</label><input id="dOrder" type="number" value="' + esc(dep.order || 1) + '"></div>';
  h += '<div class="field"><label>메모</label><input id="dNote" value="' + esc(dep.note || '') + '"></div>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-dept" data-id="' + esc(d ? d.id : '') + '">저장</button></div>';
  openModal(isNew ? '부서 추가' : '부서 수정', h, { focus: 'dName' });
}

function roleModal(r) {
  const isNew = !r;
  const rl = r || { key: '', label: '', emoji: '🙂', base: 'teacher' };
  let h = '';
  h += '<div class="field"><label>역할 이름</label><input id="rLabel" value="' + esc(rl.label) + '" placeholder="예: 부장교사"></div>';
  h += '<div class="field"><label>아이콘</label><input id="rEmoji" value="' + esc(rl.emoji) + '" maxlength="4"></div>';
  h += '<div class="field"><label>화면 틀</label><select id="rBase">' + opts([['parent', '학부모 화면'], ['teacher', '교사 화면'], ['edu', '교육부서담당 화면'], ['pastor', '목회자 화면'], ['admin', '관리자 화면']], rl.base) + '</select></div>';
  h += '<div class="banner sky">권한은 화면 틀에서 자동으로 정해집니다. 역할을 추가한 뒤 사용자 관리에서 계정에 지정하세요.</div>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-role" data-key="' + esc(r ? r.key : '') + '">저장</button></div>';
  openModal(isNew ? '역할 추가' : '역할 수정', h, { focus: 'rLabel' });
}

function studentModal(s, classId) {
  const isNew = !s;
  const st = s || { name: '', birth: '', gender: '', classId: classId || '', deptId: '', guardianName: '', guardianPhone: '', guardianUid: '', note: '' };
  const cls = (S.state.classes || []).filter(c => !c._del && inYear(c));
  V.stuBirthType = birthTypeOf(st);
  V.stuNewcomer = !!st.newcomer;
  const bt = V.stuBirthType;
  let h = '';
  h += '<div class="field"><label>이름</label><input id="sName" value="' + esc(st.name) + '" placeholder="학생 이름"></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:5px"><button type="button" class="chip big ' + (bt === 'solar' ? 'coral' : 'gray') + '" data-act="s-birth-type" data-v="solar">양력</button><button type="button" class="chip big ' + (bt === 'lunar' ? 'coral' : 'gray') + '" data-act="s-birth-type" data-v="lunar">음력</button></div>';
  h += '<div class="grid2"><div class="field"><label id="sBirthLabel">생년월일 ' + (bt === 'lunar' ? '(음력)' : '(양력)') + '</label><input id="sBirth" type="date" value="' + esc(st.birth) + '" data-change="s-birth"><div class="hint">부서 일정에 🎂 생일이 매년 자동 등록됩니다.</div></div>';
  h += '<div class="field"><label>성별</label><select id="sGender">' + opts([['', '선택'], ['m', '남'], ['f', '여']], st.gender) + '</select></div></div>';
  h += '<div class="field"><label>반</label><select id="sClass">' + opts([['', '반 미지정']].concat(cls.map(c => [c.id, ((deptById(c.deptId) || {}).name || '') + ' ' + c.name])), st.classId) + '</select></div>';
  const pr0 = promoOf(st, curYear());
  h += '<div class="banner sky" id="sPromoHint" style="margin-top:-2px">' + (pr0.age
    ? '<b>' + curYear() + '년 기준 ' + pr0.age + '세 · ' + esc(pr0.label) + '</b> · 진급 부서: <b>' + esc(pr0.deptName) + '</b>'
    : '생년월일을 넣으면 나이·학년과 진급 부서를 바로 보여 줍니다.') + '</div>';
  h += '<div class="grid2"><div class="field"><label>보호자</label><input id="sGuardian" value="' + esc(st.guardianName || '') + '" placeholder="학부모 이름"></div>';
  h += '<div class="field"><label>연락처</label><input id="sPhone" type="tel" value="' + esc(st.guardianPhone || '') + '" placeholder="010-0000-0000"></div></div>';
  h += '<div class="field"><label>신입(새신자)</label><button type="button" class="chip big ' + (V.stuNewcomer ? 'amber' : 'gray') + '" data-act="s-newcomer">' + (V.stuNewcomer ? '★ 신입으로 표시됨' : '☆ 신입으로 표시') + '</button><div class="hint">출석 화면의 ☆신입 단추로도 그 주일만 신입으로 표시할 수 있습니다.</div></div>';
  h += '<div class="field"><label>메모</label><input id="sNote" value="' + esc(st.note || '') + '"></div>';
  if (!isNew) {
    h += '<div class="card flat" style="padding:11px;margin-bottom:10px"><div class="kv" style="padding:4px 0"><span>학부모 계정</span><b>' + (st.guardianUid ? esc(nameOfUid(st.guardianUid)) + ' <span class="chip mint">연결됨</span>' : '<span class="chip amber">미연결</span>') + '</b></div>';
    h += '<div class="row wrap" style="gap:6px;margin-top:6px">';
    if (can('child.link')) h += '<button class="btn sm" data-act="child-link" data-sid="' + esc(s.id) + '">👨‍👩‍👧 학부모 연결·변경</button>';
    if (st.guardianPhone) h += '<button class="btn sm" data-act="msg-student" data-sid="' + esc(s.id) + '">💬 문자·카톡</button>';
    h += '</div></div>';
  }
  h += '<div class="row"><span class="sp"></span>' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-student" data-id="' + esc(s.id) + '">삭제</button>') + '<button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-student" data-id="' + esc(isNew ? '' : s.id) + '">저장</button></div>';
  openModal(isNew ? '학생 추가' : '학생 정보', h, { focus: 'sName' });
}

/* 반 일괄 지정 — 진급 후 새 학년도 반 나누기를 한 번에 */
function bulkClassModal(deptId) {
  if (!can('member.manage')) return toast('반·학생을 고칠 권한이 없습니다', 'err');
  const cls = classesOfDept(deptId);
  if (!cls.length) return toast('이 부서에 반이 없습니다. 먼저 반을 만들어 주세요', 'err');
  const studs = studentsOfDept(deptId).filter(s => !s.classId || !cls.some(c => c.id === s.classId));
  if (!studs.length) return toast('반 미지정 학생이 없습니다', 'err');
  V.bulkClass = { deptId: deptId, clsId: cls[0].id, sids: studs.map(s => s.id) };
  const d = deptById(deptId) || {};
  let h = '<div class="banner sky">' + esc(d.name || '') + ' 반 미지정 ' + studs.length + '명을 한 번에 지정합니다.</div>';
  h += '<div class="field"><label>반</label><select id="bcClass">' + opts(cls.map(c => [c.id, c.name]), V.bulkClass.clsId) + '</select></div>';
  h += '<div class="field"><label>학생 (' + studs.length + '명)</label><div class="row wrap" style="gap:6px">';
  studs.forEach(s => {
    h += '<button type="button" class="chip big ' + (V.bulkClass.sids.indexOf(s.id) >= 0 ? 'coral' : 'gray') + '" data-act="bc-pick" data-sid="' + esc(s.id) + '">' + esc(s.name) + '</button>';
  });
  h += '</div><div class="hint">빼려는 학생은 한 번 더 눌러 해제하세요.</div></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="bc-save">반 지정</button></div>';
  openModal('반 일괄 지정', h);
}

function classModal(c, deptId) {
  const isNew = !c;
  const cl = c || { name: '', deptId: deptId || V.dept, note: '' };
  let h = '<div class="field"><label>반 이름</label><input id="cName" value="' + esc(cl.name) + '" placeholder="예: 초등 1반"></div>';
  h += '<div class="field"><label>부서</label><select id="cDept">' + opts((S.state.departments || []).filter(d => !d._del).map(d => [d.id, d.name]), cl.deptId) + '</select></div>';
  h += '<div class="field"><label>메모</label><input id="cNote" value="' + esc(cl.note || '') + '"></div>';
  h += '<div class="row"><span class="sp"></span>' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-class" data-id="' + esc(c.id) + '">삭제</button>') + '<button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-class" data-id="' + esc(isNew ? '' : c.id) + '">저장</button></div>';
  openModal(isNew ? '반 추가' : '반 수정', h, { focus: 'cName' });
}

function eventModal(e) {
  const isNew = !e;
  const ev = e || { title: '', date: ymd(), time: '', place: '', deptId: V.dept || (visibleDepts()[0] || {}).id || '', desc: '' };
  let h = '<div class="field"><label>제목</label><input id="eTitle" value="' + esc(ev.title) + '" placeholder="예: 부서 야외예배"></div>';
  h += '<div class="grid2"><div class="field"><label>날짜</label><input id="eDate" type="date" value="' + esc(ev.date) + '"></div><div class="field"><label>시간</label><input id="eTime" value="' + esc(ev.time || '') + '" placeholder="오전 10:30"></div></div>';
  h += '<div class="field"><label>부서</label><select id="eDept">' + opts(visibleDepts().map(d => [d.id, d.name]), ev.deptId) + '</select></div>';
  h += '<div class="field"><label>장소</label><input id="ePlace" value="' + esc(ev.place || '') + '" placeholder="예: 본당 2층"></div>';
  h += '<div class="field"><label>내용</label><textarea id="eDesc">' + esc(ev.desc || '') + '</textarea></div>';
  h += '<div class="row"><span class="sp"></span>' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-event" data-id="' + esc(e.id) + '">삭제</button>') + '<button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-event" data-id="' + esc(isNew ? '' : e.id) + '">저장</button></div>';
  openModal(isNew ? '일정 추가' : '일정 수정', h, { focus: 'eTitle' });
}

function noticeWriteModal() {
  const depts = visibleDepts();
  let h = '<div class="field"><label>제목</label><input id="nTitle" placeholder="예: 이번 주 공과 안내"></div>';
  h += '<div class="field"><label>부서</label><select id="nDept">' + opts(depts.map(d => [d.id, d.name]), V.dept) + '</select></div>';
  h += '<div class="field"><label>반 (선택)</label><select id="nClass">' + opts([['', '부서 전체']].concat((S.state.classes || []).filter(c => !c._del).map(c => [c.id, ((deptById(c.deptId) || {}).name || '') + ' ' + c.name])), '') + '</select></div>';
  h += '<div class="field"><label>내용</label><textarea id="nBody" style="min-height:150px" placeholder="학부모님께 전할 내용을 적어 주세요."></textarea></div>';
  h += '<div class="field"><label>고정</label><button type="button" class="chip big gray" data-act="toggle-pin">📌 위에 고정</button></div>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-notice">보내기</button></div>';
  openModal('알림장 쓰기', h, { focus: 'nTitle' });
}

function feedWriteModal() {
  const depts = visibleDepts();
  let h = '<div class="field"><label>제목</label><input id="fTitle" placeholder="예: 오늘 아이들 웃음"></div>';
  h += '<div class="field"><label>부서</label><select id="fDept">' + opts(depts.map(d => [d.id, d.name]), V.dept) + '</select></div>';
  h += '<div class="field"><label>내용</label><textarea id="fBody" style="min-height:130px"></textarea></div>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-feed">올리기</button></div>';
  openModal('부서 피드 글쓰기', h, { focus: 'fTitle' });
}

function roleMenuModal() {
  let h = '<div class="list">';
  myRoleDefs().forEach(r => {
    h += '<button class="item" data-act="use-role" data-key="' + esc(r.key) + '"><span class="av">' + esc(r.emoji || '🙂') + '</span><span class="tx"><b>' + esc(r.label) + '</b><span>' + esc(Object.keys(BASE_PERMS[r.base] || {}).length) + '개 기능</span></span><span class="rt">' + (r.key === S.roleKey ? '<span class="chip mint">사용 중</span>' : '') + '</span></button>';
  });
  h += '</div><p class="muted" style="text-align:center;margin-top:10px">한 계정이 여러 역할을 겸할 때 여기서 화면을 바꿉니다.</p>';
  openModal('역할 전환', h);
}
