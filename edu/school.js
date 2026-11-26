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

/* ================= 연도 삭제 ================= */
const YEAR_DATA_KEYS = [
  ['students', '학생', '명'], ['classes', '반', '개'], ['attendance', '출석', '건'],
  ['reports', '주일보고', '건'], ['plans', '월별계획표', '건'], ['ledger', '회계', '건'], ['events', '일정', '건']
];

/* 그 해에 들어 있는 자료 건수 (생일 자동 일정은 사람 기록이라 빼고 셉니다) */
function yearCounts(y) {
  y = Number(y);
  return YEAR_DATA_KEYS.map(k => ({
    key: k[0], label: k[1], unit: k[2],
    n: (S.state[k[0]] || []).filter(r => {
      if (!r || r._del || recYear(r) !== y) return false;
      if (k[0] === 'events' && r.auto === 'birth') return false;
      return true;
    }).length
  }));
}
function yearCountsText(list) {
  const on = (list || []).filter(c => c.n > 0);
  if (!on.length) return '자료 없음(비어 있음)';
  return on.map(c => c.label + ' ' + c.n + c.unit).join(' · ');
}
/* 삭제할 수 없는 연도인지 — 마지막 한 개, 기본 연도, 이미 지운 연도 */
function yearDeleteBlock(y) {
  const yrs = availableYears();
  if (yrs.indexOf(Number(y)) < 0) return '이미 삭제된 연도입니다';
  if (yrs.length <= 1) return '연도가 하나뿐이라 삭제할 수 없습니다';
  if (Number(y) === FIRST_YEAR) return FIRST_YEAR + '년은 기본 연도라 삭제할 수 없습니다';
  return '';
}
function yearDeleteModal() {
  const yrs = availableYears();
  let h = '<div class="banner sky">연도를 삭제하면 그 연도의 <b>학생·반·출석·주일보고·월별계획표·회계·일정</b>이 함께 정리됩니다. 다른 연도 자료는 그대로 남습니다.</div>';
  h += '<div class="list">';
  yrs.forEach(y => {
    const cs = yearCounts(y);
    const total = cs.reduce((a, b) => a + b.n, 0);
    const block = yearDeleteBlock(y);
    h += '<div class="item"><span class="av" style="background:' + (total ? '#ffe9e3' : '#f4efec') + '">📅</span>';
    h += '<span class="tx"><b>' + y + '년' + (y === curYear() ? ' <span class="chip coral">보고 있는 중</span>' : '') + '</b><span style="white-space:normal;line-height:1.45">' + esc(total ? yearCountsText(cs) : '자료 없음 (빈 연도 — 바로 지울 수 있습니다)') + '</span></span>';
    h += '<span class="rt">' + (block ? '<span class="chip gray">삭제 불가</span>' : '<button class="btn sm" data-act="year-del" data-v="' + y + '">🗑 삭제</button>') + '</span></div>';
  });
  h += '</div>';
  h += '<p class="hint">' + (yrs.length <= 1 ? '연도가 하나뿐이라 지금은 삭제할 수 없습니다. ' : '') + FIRST_YEAR + '년은 기본 연도라 삭제할 수 없습니다. 빈 연도는 확인 한 번으로, 자료가 있는 연도는 건수를 보여 주고 한 번 더 확인한 뒤 삭제됩니다.</p>';
  h += '<div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn" data-act="modal-close">닫기</button></div>';
  openModal('연도 삭제', h);
}

/* 처음 누를 때: 빈 연도는 바로 확인, 자료가 있으면 건수를 보여 주고 한 번 더 확인합니다 */
function requestYearDelete(y) {
  y = Number(y);
  if (!y) return;
  const block = yearDeleteBlock(y);
  if (block) return toast(block, 'err');
  const cs = yearCounts(y);
  const total = cs.reduce((a, b) => a + b.n, 0);
  if (!total) {
    confirmBox('연도 삭제', y + '년은 비어 있습니다.\n목록에서 삭제할까요?', '삭제', () => doDeleteYear(y));
    return;
  }
  confirmBox('연도 삭제', y + '년에 ' + yearCountsText(cs) + '이(가) 있습니다.\n삭제하면 이 연도의 자료가 함께 정리되고, 다른 연도 자료는 그대로 남습니다.', '계속', () => {
    confirmBox('정말 삭제할까요?', y + '년의 ' + yearCountsText(cs) + '을(를) 지웁니다.\n되돌릴 수 없습니다.', '삭제', () => doDeleteYear(y));
  });
}

