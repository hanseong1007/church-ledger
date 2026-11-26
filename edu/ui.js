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
  const P = BASE_PERMS[r.base] || {};
  const out = [{ key: 'home', label: '홈', icon: '🏠' }];
  if (P['attendance.check'] || P['attendance.self'] || P['attendance.stat']) out.push({ key: 'attendance', label: (P['attendance.self'] && !P['attendance.check']) ? '자녀 출석' : '출석', icon: '✅' });
  if (P['attendance.stat']) out.push({ key: 'stats', label: '출석통계', icon: '📊' });
  if (P['report.write'] || P['report.review']) out.push({ key: 'report', label: (P['report.review'] && !P['report.write']) ? '주일보고 수신함' : '주일보고', icon: '📋' });
  if (P['plan.read'] || P['plan.write']) out.push({ key: 'plan', label: '월별계획표', icon: '🗓️' });
  if (P['ledger.manage']) out.push({ key: 'ledger', label: '회계', icon: '💰' });
  if (P['notice.read'] || P['notice.write']) out.push({ key: 'notice', label: '알림장', icon: '📌' });
  if (P['feed.read'] || P['feed.write']) out.push({ key: 'feed', label: '부서 피드', icon: '💬' });
  if (P['member.manage']) out.push({ key: 'members', label: '반·학생', icon: '👥' });
  out.push({ key: 'schedule', label: '일정', icon: '📅' });
  if (P['user.approve']) out.push({ key: 'approve', label: '가입 승인', icon: '👋' });
  if (P['user.manage'] || P['dept.manage']) out.push({ key: 'admin', label: '관리', icon: '⚙️' });
  out.push({ key: 'me', label: '내 정보', icon: '🙂' });
  return out;
}

function pendingReports() {
  if (!can('report.review')) return 0;
  return (S.state.reports || []).filter(r => !r._del && r.status === 'submitted').length;
}
function unreadNotices() {
  const uid = S.me ? S.me.uid : '';
  return noticesForMe().filter(n => !(n.reads || {})[uid]).length;
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
  return '<span class="chip gray">작성중</span>';
}
function attLabel(s) { return s === 'present' ? '출석' : s === 'absent' ? '결석' : s === 'excused' ? '인정' : '-'; }

function myStudents() {
  if (!S.me) return [];
  const base = roleDef(S.roleKey).base;
  if (base === 'parent') {
    const ids = S.me.students || [];
    return (S.state.students || []).filter(s => !s._del && (ids.indexOf(s.id) >= 0 || s.guardianUid === S.me.uid));
  }
  if (base === 'teacher') {
    const cls = S.me.classes || [];
    return (S.state.students || []).filter(s => !s._del && cls.indexOf(s.classId) >= 0);
  }
  return (S.state.students || []).filter(s => !s._del);
}

