/* 덕신교회 부서업무 — 연도·진급 / 계정 상태 / 주일보고 반려 요청
   기존 core.js·ui.js·features.js·extra.js·app.js 위에 얹습니다.
   · 연도마다 학생·반·출석·주일보고·월별계획표·회계·일반 일정을 따로 봅니다.
   · 연말 진급 마법사로 새 학년도 명단을 만들고 교사 이동까지 함께 처리합니다.
   · 계정은 정상 / 일시중지 / 차단 상태를 가질 수 있고 기록은 그대로 남습니다. */
'use strict';

/* ================= 연도 선택 ================= */
function yearMenuModal() {
  const yrs = availableYears();
  let h = '<div class="banner sky">연도를 바꾸면 <b>출석·주일보고·월별계획표·회계·일정·학생 명단</b>이 그 해 자료로 바뀝니다. 지난 연도 자료는 지워지지 않고 그대로 남습니다.</div>';
  h += '<div class="list">';
  yrs.forEach(y => {
    const stu = allStudentsIn(y).length;
    const rep = (S.state.reports || []).filter(r => !r._del && recYear(r) === y).length;
    const led = (S.state.ledger || []).filter(e => !e._del && recYear(e) === y).length;
    h += '<button class="item" data-act="year-pick" data-v="' + y + '"><span class="av" style="background:' + (y === curYear() ? '#ffe9e3' : '#f4efec') + '">📅</span><span class="tx"><b>' + y + '년' + (y === curYear() ? ' <span class="chip coral">보고 있는 중</span>' : '') + '</b><span>학생 ' + stu + '명 · 주일보고 ' + rep + '건 · 회계 ' + led + '건</span></span><span class="rt">' + (y === curYear() ? '' : '<span class="chip gray">열기</span>') + '</span></button>';
  });
  h += '</div>';
  if (can('year.manage')) h += '<button class="btn primary block" style="margin-top:12px" data-act="go-years">🎓 연도·진급 관리</button>';
  openModal('연도 선택', h);
}

/* ================= 연도·진급 화면 ================= */
function yearsView() {
  if (!can('year.manage')) return '<div class="card">' + emptyBox('🔒', '연도·진급은 관리자·교육부서담당만 쓸 수 있습니다') + '</div>';
  const y = curYear();
  const depts = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  const yrs = availableYears();
  let h = subHead('연도·진급', '연도별 자료를 나누고, 연말에 학생·교사를 새 학년도로 옮깁니다',
    '<button class="btn sm" data-act="year-menu">📅 연도 선택</button>');

  /* 지금 연도 요약 */
  h += '<div class="card"><h3>📅 ' + y + '년' + (y === Number(ymd().slice(0, 4)) ? ' <small>올해</small>' : '') + '<span class="sp"></span><small>보고 있는 중</small></h3>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">' + yrs.map(v => '<button class="chip big ' + (v === y ? 'coral' : 'gray') + '" data-act="year-pick" data-v="' + v + '">' + v + '년</button>').join('') + '</div>';
  h += '<div class="kv"><span>학생</span><b>' + allStudentsIn(y).length + '명</b></div>';
  h += '<div class="kv"><span>반</span><b>' + (S.state.classes || []).filter(c => !c._del && inYear(c)).length + '개</b></div>';
  h += '<div class="kv"><span>출석 기록</span><b>' + (S.state.attendance || []).filter(a => !a._del && inYear(a)).length + '건</b></div>';
  h += '<div class="kv"><span>주일보고</span><b>' + (S.state.reports || []).filter(r => !r._del && inYear(r)).length + '건</b></div>';
  h += '<div class="kv"><span>월별계획표</span><b>' + (S.state.plans || []).filter(p => !p._del && inYear(p)).length + '건</b></div>';
  h += '<div class="kv"><span>회계</span><b>' + (S.state.ledger || []).filter(e => !e._del && inYear(e)).length + '건</b></div>';
  h += '</div>';

  /* 새 연도 만들기 */
  h += '<div class="card"><h3>🗓️ 새 연도 만들기</h3>';
  h += '<p class="muted" style="margin:0 0 8px">새 연도를 미리 만들어 두면 그 해 자료를 따로 쌓을 수 있습니다. (학생은 진급 마법사로 옮깁니다)</p>';
  h += '<div class="row" style="gap:8px"><input id="newYear" type="number" min="2026" max="2100" value="' + (Math.max.apply(null, yrs.concat([y])) + 1) + '" style="max-width:130px"><button class="btn primary" data-act="year-add">연도 만들기</button></div>';
  h += '</div>';

  /* 진급 마법사 */
  h += '<div class="card flat" style="border:1.5px solid #ded3f7;background:#faf8ff"><h3>🎓 연말 진급·새 학년도 이관</h3>';
  h += '<p class="muted" style="margin:0 0 10px">학생을 한 학년 위 부서로 옮기고, 교사 이동까지 한 번에 처리합니다. 옮긴 뒤 각 부서 담당자가 새 연도에서 반을 나누면 됩니다.</p>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:8px">' + depts.map((d, i) => '<span class="chip big">' + esc((d.emoji || '') + ' ' + d.name) + (depts[i + 1] ? ' → ' + esc(depts[i + 1].name) : ' → 졸업') + '</span>').join('') + '</div>';
  h += '<button class="btn primary block" data-act="grade-open">' + (V.gradeOpen ? '진급 마법사 접기' : '진급 마법사 열기') + '</button>';
  h += '</div>';

  if (V.gradeOpen) h += gradeWizardHtml(depts);
  return h;
}