async function doDeleteYear(y) {
  y = Number(y);
  if (!y) return;
  const block = yearDeleteBlock(y);
  if (block) return toast(block, 'err');
  const wasCur = curYear() === y;
  const rest = availableYears().filter(v => v !== y);
  const now = Date.now();
  let removed = 0;
  const persons = {};
  (S.state.students || []).forEach(s => {
    if (!s || s._del || recYear(s) !== y) return;
    persons[s.personId || s.id] = true;
  });
  YEAR_DATA_KEYS.forEach(k => {
    (S.state[k[0]] || []).forEach(r => {
      if (!r || r._del || recYear(r) !== y) return;
      if (k[0] === 'events' && r.auto === 'birth') return;   /* 생일은 사람 기록이라 아래에서 따로 처리 */
      r._del = true; touch(r); removed++;
    });
  });
  /* 연도 목록에서 지우고, 다른 기기에서 되살아나지 않도록 표시를 남깁니다 */
  S.state.years = S.state.years || [];
  let ent = S.state.years.find(x => Number(x && x.year) === y);
  if (!ent) { ent = { year: y }; S.state.years.push(ent); }
  ent._del = true; ent.deletedAt = now; ent.u = now;
  /* 보고 있던 연도를 지웠으면 남은 연도로 옮깁니다 (가까운 아래 연도 우선) */
  let picked = 0;
  if (wasCur) {
    const lower = rest.filter(v => v < y);
    picked = lower.length ? Math.max.apply(null, lower) : Math.min.apply(null, rest);
    if (picked) setYear(picked);
  }
  /* 같은 사람이 다른 연도에 남아 있으면 생일 일정을 그대로 살립니다 */
  Object.keys(persons).forEach(pid => {
    const alive = (S.state.students || []).find(s => s && !s._del && (s.personId || s.id) === pid);
    try {
      if (alive) syncBirthEventOf('student', pid, alive, alive.deptId);
      else { const ev = birthEventOf('student', pid); if (ev) { ev._del = true; touch(ev); } }
    } catch (e) { }
  });
  V.rollYear = 0;
  V.rollOpen = false;
  V.promoteOpen = false;
  V.promoSel = {};
  V.gradeTeachers = {};
  await Sync.save();
  closeModal();
  renderApp();
  toast(y + '년을 삭제했습니다' + (removed ? ' · 자료 ' + removed + '건 정리' : '') + (picked ? ' · ' + picked + '년으로 바꿨습니다' : ''), 'ok');
}