function myClassList() {
  const base = roleDef(S.roleKey).base;
  if (base === 'teacher') return (S.state.classes || []).filter(c => !c._del && (S.me.classes || []).indexOf(c.id) >= 0);
  return (S.state.classes || []).filter(c => !c._del);
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
  return (S.state.events || []).filter(e => !e._del && depts.indexOf(e.deptId) >= 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* ---------------- 헤더 · 탭 ---------------- */
function renderApp() {
  const role = activeRole();
  const scr = screensFor(S.roleKey);
  if (!scr.some(s => s.key === S.screen)) S.screen = 'home';
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
      case 'schedule': return scheduleView();
      case 'plan': return planView();
      case 'ledger': return ledgerView();
      case 'stats': return statsView();
      case 'approve': return approveView();
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
  const sun = lastSunday();
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
      const st = monthStats(k.id, ymd().slice(0, 7));
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
    const open = (S.state.reports || []).filter(r => !r._del && r.status === 'submitted');
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
      return '<button class="item" data-act="open-notice" data-id="' + esc(n.id) + '"><span class="av" style="background:' + esc((d || {}).color || '#ffb4a2') + '33">📌</span><span class="tx"><b>' + esc(n.title) + '</b><span>' + esc((d || {}).name || '') + ' · ' + timeAgo(n.at) + '</span></span><span class="rt">' + (read ? '<span class="chip mint">확인</span>' : '<span class="chip coral">새 알림</span>') + '</span></button>';
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
    rec = { id: 'at-' + Crypto.uid(), date: date, deptId: deptId, classId: classId, studentId: studentId, status: status, by: S.me.uid, at: Date.now(), u: 0 };
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
    rec = { id: 'at-' + Crypto.uid(), date: date, deptId: deptId, staff: uid, status: status, by: S.me.uid, at: Date.now(), u: 0 };
    S.state.attendance.push(rec);
  }
  rec.status = status; rec._del = false; rec.by = S.me.uid; rec.at = Date.now(); touch(rec);
  Sync.save();
}

/* ---------------- 출석 화면 ---------------- */
function attendanceView() {
  const base = roleDef(S.roleKey).base;
  if (base === 'parent') return parentAttendanceView();
  let h = '';
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다', '관리자에게 부서 지정을 요청하세요') + '</div>';
  if (!V.dept || !depts.some(d => d.id === V.dept)) V.dept = depts[0].id;
  const dept = deptById(V.dept);

  h += '<div class="page-head"><div><h2>출석 체크</h2><p>주일 출석을 누르면 바로 저장됩니다</p></div></div>';
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="daybar"><button class="icon-btn" data-act="date-move" data-v="-7">‹</button><input type="date" id="attDate" value="' + esc(V.date) + '" data-change="att-date"><button class="icon-btn" data-act="date-move" data-v="7">›</button></div>';
  h += '<div class="row wrap" style="gap:6px">' + depts.map(d => '<button class="chip big ' + (d.id === V.dept ? 'coral' : 'gray') + '" data-act="pick-dept" data-id="' + esc(d.id) + '">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</button>').join('') + '</div>';
  h += '</div>';

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
      h += '<div class="stud-row"><span class="nm"><b>' + esc(s.name) + '</b><span>' + esc((classById(s.classId) || {}).name || '반 미지정') + (s.birth ? ' · ' + esc(birthShort(s.birth)) : '') + '</span>';
      if (st === 'absent') {
        h += '<button class="reason-line" data-act="att-reason" data-sid="' + esc(s.id) + '">' + (a && a.reason ? '결석 사유: ' + esc(a.reason) : '＋ 결석 사유 적기') + '</button>';
      }
      h += '</span>';
      h += '<span class="people-toggle">';
      h += '<button class="present ' + (st === 'present' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="present" title="출석">출</button>';
      h += '<button class="absent ' + (st === 'absent' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="absent" title="결석">결</button>';
      h += '<button class="excused ' + (st === 'excused' ? 'on' : '') + '" data-act="att" data-sid="' + esc(s.id) + '" data-v="excused" title="인정">인</button>';
      h += '</span></div>';
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
    const st = monthStats(k.id, ymd().slice(0, 7));
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
  if (can('report.write') && can('report.review')) return reportBothView();
  if (can('report.review')) return pastorInboxView();
  return reportWriteView();
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
  let h = '<div class="page-head"><div><h2>주일보고</h2><p>출석 수치는 자동으로 채워집니다</p></div></div>';

  h += '<div class="card flat" style="padding:12px"><div class="daybar"><button class="icon-btn" data-act="report-date-move" data-v="-7">‹</button><input type="date" id="repDate" value="' + esc(date) + '" data-change="report-date"><button class="icon-btn" data-act="report-date-move" data-v="7">›</button></div>';
  h += '<div class="row wrap" style="gap:6px">' + depts.map(d => '<button class="chip big ' + (d.id === dept.id ? 'coral' : 'gray') + '" data-act="pick-report-dept" data-id="' + esc(d.id) + '">' + esc(d.emoji || '') + ' ' + esc(d.name) + '</button>').join('') + '</div></div>';

  if (!rep) {
    h += '<div class="banner sky">이 주일 ' + esc(dept.name) + ' 보고서가 아직 없습니다. 아래에서 새로 작성하세요.</div>';
    h += '<button class="btn primary block" data-act="create-report">＋ ' + esc(fmtShort(date)) + ' 주일보고 작성</button>';
    const c = deptCounts(dept.id, date);
    h += '<div class="stat-grid" style="margin-top:12px"><div class="stat enroll"><b>' + c.enrolled + '</b><span>재적</span></div><div class="stat present"><b>' + c.present + '</b><span>출석</span></div><div class="stat absent"><b>' + c.absent + '</b><span>결석</span></div><div class="stat new"><b>' + c.none + '</b><span>미체크</span></div></div>';
    return h;
  }

  const c = deptCounts(dept.id, date);
  const cn = rep.counts || {};
  h += '<div class="card"><h3>' + esc(dept.emoji || '') + ' ' + esc(dept.name) + ' · ' + esc(fmtShort(date)) + '<span class="sp"></span>' + statusChip(rep.status) + '</h3>';
  if (rep.status === 'checked') {
    h += '<div class="banner mint">✅ 목회자 확인 완료 · ' + esc(rep.checkedByName || '목회자') + (rep.comment ? '<br>“' + esc(rep.comment) + '”' : '') + '</div>';
  }
  h += '<div class="stat-grid"><div class="stat enroll"><b>' + c.enrolled + '</b><span>재적</span></div><div class="stat present"><b>' + c.present + '</b><span>출석</span></div><div class="stat absent"><b>' + c.absent + '</b><span>결석</span></div><div class="stat new"><b>' + (cn.newcomer || 0) + '</b><span>신입</span></div></div>';
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
  h += '<div class="card">';
  h += '<div class="field"><label>예배 말씀</label><input id="rpScripture" value="' + esc(rep.scripture || '') + '" placeholder="예: 창세기 1:1 / 만물을 창조하신 하나님"' + ro + '></div>';
  h += '<div class="field"><label>공과 내용</label><input id="rpLesson" value="' + esc(rep.lesson || planLesson) + '" placeholder="예: 3과 하나님이 만드신 세상"' + ro + '></div>';
  h += '<div class="grid3"><div class="field"><label>신입</label><input id="rpNew" type="number" min="0" value="' + (cn.newcomer || 0) + '"' + ro + '></div>';
  h += '<div class="field"><label>헌금(원)</label><input id="rpOffering" type="text" inputmode="numeric" value="' + esc(rep.offering || (weekIncome ? String(weekIncome) : '')) + '" placeholder="0"' + ro + '><div class="hint">' + (weekIncome ? '이 주 회계 수입 ' + money(weekIncome) + '원이 자동으로 채워졌습니다. 고쳐써도 됩니다.' : '') + '</div></div>';
  h += '<div class="field"><label>출석 인원(자동)</label><input value="' + c.present + '" readonly></div></div>';
  h += '<div class="field"><label>특이사항</label><textarea id="rpNotes" placeholder="결석 사유, 새로 나온 친구, 전달 사항"' + ro + '>' + esc(rep.notes || '') + '</textarea></div>';
  h += '<div class="field"><label>기도제목</label><textarea id="rpPrayer" placeholder="부서 기도제목"' + ro + '>' + esc(rep.prayer || '') + '</textarea></div>';
  if (rep.status !== 'checked') {
    h += '<div class="row"><button class="btn" data-act="save-report" data-id="' + esc(rep.id) + '">저장</button><span class="sp"></span><button class="btn primary" data-act="submit-report" data-id="' + esc(rep.id) + '">목회자에게 제출</button></div>';
  } else {
    h += '<div class="row"><button class="btn" data-act="print-report" data-id="' + esc(rep.id) + '">🖨 인쇄</button></div>';
  }
  h += '</div>';
  h += '<p class="muted" style="text-align:center">작성 ' + esc(rep.authorName || '') + ' · ' + timeAgo(rep.u || rep.at) + (rep.submittedAt ? ' · 제출 ' + timeAgo(rep.submittedAt) : '') + '</p>';
  return h;
}

function pastorInboxView() {
  const all = (S.state.reports || []).filter(r => !r._del).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.deptId).localeCompare(String(b.deptId)));
  const st = V.inboxFilter || 'all';
  const list = all.filter(r => st === 'all' ? true : r.status === st);
  let h = '<div class="page-head"><div><h2>주일보고 수신함</h2><p>부서별 제출 현황을 한눈에 봅니다</p></div></div>';
  const sub = all.filter(r => r.status === 'submitted').length;
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">';
  h += '<button class="chip big ' + (st === 'all' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="all">전체 ' + all.length + '</button>';
  h += '<button class="chip big ' + (st === 'submitted' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="submitted">확인 대기 ' + sub + '</button>';
  h += '<button class="chip big ' + (st === 'checked' ? 'coral' : 'gray') + '" data-act="inbox-filter" data-v="checked">확인 완료</button>';
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
      h += '<span class="tx"><b>' + esc(dept.name || '부서') + '</b><span>재적 ' + (cn.enrolled || 0) + ' · 출석 ' + (cn.present || 0) + ' · 결석 ' + (cn.absent || 0) + ' · 교사 ' + (cn.teacherPresent || 0) + '/' + (cn.teacherTotal || 0) + '</span></span>';
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
    h += '<button class="item" data-act="open-notice" data-id="' + esc(n.id) + '">';
    h += '<span class="av" style="background:' + esc(d.color || '#ffb4a2') + '33">' + (n.pinned ? '📌' : '📄') + '</span>';
    h += '<span class="tx"><b>' + esc(n.title) + '</b><span>' + esc(d.name || '') + (n.classId ? ' · ' + esc((classById(n.classId) || {}).name || '') : '') + ' · ' + timeAgo(n.at) + (can('notice.write') ? ' · 확인 ' + readers + '명' : '') + '</span></span>';
    h += '<span class="rt">' + (mine ? '<span class="chip mint">확인</span>' : '<span class="chip coral">새 알림</span>') + '</span></button>';
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
  h += '<button class="btn block" data-act="new-class" data-dept="' + esc(dept.id) + '">＋ ' + esc(dept.name) + ' 반 추가</button>';

  const unassigned = studentsOfDept(dept.id).filter(s => !s.classId || !cls.some(c => c.id === s.classId));
  cls.forEach(c => {
    const studs = studentsOfClass(c.id);
    const teachers = (c.teacherNames || []).join(', ');
    h += '<div class="card" style="margin-top:12px"><h3>' + esc(c.name) + ' <small>' + studs.length + '명' + (teachers ? ' · ' + esc(teachers) : '') + '</small><span class="sp"></span><button class="btn sm" data-act="edit-class" data-id="' + esc(c.id) + '">반 수정</button></h3>';
    h += '<div class="list">';
    if (!studs.length) h += '<p class="muted" style="margin:0">학생이 없습니다.</p>';
    studs.forEach(s => {
      h += '<button class="item" data-act="edit-student" data-id="' + esc(s.id) + '"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + '</b><span>' + (s.birth ? esc(birthShort(s.birth)) + ' · ' : '') + esc(s.guardianName || '보호자 미등록') + '</span></span><span class="rt"><span class="chip gray">' + esc(s.gender === 'm' ? '남' : s.gender === 'f' ? '여' : '') + '</span></span></button>';
    });
    h += '</div>';
    h += '<button class="btn block sm" style="margin-top:8px" data-act="new-student" data-cls="' + esc(c.id) + '">＋ 학생 추가</button>';
    h += '</div>';
  });
  if (unassigned.length) {
    h += '<div class="card" style="margin-top:12px"><h3>반 미지정 <small>' + unassigned.length + '명</small></h3><div class="list">';
    unassigned.forEach(s => { h += '<button class="item" data-act="edit-student" data-id="' + esc(s.id) + '"><span class="av">' + esc((s.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(s.name) + '</b><span>반을 지정해 주세요</span></span></button>'; });
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
  if (!evs.length) return h + '<div class="card">' + emptyBox('🗓️', '등록된 일정이 없습니다') + '</div>';
  h += '<div class="sect-title">다가오는 일정</div>';
  if (!up.length) h += '<div class="card"><p class="muted" style="margin:0">예정된 일정이 없습니다.</p></div>';
  else up.forEach(e => {
    const d = deptById(e.deptId) || {};
    h += '<div class="card" style="padding:13px"><div class="row"><span class="chip coral big">' + esc(fmtShort(e.date)) + '</span><span class="chip big ' + '">' + esc((d.emoji || '') + ' ' + (d.name || '전체')) + '</span><span class="sp"></span>' + (can('schedule.manage') ? '<button class="btn sm" data-act="edit-event" data-id="' + esc(e.id) + '">수정</button>' : '') + '</div>';
    h += '<div style="font-weight:800;font-size:15px;margin:8px 0 2px">' + esc(e.title) + '</div>';
    h += '<div class="muted">' + esc(fmtDate(e.date)) + (e.time ? ' ' + esc(e.time) : '') + (e.place ? ' · ' + esc(e.place) : '') + '</div>';
    if (e.desc) h += '<div class="pre" style="margin-top:6px">' + esc(e.desc) + '</div>';
    h += '</div>';
  });
  if (past.length) {
    h += '<div class="sect-title">지난 일정</div><div class="list">';
    past.slice(0, 6).forEach(e => { h += '<div class="item" style="opacity:.72"><span class="av">🗓️</span><span class="tx"><b>' + esc(e.title) + '</b><span>' + esc(fmtDate(e.date)) + '</span></span></div>'; });
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
    h += '<div class="item"><span class="av">' + esc((a.rec.name || '?').slice(0, 1)) + '</span><span class="tx"><b>' + esc(a.rec.name) + (a.rec.active === false ? ' <span class="chip rose">중지</span>' : '') + (pend ? ' <span class="chip amber">' + (a.status === 'rejected' ? '반려' : (a.status === 'approved' ? '승인됨·첫 로그인 전' : '가입 대기')) + '</span>' : '') + '</b><span>' + esc(roles || '역할 없음') + (depts ? ' · ' + esc(depts) : '') + '</span></span><span class="rt">' + (pend ? '<button class="btn sm" data-act="nav" data-screen="approve">승인 화면</button>' : '<button class="btn sm" data-act="edit-user" data-uid="' + esc(a.uid) + '">수정</button>') + '</span></div>';
  });
  h += '</div>';
  h += '<p class="muted" style="margin-top:10px">아이디는 저장되지 않고 해시로만 보관됩니다. 비밀번호는 계정마다 따로 감싼 형태로만 보관됩니다.</p>';
  return h;
}

function adminDepts() {
  const all = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  let h = '<div class="row" style="margin-bottom:10px"><button class="btn primary sm" data-act="new-dept">＋ 부서 추가</button></div><div class="list">';
  all.forEach(d => {
    const n = studentsOfDept(d.id).length;
    h += '<div class="item"><span class="av" style="background:' + esc(d.color) + '44">' + esc(d.emoji || '📖') + '</span><span class="tx"><b>' + esc(d.name) + '</b><span>학생 ' + n + '명 · 반 ' + classesOfDept(d.id).length + '개</span></span><span class="rt"><button class="btn sm" data-act="edit-dept" data-id="' + esc(d.id) + '">수정</button></span></div>';
  });
  h += '</div>';
  h += '<p class="muted" style="margin-top:10px">부서를 추가하면 출석·주일보고·알림장에 바로 나타납니다.</p>';
  return h;
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
  if (roleDef(S.roleKey).base === 'parent') h += '<div class="kv"><span>자녀</span><b>' + esc(myStudents().map(s => s.name).join(', ') || '미연결') + '</b></div>';
  h += '</div>';

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
  if (can('notice.read') && roleDef(S.roleKey).base === 'parent') {
    if (mine) h += '<div class="banner mint" style="margin-top:12px">✅ ' + esc(new Date(Number(mine)).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '에 확인했습니다</div>';
    else h += '<button class="btn primary block" style="margin-top:12px" data-act="ack-notice" data-id="' + esc(n.id) + '">확인했습니다</button>';
  }
  if (can('notice.write')) {
    h += '<div class="divider"></div><div class="row"><b style="font-size:13px">확인 ' + readers.length + '명</b><span class="sp"></span>';
    h += '<button class="btn sm" data-act="del-notice" data-id="' + esc(n.id) + '">삭제</button></div>';
    if (readers.length) h += '<div class="muted" style="margin-top:6px">' + esc(readers.map(u => nameOfUid(u)).join(', ')) + '</div>';
  }
  openModal('알림장', h);
}

function userModal(acct) {
  const isNew = !acct;
  const rec = acct ? acct.rec : { name: '', roles: ['teacher'], depts: [], classes: [], students: [], active: true };
  V.editUser = { uid: acct ? acct.uid : '', id: rec.id || '', roles: (rec.roles || []).slice(), depts: (rec.depts || []).slice(), classes: (rec.classes || []).slice(), students: (rec.students || []).slice(), salt: acct ? acct.salt : '', wrap: acct ? acct.wrap : '', active: rec.active !== false };
  let h = '';
  h += '<div class="field"><label>아이디 ' + (isNew ? '' : '<span class="muted">(변경 불가)</span>') + '</label><input id="uId" value="' + esc(rec.id || '') + '" ' + (isNew ? 'placeholder="예: kim / teacher2"' : 'readonly') + ' autocomplete="off"></div>';
  h += '<div class="field"><label>이름</label><input id="uName" value="' + esc(rec.name || '') + '" placeholder="예: 김은혜"></div>';
  h += '<div class="field"><label>비밀번호 ' + (isNew ? '' : '<span class="muted">(바꿀 때만 입력)</span>') + '</label><input id="uPw" type="password" placeholder="8자 이상" autocomplete="new-password"></div>';
  if (!isNew) h += '<p class="hint" style="margin:-4px 0 10px">비워 두면 기존 비밀번호가 그대로 유지됩니다.</p>';
  h += '<div class="field"><label>역할 (여러 개 선택 가능)</label>' + roleChecks(rec.roles, 'user') + '</div>';
  h += '<div class="field"><label>담당 부서</label>' + deptChecks(rec.depts) + '<div class="hint">목회자·관리자는 지정하지 않으면 전체 부서를 봅니다.</div></div>';
  h += '<div class="field"><label>담당 반</label><div class="row wrap" style="gap:6px">';
  const cls = (S.state.classes || []).filter(c => !c._del);
  if (!cls.length) h += '<span class="muted">등록된 반이 없습니다.</span>';
  cls.forEach(c => { const on = (rec.classes || []).indexOf(c.id) >= 0; h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-class" data-id="' + esc(c.id) + '">' + esc((deptById(c.deptId) || {}).name || '') + ' ' + esc(c.name) + '</button>'; });
  h += '</div></div>';
  h += '<div class="field"><label>자녀 연결 (학부모용)</label><div class="row wrap" style="gap:6px">';
  const studs = (S.state.students || []).filter(s => !s._del);
  if (!studs.length) h += '<span class="muted">등록된 학생이 없습니다.</span>';
  studs.slice(0, 60).forEach(s => { const on = (rec.students || []).indexOf(s.id) >= 0; h += '<button type="button" class="chip big ' + (on ? 'coral' : 'gray') + '" data-act="toggle-student" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>'; });
  h += '</div></div>';
  h += '<div class="field"><label>상태</label><button type="button" class="chip big ' + (rec.active === false ? 'gray' : 'mint') + '" data-act="toggle-active">' + (rec.active === false ? '사용 중지' : '사용 중') + '</button></div>';
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
  const cls = (S.state.classes || []).filter(c => !c._del);
  let h = '';
  h += '<div class="field"><label>이름</label><input id="sName" value="' + esc(st.name) + '" placeholder="학생 이름"></div>';
  h += '<div class="grid2"><div class="field"><label>생년월일</label><input id="sBirth" type="date" value="' + esc(st.birth) + '"></div>';
  h += '<div class="field"><label>성별</label><select id="sGender">' + opts([['', '선택'], ['m', '남'], ['f', '여']], st.gender) + '</select></div></div>';
  h += '<div class="field"><label>반</label><select id="sClass">' + opts([['', '반 미지정']].concat(cls.map(c => [c.id, ((deptById(c.deptId) || {}).name || '') + ' ' + c.name])), st.classId) + '</select></div>';
  h += '<div class="grid2"><div class="field"><label>보호자</label><input id="sGuardian" value="' + esc(st.guardianName || '') + '" placeholder="학부모 이름"></div>';
  h += '<div class="field"><label>연락처</label><input id="sPhone" type="tel" value="' + esc(st.guardianPhone || '') + '" placeholder="010-0000-0000"></div></div>';
  h += '<div class="field"><label>메모</label><input id="sNote" value="' + esc(st.note || '') + '"></div>';
  h += '<div class="row"><span class="sp"></span>' + (isNew ? '' : '<button class="btn" style="color:#c33e5f" data-act="del-student" data-id="' + esc(s.id) + '">삭제</button>') + '<button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="save-student" data-id="' + esc(isNew ? '' : s.id) + '">저장</button></div>';
  openModal(isNew ? '학생 추가' : '학생 정보', h, { focus: 'sName' });
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