function gradeWizardHtml(depts) {
  const srcYear = curYear();
  const ny = Number(V.gradeYear) || (Math.max.apply(null, availableYears().concat([srcYear])) + 1);
  V.gradeYear = ny;
  const lastMode = V.gradeLast || 'graduate';
  let h = '<div class="card"><h3>🎓 ' + srcYear + '년 → 새 학년도 이관</h3>';
  h += '<div class="grid2"><div class="field"><label>새 연도</label><input id="gradeYear" type="number" min="' + (srcYear + 1) + '" max="2100" value="' + ny + '" data-change="grade-year"></div>';
  h += '<div class="field"><label>' + srcYear + '년 학생</label><input value="' + allStudentsIn(srcYear).length + '명" readonly></div></div>';

  h += '<div class="sect-title">① 학생 진급</div><div class="card flat" style="padding:8px 12px">';
  depts.forEach((d, i) => {
    const n = studentsOfDeptIn(d.id, srcYear).length;
    const next = depts[i + 1];
    h += '<div class="kv"><span>' + esc((d.emoji || '') + ' ' + d.name) + ' <b>' + n + '명</b></span><b>' + (next ? '→ ' + esc((next.emoji || '') + ' ' + next.name) : (lastMode === 'keep' ? '→ ' + esc(d.name) + ' 유지' : '→ 졸업(명단 제외)')) + '</b></div>';
  });
  h += '</div>';
  if (depts.length) {
    const last = depts[depts.length - 1];
    h += '<div class="field" style="margin-top:8px"><label>' + esc(last.name) + ' 처리</label><div class="row wrap" style="gap:6px">';
    h += '<button type="button" class="chip big ' + (lastMode === 'graduate' ? 'coral' : 'gray') + '" data-act="grade-last" data-v="graduate">🎓 졸업 (명단에서 제외)</button>';
    h += '<button type="button" class="chip big ' + (lastMode === 'keep' ? 'coral' : 'gray') + '" data-act="grade-last" data-v="keep">' + esc(last.name) + '에 그대로 두기</button>';
    h += '</div><div class="hint">졸업한 학생의 지난 기록은 그대로 남고, 새 연도 명단에서만 빠집니다.</div></div>';
  }
  const clsMode = V.gradeClasses || 'none';
  h += '<div class="field"><label>새 연도 반</label><div class="row wrap" style="gap:6px">';
  h += '<button type="button" class="chip big ' + (clsMode === 'none' ? 'coral' : 'gray') + '" data-act="grade-classes" data-v="none">반은 새로 만들기 (권장)</button>';
  h += '<button type="button" class="chip big ' + (clsMode === 'keep' ? 'coral' : 'gray') + '" data-act="grade-classes" data-v="keep">지난해 반 이름 그대로</button>';
  h += '</div><div class="hint">새로 만들면 학생은 반 미지정으로 옮기고, 각 부서 담당자가 새 연도에서 반을 나눕니다.</div></div>';

  h += '<div class="sect-title">② 교사 이동</div>';
  if (V.gradeAccts === undefined) {
    loadGradeAccounts();
    h += '<div class="card flat"><p class="muted" style="margin:0">교사 계정을 불러오는 중…</p></div>';
  } else if (!V.gradeAccts.length) {
    h += '<div class="card flat"><p class="muted" style="margin:0">등록된 교사 계정이 없습니다.</p></div>';
  } else {
    h += '<p class="hint" style="margin:0 0 6px">새 학년도에 담당할 부서를 골라 주세요. 고르지 않으면 지금 부서 그대로 둡니다.</p>';
    V.gradeTeachers = V.gradeTeachers || {};
    h += '<div class="card flat" style="padding:8px 12px">';
    V.gradeAccts.forEach(a => {
      const cur = accountDeptIds(a)[0] || '';
      const pick = V.gradeTeachers[a.uid] !== undefined ? V.gradeTeachers[a.uid] : cur;
      h += '<div style="padding:7px 0;border-bottom:1px dashed var(--line)"><div class="row" style="gap:8px"><b style="font-size:13px">' + esc(a.rec.name) + '</b><span class="muted">@' + esc(a.rec.id) + '</span><span class="sp" style="flex:1"></span><span class="muted">' + esc((deptById(cur) || {}).name || '부서 미지정') + '</span></div>';
      h += '<div class="row wrap" style="gap:5px;margin-top:5px">';
      depts.forEach(d => {
        h += '<button type="button" class="chip big ' + (pick === d.id ? 'coral' : 'gray') + '" data-act="grade-teacher" data-uid="' + esc(a.uid) + '" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>';
      });
      h += '<button type="button" class="chip big ' + (!pick ? 'coral' : 'gray') + '" data-act="grade-teacher" data-uid="' + esc(a.uid) + '" data-id="">그대로</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }

  h += '<div class="banner coral" style="margin-top:10px">진급을 실행하면 <b>' + ny + '년</b> 명단이 새로 만들어지고, 보고 있는 연도가 ' + ny + '년으로 바뀝니다. 같은 연도에 이미 자료가 있으면 실행되지 않습니다.</div>';
  h += '<button class="btn primary block" data-act="grade-run">🎓 ' + ny + '년으로 진급·이관 실행</button>';
  h += '</div>';
  return h;
}

function gradeRememberYear() {
  const el = document.getElementById('gradeYear');
  const n = el ? Number(el.value) : 0;
  if (n) V.gradeYear = n;
}

function loadGradeAccounts() {
  if (V.gradeLoading) return;
  V.gradeLoading = true;
  listAccounts().then(list => {
    V.gradeAccts = list.filter(a => a.status === 'active' && (a.rec.roles || []).some(r => ['teacher', 'edu'].indexOf(roleDef(r).base) >= 0));
    V.gradeErr = '';
  }).catch(e => {
    V.gradeAccts = [];
    V.gradeErr = '교사 계정을 불러오지 못했습니다: ' + ((e && e.message) || e);
  }).then(() => { V.gradeLoading = false; if (S.screen === 'years') renderApp(); });
}

async function runPromotion() {
  const depts = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!depts.length) return toast('부서가 없습니다', 'err');
  const srcYear = curYear();
  const ny = Number(val('gradeYear')) || Number(V.gradeYear);
  if (!ny || ny === srcYear) return toast('새 연도를 ' + (srcYear + 1) + '년 이후로 정해 주세요', 'err');
  if (yearHasData(ny)) return toast(ny + '년에는 이미 자료가 있습니다. 다른 연도를 골라 주세요', 'err');
  const lastMode = V.gradeLast || 'graduate';
  const keepClasses = V.gradeClasses === 'keep';
  let made = 0, grad = 0;
  const tag = '승급 ' + ny;

  depts.forEach((d, i) => {
    const next = depts[i + 1];
    studentsOfDeptIn(d.id, srcYear).forEach(s => {
      const person = s.personId || s.id;
      if (!next && lastMode !== 'keep') {
        if (s.promotedTo !== ny) { s.promotedTo = ny; s.graduatedAt = ny; touch(s); }
        grad++;
        return;
      }
      const deptId = next ? next.id : d.id;
      const copy = {
        id: 'st-' + Crypto.uid(), personId: person, name: s.name, birth: s.birth || '',
        birthType: birthTypeOf(s), birthLunar: s.birthLunar || '', gender: s.gender || '',
        deptId: deptId, classId: '', guardianName: s.guardianName || '', guardianPhone: s.guardianPhone || '',
        guardianUid: s.guardianUid || '', note: s.note || '', newcomer: false, active: true,
        year: ny, promotedFrom: s.id, joined: ny + '-03-01', u: Date.now()
      };
      S.state.students.push(copy);
      syncBirthEventOf('student', person, copy, deptId);
      made++;
    });
    /* 반 이름은 그대로 두고 새 연도 반을 만들어 두는 선택 */
    if (keepClasses) {
      classesOfDeptIn(d.id, srcYear).forEach(c => {
        S.state.classes.push({ id: 'cl-' + Crypto.uid(), name: c.name, deptId: c.deptId, note: c.note || '', order: c.order || 0, year: ny, u: Date.now() });
      });
    }
  });

  /* 교사 이동 */
  let moved = 0, failed = 0;
  const picks = V.gradeTeachers || {};
  for (const uid of Object.keys(picks)) {
    const to = picks[uid];
    if (!to) continue;
    try {
      const upd = await updateAccountRec(uid, rec => { rec.depts = [to]; rec.classes = []; });
      if (upd) syncBirthEventOf('account', uid, upd, upd.depts || []);
      moved++;
    } catch (e) { failed++; }
  }

  ensureYear(ny);
  await Sync.save();
  setYear(ny);
  V.gradeOpen = false;
  V.gradeTeachers = {};
  V.gradeAccts = undefined;
  V.dept = '';
  V.cls = '';
  S.screen = 'members';
  renderApp();
  toast(ny + '년 진급 완료 · 학생 ' + made + '명' + (grad ? ' · 졸업 ' + grad + '명' : '') + (moved ? ' · 교사 ' + moved + '명 이동' : '') + (failed ? ' · 교사 ' + failed + '명은 첫 로그인 뒤 지정' : ''), 'ok');
}

/* ================= 계정 상태 (정상 / 일시중지 / 차단) ================= */
async function accountStatusModal(uid) {
  toast('계정을 확인하는 중…');
  try {
    const row = await fetchAccount(uid);
    if (!row) return toast('계정을 찾지 못했습니다', 'err');
    const info = appRowInfo(row);
    if (info.kind !== 'active') return toast('아직 첫 로그인 전인 계정입니다. 본인이 한 번 로그인한 뒤 바꿀 수 있습니다', 'err');
    const rec = await Crypto.openJson(S.dek, JSON.parse(row.rec));
    V.acctStatus = { uid: uid, name: rec.name || '', status: accountStatusOf(rec), note: rec.statusNote || '' };
    renderAcctStatusModal();
  } catch (e) {
    toast((e && e.message) || '계정을 열지 못했습니다', 'err');
  }
}
function renderAcctStatusModal() {
  const a = V.acctStatus;
  if (!a) return;
  let h = '<div class="banner sky"><b>' + esc(a.name) + '</b> 계정의 상태를 바꿉니다. 기록은 그대로 남습니다.</div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">';
  [['normal', '정상', 'mint'], ['paused', '⏸ 일시중지', 'amber'], ['blocked', '⛔ 차단', 'rose']].forEach(x => {
    h += '<button type="button" class="chip big ' + (a.status === x[0] ? x[2] : 'gray') + '" data-act="acct-status-set" data-v="' + x[0] + '">' + x[1] + '</button>';
  });
  h += '</div>';
  h += '<div class="field"><label>사유 (선택)</label><input id="astNote" value="' + esc(a.note || '') + '" placeholder="예: 이사로 인한 일시중지"></div>';
  h += '<p class="hint">일시중지·차단된 계정은 로그인할 때 안내 문구와 함께 막힙니다. 필요하면 언제든 정상으로 되돌릴 수 있습니다.</p>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="acct-status-save">저장</button></div>';
  openModal('계정 상태', h);
}
async function saveAcctStatus() {
  const a = V.acctStatus;
  if (!a) return;
  const note = val('astNote');
  try {
    await updateAccountRec(a.uid, rec => { rec.status = a.status; rec.statusNote = note; rec.statusAt = Date.now(); });
    await Sync.save();
    V.accounts = null;
    V.staffAccts = null;
    closeModal();
    renderApp();
    toast('계정 상태를 ' + ACCOUNT_STATUS[a.status] + '(으)로 바꿨습니다', 'ok');
  } catch (e) {
    toast((e && e.message) || '저장하지 못했습니다', 'err');
  }
}

/* ================= 주일보고 반려 요청 ================= */
function reopenModal(id) {
  const rep = (S.state.reports || []).find(x => x.id === id);
  if (!rep) return;
  if (rep.status === 'checked') return toast('확인 완료된 보고서입니다. 목회자에게 직접 말씀해 주세요', 'err');
  const cur = reopenPending(rep) ? rep.reopen.reason : '';
  let h = '<div class="banner sky">' + esc((deptById(rep.deptId) || {}).name || '부서') + ' · ' + esc(fmtDate(rep.date)) + ' 보고서를 고쳐 써야 할 때 목회자에게 반려를 요청합니다.</div>';
  h += '<div class="field"><label>반려 요청 사유</label><textarea id="rqReason" placeholder="예: 결석자 명단이 빠졌습니다. 다시 작성하겠습니다.">' + esc(cur || '') + '</textarea></div>';
  h += '<div class="row"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="reopen-send" data-id="' + esc(id) + '">📩 반려 요청 보내기</button></div>';
  openModal('목회자에게 반려 요청', h, { focus: 'rqReason' });
}
async function sendReopen(id) {
  const why = val('rqReason');
  if (!why) return toast('사유를 적어 주세요', 'err');
  const rep = (S.state.reports || []).find(x => x.id === id);
  if (!rep) return;
  if (rep.status === 'checked') return toast('확인 완료된 보고서입니다', 'err');
  rep.reopen = { by: S.me.uid, byName: S.me.name, reason: why, at: Date.now(), done: false };
  touch(rep);
  await Sync.save();
  closeModal();
  renderApp();
  toast('목회자에게 반려 요청을 보냈습니다', 'ok');
}

/* ================= 동작 연결 ================= */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case 'year-menu': yearMenuModal(); return;
      case 'year-pick': {
        const y = Number(t.dataset.v);
        if (!y) return;
        closeModal();
        setYear(y);
        renderApp();
        toast(y + '년 자료로 바꿨습니다', 'ok');
        return;
      }
      case 'year-move': {
        const yrs = availableYears();
        const i = yrs.indexOf(curYear());
        const n = yrs[i + Number(t.dataset.v)];
        if (!n) return;
        setYear(n);
        renderApp();
        return;
      }
      case 'go-years': closeModal(); S.screen = 'years'; V.gradeOpen = false; renderApp(); return;
      case 'year-add': {
        const y = Number(val('newYear'));
        if (!y || y < 1900) return toast('연도를 숫자로 넣어 주세요', 'err');
        if (availableYears().indexOf(y) >= 0 && yearHasData(y)) return toast(y + '년에는 이미 자료가 있습니다', 'err');
        ensureYear(y);
        await Sync.save();
        setYear(y);
        renderApp();
        toast(y + '년을 만들었습니다. 이제 자료를 쌓으면 됩니다', 'ok');
        return;
      }
      case 'grade-open': V.gradeOpen = !V.gradeOpen; if (V.gradeOpen) { V.gradeYear = 0; V.gradeAccts = undefined; V.gradeClasses = 'none'; } renderApp(); return;
      case 'grade-last': gradeRememberYear(); V.gradeLast = t.dataset.v; renderApp(); return;
      case 'grade-classes': gradeRememberYear(); V.gradeClasses = t.dataset.v; renderApp(); return;
      case 'grade-teacher': {
        gradeRememberYear();
        V.gradeTeachers = V.gradeTeachers || {};
        V.gradeTeachers[t.dataset.uid] = t.dataset.id || '';
        renderApp();
        return;
      }
      case 'grade-run': {
        const depts = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
        const n = depts.reduce((s, d) => s + studentsOfDeptIn(d.id, curYear()).length, 0);
        const ny = Number(val('gradeYear')) || Number(V.gradeYear);
        confirmBox('진급·이관 실행', '학생 ' + n + '명을 ' + ny + '년 명단으로 옮기고, 보고 있는 연도를 ' + ny + '년으로 바꿉니다. 계속할까요?', '실행', runPromotion);
        return;
      }
      case 'bulk-class': bulkClassModal(t.dataset.dept || V.dept); return;
      case 'bc-pick': {
        if (!V.bulkClass) return;
        toggleIn(V.bulkClass.sids, t.dataset.sid);
        t.classList.toggle('coral');
        t.classList.toggle('gray');
        return;
      }
      case 'bc-save': {
        if (!V.bulkClass) return;
        const clsId = val('bcClass');
        const c = classById(clsId);
        if (!c) return toast('반을 골라 주세요', 'err');
        const n = V.bulkClass.sids.length;
        V.bulkClass.sids.forEach(sid => {
          const s = (S.state.students || []).find(x => x.id === sid);
          if (!s) return;
          s.classId = c.id; s.deptId = c.deptId; touch(s);
        });
        await Sync.save();
        closeModal();
        V.bulkClass = null;
        renderApp();
        toast(n + '명을 ' + c.name + '으로 지정했습니다', 'ok');
        return;
      }
      case 'acct-status': await accountStatusModal(t.dataset.uid); return;      case 'acct-status-set': {
        if (!V.acctStatus) return;
        V.acctStatus.status = t.dataset.v;
        V.acctStatus.note = val('astNote');
        renderAcctStatusModal();
        return;
      }
      case 'acct-status-save': await saveAcctStatus(); return;
      case 'reopen-report': reopenModal(t.dataset.id); return;      case 'reopen-send': await sendReopen(t.dataset.id); return;
      case 'stat-period': V.statPeriod = t.dataset.v; renderApp(); return;
      case 'period-print': printPeriodStats(V.statPeriod || 'month'); return;
      case 'my-birth-type': V.myBirthType = t.dataset.v; renderApp(); return;
      case 'u-birth-type': {
        if (!V.editUser) return;
        V.editUser.birthType = t.dataset.v;
        document.querySelectorAll('[data-act="u-birth-type"]').forEach(b => { b.classList.toggle('coral', b.dataset.v === t.dataset.v); b.classList.toggle('gray', b.dataset.v !== t.dataset.v); });
        const lb = document.getElementById('uBirthLabel');
        if (lb) lb.textContent = t.dataset.v === 'lunar' ? '생일 (음력)' : '생일 (양력)';
        return;
      }
      case 's-birth-type': {
        V.stuBirthType = t.dataset.v;
        document.querySelectorAll('[data-act="s-birth-type"]').forEach(b => { b.classList.toggle('coral', b.dataset.v === t.dataset.v); b.classList.toggle('gray', b.dataset.v !== t.dataset.v); });
        const lb = document.getElementById('sBirthLabel');
        if (lb) lb.textContent = t.dataset.v === 'lunar' ? '생년월일 (음력)' : '생년월일 (양력)';
        return;
      }
      case 'u-status': {
        if (!V.editUser) return;
        V.editUser.status = t.dataset.v;
        const noteEl = document.getElementById('uStatusNote');
        V.editUser.statusNote = noteEl ? noteEl.value : (V.editUser.statusNote || '');
        document.querySelectorAll('[data-act="u-status"]').forEach(b => {
          const on = b.dataset.v === t.dataset.v;
          b.classList.toggle('mint', on && t.dataset.v === 'normal');
          b.classList.toggle('amber', on && t.dataset.v === 'paused');
          b.classList.toggle('rose', on && t.dataset.v === 'blocked');
          b.classList.toggle('gray', !on);
        });
        return;
      }
      case 'signup-birth-type': V.signupBirthType = t.dataset.v; signupModal(); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});