/* ================= 연도·진급 화면 ================= */
function yearsView() {
  if (!can('year.manage')) return '<div class="card">' + emptyBox('🔒', '연도·진급은 관리자·교육부서담당만 쓸 수 있습니다') + '</div>';
  const y = curYear();
  const depts = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  const yrs = availableYears();
  let h = subHead('연도·진급', '연도별 자료를 나누고, 연말에 학생·교사를 새 학년도로 옮깁니다',
    '<button class="btn sm" data-act="year-menu">📅 연도 선택</button>');
  h += '<div class="banner mint">처음이시면 — ① <b>[1️⃣ 연도 바꾸기]</b>에서 새 연도를 확인하고 실행하면 그 해 명단이 만들어집니다. ② 잘못 만든 연도는 <b>[🗑 연도 삭제]</b>로 지운 뒤 다시 하면 됩니다.</div>';

  /* 지금 연도 요약 */
  h += '<div class="card"><h3>📅 ' + y + '년' + (y === Number(ymd().slice(0, 4)) ? ' <small>올해</small>' : '') + '<span class="sp"></span><small>보고 있는 중</small></h3>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:8px">' + yrs.map(v => '<button class="chip big ' + (v === y ? 'coral' : 'gray') + '" data-act="year-pick" data-v="' + v + '">' + v + '년</button>').join('') + '</div>';
  h += '<div class="row" style="gap:6px;margin-bottom:10px"><button class="btn sm" data-act="year-del-open">🗑 연도 삭제</button><span class="muted" style="font-size:11.5px">잘못 만든 연도는 여기서 지울 수 있습니다</span></div>';
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
  h += '<p class="hint" style="margin:6px 0 0">이미 만들어 둔 연도: ' + yrs.map(v => v + '년').join(', ') + '. 새 연도는 아직 없는 해로 정해 주세요.</p>';
  h += '</div>';

  /* 연말 진급 — 1차 연도 변경, 2차 부서 변경 */
  h += '<div class="card flat" style="border:1.5px solid #ded3f7;background:#faf8ff"><h3>🎓 연말 진급 — 1차 연도, 2차 부서</h3>';
  h += '<p class="muted" style="margin:0 0 8px">연도가 바뀌면 나이·학년이 한 살 올라갑니다. 먼저 <b>1차</b>로 새 연도 명단을 만들고, <b>2차</b>에서 그 해 나이·학년에 맞춰 부서를 바꿉니다.</p>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:8px">' + depts.map((d, i) => '<span class="chip big">' + esc((d.emoji || '') + ' ' + d.name) + (depts[i + 1] ? ' → ' + esc(depts[i + 1].name) : ' → 🎓 졸업') + '</span>').join('') + '</div>';
  h += '<p class="hint" style="margin:0 0 8px">유치부는 7세까지 · 초등부는 초6까지 · 청소년부는 고3까지입니다.</p>';
  h += '<div class="row wrap" style="gap:6px"><button class="btn ' + (V.rollOpen ? 'dark' : 'primary') + '" data-act="roll-open">1️⃣ 연도 바꾸기</button><button class="btn ' + (V.promoteOpen ? 'dark' : 'primary') + '" data-act="promo-open">2️⃣ 부서 진급</button></div>';
  h += '</div>';
  if (V.rollOpen) h += rollCardHtml(depts);
  if (V.promoteOpen) h += promoteCardHtml(depts);
  return h;
}

/* ================= 1차: 연도 바꾸기 (명단·반 복사, 부서는 그대로) ================= */
/* 1차 연도 바꾸기 기본값 — 바로 다음 해가 이미 만들어져 있고 비어 있으면 그 해를 그대로 씁니다.
   다음 해에 이미 자료가 들어 있을 때만 그 뒤 연도를 제안합니다. */
function rollSuggestYear(srcYear) {
  const yrs = availableYears();
  let y = Number(srcYear) + 1;
  for (let i = 0; i < 30; i++) {
    if (!yearHasData(y)) return { year: y, exists: yrs.indexOf(y) >= 0 };
    y++;
  }
  return { year: y, exists: false };
}

function rollCardHtml(depts) {
  const srcYear = curYear();
  const sug = rollSuggestYear(srcYear);
  const ny = Number(V.rollYear) || sug.year;
  V.rollYear = ny;
  const nyExists = availableYears().indexOf(ny) >= 0;
  const nyHasData = yearHasData(ny);
  const nextExistsEmpty = availableYears().indexOf(srcYear + 1) >= 0 && !yearHasData(srcYear + 1);
  const clsMode = V.rollClasses || 'keep';
  const total = depts.reduce((n, d) => n + studentsOfDeptIn(d.id, srcYear).length, 0);
  let h = '<div class="card" style="margin-top:10px"><h3>1️⃣ ' + srcYear + '년 → 새 연도</h3>';
  h += '<div class="banner sky">연도만 먼저 바꿉니다. 학생은 <b>지금 부서 그대로</b> 새 연도 명단으로 옮겨지고, 나이·학년만 한 살 올라갑니다. 부서 이동은 2차에서 합니다.</div>';
  if (nyExists && !nyHasData) h += '<div class="banner mint">✅ <b>' + ny + '년</b>은 이미 만들어 둔 연도이고 비어 있습니다. 그대로 ' + ny + '년으로 명단을 옮기면 됩니다.</div>';
  else if (nyHasData) h += '<div class="banner coral">⚠️ <b>' + ny + '년</b>에는 이미 자료가 있어 실행되지 않습니다. ' + ny + '년을 지우고 다시 진행하려면 위 <b>[🗑 연도 삭제]</b>를 눌러 주세요.</div>';
  else if (nextExistsEmpty && ny !== srcYear + 1) h += '<div class="banner mint">✅ ' + (srcYear + 1) + '년이 비어 있어 그 해로 옮길 수 있습니다. 아래 <b>새 연도</b> 칸에 ' + (srcYear + 1) + '을 넣어 주세요.</div>';
  else if (ny !== srcYear + 1) h += '<div class="banner amber">' + (srcYear + 1) + '년에 이미 자료가 있어 <b>' + ny + '년</b>을 제안했습니다. 다른 연도로 옮기려면 아래 칸에서 바꾸세요.</div>';
  h += '<div class="grid2"><div class="field"><label>새 연도</label><input id="rollYear" type="number" min="' + (srcYear + 1) + '" max="2100" value="' + ny + '"></div>';
  h += '<div class="field"><label>' + srcYear + '년 학생</label><input value="' + total + '명" readonly></div></div>';
  h += '<div class="card flat" style="padding:8px 12px">';
  depts.forEach(d => {
    h += '<div class="kv"><span>' + esc((d.emoji || '') + ' ' + d.name) + '</span><b>' + studentsOfDeptIn(d.id, srcYear).length + '명 → ' + esc(d.name) + ' (부서 유지)</b></div>';
  });
  h += '</div>';
  h += '<div class="field"><label>새 연도 반</label><div class="row wrap" style="gap:6px">';
  h += '<button type="button" class="chip big ' + (clsMode === 'keep' ? 'coral' : 'gray') + '" data-act="roll-classes" data-v="keep">지난해 반 이름 그대로</button>';
  h += '<button type="button" class="chip big ' + (clsMode === 'none' ? 'coral' : 'gray') + '" data-act="roll-classes" data-v="none">반은 새로 만들기</button>';
  h += '</div><div class="hint">이름 그대로면 학생이 같은 반으로 옮겨집니다. 새로 만들면 반 미지정으로 옮겨지고, 2차 뒤에 [반 일괄 지정]으로 나누면 됩니다.</div></div>';
  h += '<div class="banner coral" style="margin-top:8px">실행하면 ' + (nyExists ? '<b>' + ny + '년</b>으로 바뀌고 명단이 옮겨집니다.' : '<b>' + ny + '년</b>이 만들어지고 보고 있는 연도가 ' + ny + '년으로 바뀝니다.') + ' ' + ny + '년에 이미 자료가 있으면 실행되지 않습니다.</div>';
  h += '<p class="hint" style="margin:6px 0 0">연도를 잘못 만들었거나 비어 있는 연도를 지우려면 <b>위 카드의 [🗑 연도 삭제]</b>에서 지운 뒤 다시 진행하세요.</p>';
  h += '<button class="btn primary block" data-act="roll-run">1️⃣ ' + ny + '년 만들고 명단 옮기기</button>';
  h += '</div>';
  return h;
}

async function runYearRoll() {
  const depts = (S.state.departments || []).filter(d => !d._del).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!depts.length) return toast('부서가 없습니다', 'err');
  const srcYear = curYear();
  const ny = Number(val('rollYear')) || Number(V.rollYear);
  if (!ny || ny <= srcYear) return toast('새 연도를 ' + (srcYear + 1) + '년 이후로 정해 주세요', 'err');
  if (ny > 2100) return toast('연도를 다시 확인해 주세요', 'err');
  if (yearHasData(ny)) return toast(ny + '년에는 이미 자료가 있습니다. 다른 연도를 골라 주세요', 'err');
  const keepClasses = (V.rollClasses || 'keep') === 'keep';
  const now = Date.now();
  let made = 0;

  /* 반을 그대로 옮기는 경우: 새 연도 반을 먼저 만들고 옛 반 → 새 반을 이어 줍니다 */
  const clsMap = {};
  if (keepClasses) {
    depts.forEach(d => {
      classesOfDeptIn(d.id, srcYear).forEach(c => {
        const nc = { id: 'cl-' + Crypto.uid(), name: c.name, deptId: c.deptId, note: c.note || '', order: c.order || 0, year: ny, u: now };
        S.state.classes.push(nc);
        clsMap[c.id] = nc.id;
      });
    });
  }
  depts.forEach(d => {
    studentsOfDeptIn(d.id, srcYear).forEach(s => {
      const copy = {
        id: 'st-' + Crypto.uid(), personId: s.personId || s.id, name: s.name, birth: s.birth || '',
        birthType: birthTypeOf(s), birthLunar: s.birthLunar || '', gender: s.gender || '',
        deptId: d.id, classId: keepClasses ? (clsMap[s.classId] || '') : '',
        guardianName: s.guardianName || '', guardianPhone: s.guardianPhone || '', guardianUid: s.guardianUid || '',
        note: s.note || '', newcomer: false, active: true,
        year: ny, promotedFrom: s.id, joined: ny + '-03-01', u: now
      };
      S.state.students.push(copy);
      try { syncBirthEventOf('student', copy.personId, copy, d.id); } catch (e) { }
      made++;
    });
  });
  ensureYear(ny);
  await Sync.save();
  setYear(ny);
  V.rollOpen = false;
  V.promoteOpen = true;      /* 이어서 2차 부서 진급으로 */
  V.promoSel = {};
  V.dept = '';
  V.cls = '';
  renderApp();
  toast(ny + '년 명단을 만들었습니다 · 학생 ' + made + '명. 이제 2차 부서 진급을 확인하세요', 'ok');
}

/* ================= 2차: 부서 진급 (나이·학년 기준) ================= */
/* 진급 대상 — 지금 부서와 나이·학년 기준 부서가 다른 학생 */
function promoteRows(year) {
  const y = Number(year) || curYear();
  const out = [];
  allStudentsIn(y).forEach(s => {
    if (s.promoKept === y) return;
    const age = ageInYear(s, y);
    const target = deptIdForAge(age);
    if (!age) { out.push({ s: s, age: 0, label: '', target: '', cur: s.deptId }); return; }
    if (target === 'graduate') { out.push({ s: s, age: age, label: gradeLabelOfAge(age), target: 'graduate', cur: s.deptId }); return; }
    if (target !== s.deptId) out.push({ s: s, age: age, label: gradeLabelOfAge(age), target: target, cur: s.deptId });
  });
  return out;
}
function promoDefault(row) {
  if (!row.age) return 'keep';
  if (row.target === 'graduate') return V.promoLast === 'keep' ? 'dept-teen' : 'graduate';
  return row.target || 'keep';
}
function promoSelection(row) {
  const v = (V.promoSel || {})[row.s.id];
  return v === undefined ? promoDefault(row) : v;
}
function promoteCardHtml(depts) {
  const y = curYear();
  const rows = promoteRows(y);
  const keptCount = allStudentsIn(y).filter(s => s.promoKept === y).length;
  V.promoSel = V.promoSel || {};
  let h = '<div class="card" style="margin-top:10px"><h3>2️⃣ ' + y + '년 부서 진급</h3>';
  h += '<div class="banner sky">' + y + '년 기준 나이·학년으로 계산했습니다. <b>유치부 7세까지 · 초등부 초6까지 · 청소년부 고3까지</b>, 20세부터는 졸업입니다. 학생마다 바꿀 부서를 고르거나 <b>유지</b>할 수 있습니다.</div>';
  if (!rows.length) {
    h += '<div class="banner mint">✅ ' + y + '년에 부서를 바꿀 학생이 없습니다. 모두 나이에 맞는 부서에 있습니다.' + (keptCount ? ' (유지로 정한 학생 ' + keptCount + '명)' : '') + '</div>';
    if (keptCount) h += '<button class="btn sm block" data-act="promo-reset">↺ 유지한 학생 다시 보기 (' + keptCount + '명)</button>';
    h += '<button class="btn block" style="margin-top:6px" data-act="promo-open">접기</button>';
    h += '</div>';
    return h;
  }
  const gradRows = rows.filter(r => r.target === 'graduate');
  const deptRows = rows.filter(r => r.target && r.target !== 'graduate');
  const noBirth = rows.filter(r => !r.age);
  h += '<div class="row wrap" style="gap:6px;margin-bottom:8px"><span class="chip coral big">진급 ' + deptRows.length + '명</span>' + (gradRows.length ? '<span class="chip gray big">졸업 ' + gradRows.length + '명</span>' : '') + (noBirth.length ? '<span class="chip amber big">생년월일 없음 ' + noBirth.length + '명</span>' : '') + '</div>';

  const rowHtml = (r) => {
    const sel = promoSelection(r);
    const curName = deptNameCanon(r.cur) || '부서 미지정';
    const opts = [];
    opts.push(['keep', '유지']);
    if (r.target && r.target !== 'graduate') opts.push([r.target, deptNameCanon(r.target) + '로']);
    if (r.target === 'graduate') opts.push(['graduate', '🎓 졸업']);
    if (!r.age) depts.forEach(d => opts.push([d.id, d.name + '로']));
    let row = '<div style="padding:8px 0;border-bottom:1px dashed var(--line)"><div class="row" style="gap:6px"><b style="font-size:13px">' + esc(r.s.name) + '</b>';
    row += '<span class="chip sky">' + esc(r.label || '생년월일 없음') + '</span>';
    row += '<span class="sp" style="flex:1"></span><span class="muted" style="font-size:11.5px">' + esc(curName) + (r.target ? ' → ' + (r.target === 'graduate' ? '졸업' : esc(deptNameCanon(r.target))) : ' (직접 지정)') + '</span></div>';
    row += '<div class="row wrap" style="gap:5px;margin-top:5px">';
    opts.forEach(o => {
      row += '<button type="button" class="chip big ' + (sel === o[0] ? (o[0] === 'graduate' ? 'gray' : 'coral') : 'gray') + '" data-act="promo-pick" data-sid="' + esc(r.s.id) + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    });
    row += '</div></div>';
    return row;
  };

  if (gradRows.length) {
    h += '<div class="sect-title" style="margin:8px 0 4px">🎓 고등학교 졸업 (20세 이상)</div>';
    h += '<div class="row wrap" style="gap:5px;margin-bottom:4px"><button type="button" class="chip big ' + (V.promoLast !== 'keep' ? 'coral' : 'gray') + '" data-act="promo-last" data-v="graduate">모두 졸업</button><button type="button" class="chip big ' + (V.promoLast === 'keep' ? 'coral' : 'gray') + '" data-act="promo-last" data-v="keep">청소년부에 그대로 두기</button></div>';
    h += '<div class="card flat" style="padding:4px 12px">' + gradRows.map(rowHtml).join('') + '</div>';
  }
  if (deptRows.length) {
    const byMove = {};
    deptRows.forEach(r => { const k = r.cur + '>' + r.target; (byMove[k] = byMove[k] || []).push(r); });
    Object.keys(byMove).forEach(k => {
      const a = deptNameCanon(k.split('>')[0]) || '부서 미지정', b = deptNameCanon(k.split('>')[1]) || '부서';
      h += '<div class="sect-title" style="margin:10px 0 4px">' + esc(a) + ' → ' + esc(b) + ' <small>' + byMove[k].length + '명</small></div>';
      h += '<div class="card flat" style="padding:4px 12px">' + byMove[k].map(rowHtml).join('') + '</div>';
    });
  }
  if (noBirth.length) {
    h += '<div class="sect-title" style="margin:10px 0 4px">생년월일 없음 <small>' + noBirth.length + '명</small></div>';
    h += '<div class="banner amber" style="margin-bottom:6px">생년월일이 없어 부서를 계산할 수 없습니다. 그대로 두거나 직접 고르세요. (학생 정보에 생년월일을 넣으면 다음부터 자동으로 계산됩니다)</div>';
    h += '<div class="card flat" style="padding:4px 12px">' + noBirth.map(rowHtml).join('') + '</div>';
  }

  /* 교사 부서 이동 */
  h += '<div class="sect-title" style="margin:12px 0 4px">🧑‍🏫 교사 부서 이동 (선택)</div>';
  if (V.gradeAccts === undefined) {
    loadGradeAccounts();
    h += '<div class="card flat"><p class="muted" style="margin:0">교사 계정을 불러오는 중…</p></div>';
  } else if (!V.gradeAccts.length) {
    h += '<div class="card flat"><p class="muted" style="margin:0">등록된 교사 계정이 없습니다.</p></div>';
  } else {
    V.gradeTeachers = V.gradeTeachers || {};
    h += '<p class="hint" style="margin:0 0 6px">옮길 교사만 부서를 골라 주세요. 고르지 않으면 그대로 둡니다.</p><div class="card flat" style="padding:8px 12px">';
    V.gradeAccts.forEach(a => {
      const cur = accountDeptIds(a)[0] || '';
      const pick = V.gradeTeachers[a.uid] !== undefined ? V.gradeTeachers[a.uid] : '';
      h += '<div style="padding:7px 0;border-bottom:1px dashed var(--line)"><div class="row" style="gap:8px"><b style="font-size:13px">' + esc(a.rec.name) + '</b><span class="muted">@' + esc(a.rec.id) + '</span><span class="sp" style="flex:1"></span><span class="muted">' + esc(deptNameCanon(cur) || '부서 미지정') + '</span></div><div class="row wrap" style="gap:5px;margin-top:5px">';
      depts.forEach(d => {
        h += '<button type="button" class="chip big ' + (pick === d.id ? 'coral' : 'gray') + '" data-act="promo-teacher" data-uid="' + esc(a.uid) + '" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>';
      });
      h += '<button type="button" class="chip big ' + (!pick ? 'coral' : 'gray') + '" data-act="promo-teacher" data-uid="' + esc(a.uid) + '" data-id="">그대로</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }

  h += '<div class="banner coral" style="margin-top:10px">2차를 실행하면 고른 대로 부서가 바뀝니다. <b>유지</b>를 고른 학생은 ' + y + '년에 다시 묻지 않습니다. 졸업은 지난 기록을 지우지 않고 ' + y + '년 명단에서만 뺍니다.</div>';
  h += '<button class="btn primary block" data-act="promo-run">2️⃣ 부서 진급 실행 (' + rows.length + '명 확인)</button>';
  h += '<p class="hint" style="text-align:center">다시 확인하고 싶으면 이 화면을 나중에 다시 열면 됩니다. 이미 바뀐 학생은 목록에 나오지 않습니다.</p>';
  h += '</div>';
  return h;
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

async function runDeptPromote() {
  const y = curYear();
  const rows = promoteRows(y);
  if (!rows.length) return toast('부서를 바꿀 학생이 없습니다', 'err');
  let moved = 0, grad = 0, kept = 0, skipped = 0;
  rows.forEach(r => {
    const sel = promoSelection(r);
    const s = r.s;
    if (!sel || sel === 'keep') {
      if (sel === 'keep' && r.age) { s.promoKept = y; touch(s); kept++; } else skipped++;
      return;
    }
    if (sel === 'graduate') {
      s.active = false; s.graduatedAt = y; s.gradReason = '고등학교 졸업'; touch(s);
      grad++;
      return;
    }
    if (sel !== s.deptId) {
      s.deptId = sel;
      const c = classById(s.classId);
      if (c && c.deptId !== sel) s.classId = '';
      touch(s);
      try { syncBirthEventOf('student', s.personId || s.id, s, sel); } catch (e) { }
      moved++;
    }
  });
  /* 교사 부서 이동 */
  let tMoved = 0, tFail = 0;
  const picks = V.gradeTeachers || {};
  for (const uidKey of Object.keys(picks)) {
    const to = picks[uidKey];
    if (!to) continue;
    try {
      const upd = await updateAccountRec(uidKey, rec => { rec.depts = [to]; rec.classes = []; });
      if (upd) { try { syncBirthEventOf('account', uidKey, upd, upd.depts || []); } catch (e) { } }
      tMoved++;
    } catch (e) { tFail++; }
  }
  await Sync.save();
  V.promoSel = {};
  V.gradeTeachers = {};
  V.gradeAccts = undefined;
  V.dept = '';
  V.cls = '';
  renderApp();
  let msg = y + '년 부서 진급 완료 · 부서 이동 ' + moved + '명';
  if (grad) msg += ' · 졸업 ' + grad + '명';
  if (kept) msg += ' · 유지 ' + kept + '명';
  if (tMoved) msg += ' · 교사 ' + tMoved + '명 이동';
  if (tFail) msg += ' · 교사 ' + tFail + '명 실패';
  toast(msg, 'ok');
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
      case 'year-del-open': yearDeleteModal(); return;
      case 'year-del': requestYearDelete(Number(t.dataset.v)); return;
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
      case 'roll-open': V.rollOpen = !V.rollOpen; if (V.rollOpen) { V.rollYear = 0; V.promoteOpen = false; } renderApp(); return;
      case 'roll-classes': V.rollClasses = t.dataset.v; renderApp(); return;
      case 'roll-run': {
        const ny = Number(val('rollYear')) || Number(V.rollYear);
        const n = allStudentsIn(curYear()).length;
        confirmBox('1차 · 연도 바꾸기', '학생 ' + n + '명을 ' + ny + '년 명단으로 옮기고(부서는 그대로), 보고 있는 연도를 ' + ny + '년으로 바꿉니다. 계속할까요?', '연도 바꾸기', runYearRoll);
        return;
      }
      case 'promo-open': V.promoteOpen = !V.promoteOpen; if (V.promoteOpen) { V.rollOpen = false; V.gradeAccts = undefined; V.promoSel = {}; } renderApp(); return;
      case 'promo-pick': {
        V.promoSel = V.promoSel || {};
        V.promoSel[t.dataset.sid] = t.dataset.v;
        renderApp();
        return;
      }
      case 'promo-last': V.promoLast = t.dataset.v; V.promoSel = {}; renderApp(); return;
      case 'promo-reset': {
        const y = curYear();
        allStudentsIn(y).forEach(s => { if (s.promoKept === y) { delete s.promoKept; touch(s); } });
        V.promoSel = {};
        Sync.save().then(() => renderApp());
        toast('유지로 정했던 학생을 다시 보여 줍니다', 'ok');
        return;
      }
      case 'promo-teacher': {
        V.gradeTeachers = V.gradeTeachers || {};
        V.gradeTeachers[t.dataset.uid] = t.dataset.id || '';
        renderApp();
        return;
      }
      case 'promo-run': {
        const rows = promoteRows(curYear());
        const n = rows.length;
        confirmBox('2차 · 부서 진급 실행', curYear() + '년 기준 나이·학년에 맞춰 고른 대로 부서를 바꿉니다. 계속할까요? (확인할 학생 ' + n + '명)', '실행', runDeptPromote);
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
      case 'stat-period': {
        V.statPeriod = t.dataset.v;
        if (t.dataset.v === 'year') V.statYear = Number(String(statState()).slice(0, 4)) || statYear();
        renderApp();
        return;
      }
      case 'period-print': periodPrintModal(V.statPeriod || 'month'); return;
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
