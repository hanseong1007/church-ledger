/* 덕신교회 부서업무 — 달란트 포상제
   부서별 기준(출석·가정 공과·암송·전도 …)으로 아이마다 달란트를 적립하고,
   사용·시상(차감)을 기록해 잔액과 내역을 보고 인쇄합니다. 학부모는 자기 자녀 것만 봅니다.
   적립 기록은 '그 날 한 장'이라 출석 체크와 달란트 탭 어느 쪽에서 눌러도 같은 기록이 됩니다. */
'use strict';

function talentYear() { return curYear(); }
function talentDate() { if (!V.talDate) V.talDate = lastSunday(); return V.talDate; }
function talentDeptId() {
  const ds = visibleDepts();
  if (!ds.length) return '';
  if (!V.talDept || !ds.some(d => d.id === V.talDept)) V.talDept = ds[0].id;
  return V.talDept;
}
function talentCanWrite() { return can('talent.manage'); }

/* 내역 한 줄 이름 — 적립 항목·기타(직접 부여)·사용 사유 */
function talentRecordLabel(x, deptId, year) {
  if (!x) return '';
  if (x.kind === 'spend') return x.memo || '사용·시상';
  const parts = Object.keys(x.items || {}).map(k => talentItemLabel(deptId || x.deptId, year, k)).filter(Boolean);
  const b = Number(x.bonus) || 0;
  if (b) parts.push('기타 +' + b);
  if (!parts.length && x.memo) parts.push(x.memo);
  return parts.join(' · ') || '적립';
}

/* 학부모·교사 모두 쓰는 한 줄 요약 */
function talentSummaryChip(studentId) {
  const t = talentTotals(studentId, talentYear());
  return '<span class="chip violet">🎁 ' + esc(String(t.balance)) + '점</span>';
}

/* ---------------- 교사·부서 화면 ---------------- */
function talentView() {
  if (!can('talent.manage') && !can('talent.read')) return '<div class="card">' + emptyBox('🔒', '달란트를 볼 권한이 없습니다') + '</div>';
  const ds = visibleDepts();
  if (!ds.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  const deptId = talentDeptId();
  const dept = deptById(deptId) || {};
  const tab = V.talTab || 'grant';
  const w = talentCanWrite();

  let h = subHead('달란트', '출석·가정 공과·암송·전도를 적립하고, 사용·시상까지 한곳에서',
    '<button class="btn sm" data-act="tal-print">🖨 대장 인쇄</button>');
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="row wrap" style="gap:6px">' + ds.map(d => '<button class="chip big ' + (d.id === deptId ? 'coral' : 'gray') + '" data-act="tal-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div>';
  h += '<div class="row" style="gap:6px;margin-top:10px"><button class="chip big ' + (tab === 'grant' ? 'coral' : 'gray') + '" data-act="tal-tab" data-v="grant">🎁 적립(부여)</button><button class="chip big ' + (tab === 'spend' ? 'coral' : 'gray') + '" data-act="tal-tab" data-v="spend">🏅 사용·시상</button><button class="chip big ' + (tab === 'ledger' ? 'coral' : 'gray') + '" data-act="tal-tab" data-v="ledger">📒 대장·내역</button></div>';
  h += '</div>';

  /* 기준 카드 */
  const items = talentItems(deptId, talentYear());
  h += '<div class="card"><h3>📏 ' + esc(dept.name || '') + ' 달란트 기준<span class="sp"></span><small>' + talentYear() + '년</small></h3>';
  h += '<div class="row wrap" style="gap:6px">' + items.map(x => '<span class="chip violet">' + esc(x.label) + ' ' + esc(String(x.points)) + '점</span>').join('') + '</div>';
  if (w) {
    h += '<div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn sm" data-act="tal-rule-edit">✏️ 기준 수정</button><button class="btn sm ghost" data-act="tal-rule-from-plan">📄 월별계획표에서 불러오기</button><span class="sp"></span><button class="chip big ' + (talentAutoOn() ? 'mint' : 'gray') + '" data-act="tal-auto">' + (talentAutoOn() ? '🔗 출석하면 자동 적립 · 켜짐' : '🔗 출석 자동 적립 · 꺼짐') + '</button></div>';
  }
  h += '</div>';

  if (tab === 'grant') h += talentGrantHtml(deptId, w);
  else if (tab === 'spend') h += talentSpendHtml(deptId, w);
  else h += talentLedgerHtml(deptId);
  return h;
}

/* 적립(부여) — 날짜 한 장에 항목을 눌러 담습니다 */
function talentGrantHtml(deptId, w) {
  const date = talentDate();
  const items = talentItems(deptId, talentYear());
  const cls = V.talCls || '';
  const list = cls ? studentsOfClassIn(cls, talentYear()).filter(s => s.deptId === deptId) : studentsOfDept(deptId);
  const classes = classesOfDept(deptId);
  let h = '<div class="card flat" style="padding:12px"><div class="daybar"><button class="icon-btn" data-act="tal-date-move" data-v="-7">‹</button><input type="date" id="talDate" value="' + esc(date) + '" data-change="tal-date"><button class="icon-btn" data-act="tal-date-move" data-v="7">›</button></div>';
  if (classes.length) h += '<div class="row wrap" style="gap:6px;margin-top:8px"><button class="chip big ' + (!cls ? 'coral' : 'gray') + '" data-act="tal-cls" data-id="">전체</button>' + classes.map(c => '<button class="chip big ' + (c.id === cls ? 'coral' : 'gray') + '" data-act="tal-cls" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>').join('') + '</div>';
  h += '</div>';

  if (w) {
    h += '<div class="card flat" style="padding:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:7px">' + esc(fmtDate(date)) + ' — 한꺼번에 주기</div>';
    h += '<div class="row wrap" style="gap:6px">' + items.map(x => '<button class="btn sm" data-act="tal-bulk" data-key="' + esc(x.key) + '">' + esc(x.label) + ' +' + esc(String(x.points)) + '</button>').join('') +
      '<button class="btn sm ghost" data-act="tal-clear">전체 해제</button></div></div>';
  }

  if (!list.length) return h + '<div class="card">' + emptyBox('👶', '이 부서에 등록된 학생이 없습니다', '반·학생에서 먼저 등록하세요') + '</div>';

  h += '<div class="card"><h3>학생 <span class="sp"></span><small>' + esc(fmtDate(date)) + ' · ' + list.length + '명</small></h3>';
  list.forEach(s => {
    const on = talentDayItems(date, s.id);
    const day = talentDayPoints(date, s.id);
    const t = talentTotals(s.id, talentYear());
    h += '<div class="stud-row tal-row"><span class="nm"><b>' + esc(s.name) + '</b><span>' + esc((classById(s.classId) || {}).name || '반 미지정') + (day ? ' · 오늘 +' + day + '점' : '') + ' · 잔액 ' + t.balance + '점</span></span>';
    h += '<span class="tal-chips">';
    items.forEach(x => {
      const active = !!on[x.key];
      h += '<button class="tal-chip ' + (active ? 'on' : '') + '"' + (w ? ' data-act="tal-toggle" data-sid="' + esc(s.id) + '" data-key="' + esc(x.key) + '"' : ' disabled') + ' title="' + esc(x.label + ' ' + x.points + '점') + '">' + esc(x.label) + '<i>' + esc(String(x.points)) + '</i></button>';
    });
    h += '</span>';
    if (w) h += '<button class="tal-plus" data-act="tal-bonus-new" data-sid="' + esc(s.id) + '" title="기타 달란트 직접 주기">➕</button>' +
      '<button class="tal-plus" data-act="tal-spend-new" data-sid="' + esc(s.id) + '" title="사용·시상 기록">🏅</button>';
    h += '</div>';
  });
  h += '</div>';
  h += '<p class="muted" style="text-align:center">항목을 누르면 그 날 달란트가 바로 적립되고, 다시 누르면 취소됩니다. 출석을 체크하면 ‘출석’ 달란트는 저절로 붙습니다.</p>';
  return h;
}

/* 사용·시상 */
function talentSpendHtml(deptId, w) {
  const y = talentYear();
  const rows = (S.state.talents || []).filter(x => x && !x._del && x.kind === 'spend' && x.deptId === deptId && (Number(x.year) || yearOfDate(x.date)) === y)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at || 0) - (a.at || 0));
  const total = rows.reduce((n, x) => n + (Number(x.points) || 0), 0);
  let h = '<div class="stat-grid" style="margin-bottom:12px"><div class="stat present"><b>' + money(total) + '</b><span>올해 사용·시상</span></div><div class="stat new"><b>' + rows.length + '</b><span>기록</span></div></div>';
  if (w) h += '<button class="btn primary block" style="margin-bottom:12px" data-act="tal-spend-new">＋ 사용·시상 기록</button>';
  if (!rows.length) return h + '<div class="card">' + emptyBox('🏅', '아직 사용·시상 기록이 없습니다', '선물·시상으로 달란트를 차감하면 여기에 남습니다') + '</div>';
  h += '<div class="card"><h3>사용·시상 내역 <span class="sp"></span><small>' + y + '년 · ' + esc((deptById(deptId) || {}).name || '') + '</small></h3><div class="list">';
  rows.forEach(x => {
    const s = (S.state.students || []).find(z => z.id === x.studentId) || {};
    h += '<div class="item" style="padding:9px 11px"><span class="av" style="background:#fdeaf0;color:#c33e5f">−</span><span class="tx"><b>' + esc(s.name || '(지운 학생)') + ' · ' + esc(x.memo || '사용') + '</b><span>' + esc(fmtDate(x.date)) + ' · ' + esc(nameOfUid(x.by) || '') + '</span></span><span class="rt"><b>' + (Number(x.points) || 0) + '점</b></span>' +
      (w ? '<button class="plan-del" data-act="tal-spend-del" data-id="' + esc(x.id) + '">✕</button>' : '') + '</div>';
  });
  h += '</div></div>';
  return h;
}

/* 대장 — 학생별 항목 횟수·적립·사용·잔액 */
function talentLedgerRows(deptId, year) {
  const items = talentItems(deptId, year);
  const studs = (deptId ? studentsOfDept(deptId) : allStudentsIn(year)).filter(s => recYear(s) === Number(year));
  return studs.map(s => {
    const t = talentTotals(s.id, year);
    return { s: s, t: t, items: items, cls: (classById(s.classId) || {}).name || '' };
  }).sort((a, b) => a.s.name.localeCompare(b.s.name, 'ko'));
}
function talentLedgerHtml(deptId) {
  const y = talentYear();
  const items = talentItems(deptId, y);
  const rows = talentLedgerRows(deptId, y);
  let h = '<div class="card"><h3>📒 달란트 대장 <span class="sp"></span><small>' + y + '년 · ' + esc((deptById(deptId) || {}).name || '') + ' · ' + rows.length + '명</small></h3>';
  if (!rows.length) return h + emptyBox('👶', '이 부서에 등록된 학생이 없습니다') + '</div>';
  h += '<div class="sheet-scroll"><table class="tal-tbl"><thead><tr><th>이름</th><th>반</th>' + items.map(x => '<th>' + esc(x.label) + '</th>').join('') + '<th>적립</th><th>사용</th><th>잔액</th></tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr class="clickable" data-act="tal-detail" data-sid="' + esc(r.s.id) + '"><td class="it">' + esc(r.s.name) + '</td><td class="ctr">' + esc(r.cls || '-') + '</td>' +
      items.map(x => '<td class="ctr">' + (r.t.byItem[x.key] || 0) + '</td>').join('') +
      '<td class="ctr">' + r.t.earn + '</td><td class="ctr">' + r.t.spend + '</td><td class="ctr"><b>' + r.t.balance + '</b></td></tr>';
  });
  const tot = rows.reduce((a, r) => { a.earn += r.t.earn; a.spend += r.t.spend; a.balance += r.t.balance; return a; }, { earn: 0, spend: 0, balance: 0 });
  h += '</tbody><tfoot><tr><td colspan="2">합계</td>' + items.map(x => '<td class="ctr">' + rows.reduce((n, r) => n + (r.t.byItem[x.key] || 0), 0) + '</td>').join('') +
    '<td class="ctr">' + tot.earn + '</td><td class="ctr">' + tot.spend + '</td><td class="ctr"><b>' + tot.balance + '</b></td></tr></tfoot></table></div>';
  h += '<p class="hint" style="margin-top:6px">이름을 누르면 그 아이의 적립·사용 내역을 보고 인쇄할 수 있습니다.</p></div>';
  return h;
}

/* 개인 내역 */
function talentDetailModal(sid) {
  const s = (S.state.students || []).find(x => x.id === sid);
  if (!s) return;
  const y = talentYear();
  const items = talentItems(s.deptId, y);
  const t = talentTotals(sid, y);
  const rows = talentRowsOf(sid, y).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at || 0) - (a.at || 0));
  let h = '<div class="row" style="gap:6px;margin-bottom:8px">' + deptChip(deptById(s.deptId)) + '<span class="chip gray">' + esc((classById(s.classId) || {}).name || '반 미지정') + '</span></div>';
  h += '<div class="stat-grid" style="margin-bottom:10px"><div class="stat present"><b>' + t.earn + '</b><span>적립</span></div><div class="stat absent"><b>' + t.spend + '</b><span>사용</span></div><div class="stat new"><b>' + t.balance + '</b><span>잔액</span></div><div class="stat enroll"><b>' + rows.length + '</b><span>기록</span></div></div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">' + items.map(x => '<span class="chip gray">' + esc(x.label) + ' ' + (t.byItem[x.key] || 0) + '회</span>').join('') + '</div>';
  if (!rows.length) h += '<p class="muted">아직 달란트 기록이 없습니다.</p>';
  else {
    h += '<div class="list">';
    rows.forEach(x => {
      const spend = x.kind === 'spend';
      h += '<div class="item" style="padding:8px 11px"><span class="av" style="background:' + (spend ? '#fdeaf0;color:#c33e5f' : '#efe9fd;color:#6647b8') + '">' + (spend ? '−' : '+') + '</span><span class="tx"><b>' + esc(talentRecordLabel(x, s.deptId, y)) + '</b><span>' + esc(fmtDate(x.date)) + (spend || !x.memo ? '' : ' · ' + esc(x.memo)) + '</span></span><span class="rt"><b>' + (spend ? '−' : '+') + (Number(x.points) || 0) + '점</b></span></div>';
    });
    h += '</div>';
  }
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="modal-close">닫기</button><span class="sp"></span><button class="btn" data-act="tal-print-student" data-sid="' + esc(sid) + '">🖨 내역 인쇄</button>' +
    (talentCanWrite() ? '<button class="btn primary" data-act="tal-spend-new" data-sid="' + esc(sid) + '">🏅 사용·시상</button>' : '') + '</div>';
  openModal(s.name + ' 달란트', h);
}

/* ---------------- 학부모 화면 ---------------- */
function parentTalentView() {
  let h = '<div class="page-head"><div><h2>달란트</h2><p>우리 아이가 모은 달란트와 받은 상을 봅니다</p></div></div>';
  const kids = myStudents();
  if (!kids.length) return h + '<div class="card">' + emptyBox('👨‍👩‍👧', '연결된 자녀가 없습니다', '부서 담당 교사에게 요청해 주세요') + '</div>';
  const y = talentYear();
  kids.forEach(k => {
    const t = talentTotals(k.id, y);
    const m = talentMonthTotals(k.id, String(V.date || ymd()).slice(0, 7), y);
    const rows = talentRowsOf(k.id, y).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at || 0) - (a.at || 0));
    h += '<div class="card"><h3>' + esc(k.name) + ' <small>' + esc((deptById(k.deptId) || {}).name || '') + ' · ' + esc((classById(k.classId) || {}).name || '') + '</small><span class="sp"></span><span class="chip violet">🎁 ' + t.balance + '점</span></h3>';
    h += '<div class="stat-grid" style="margin-bottom:10px"><div class="stat present"><b>' + t.earn + '</b><span>' + y + '년 적립</span></div><div class="stat absent"><b>' + t.spend + '</b><span>사용·시상</span></div><div class="stat new"><b>' + (m.net > 0 ? '+' : '') + m.net + '</b><span>이번 달 적립−사용</span></div></div>';
    if (!rows.length) h += '<p class="muted" style="margin:0">아직 달란트 기록이 없습니다.</p>';
    else {
      h += '<div class="list">';
      rows.slice(0, 20).forEach(x => {
        const spend = x.kind === 'spend';
        h += '<div class="item" style="padding:8px 11px"><span class="av" style="background:' + (spend ? '#fdeaf0;color:#c33e5f' : '#efe9fd;color:#6647b8') + '">' + (spend ? '−' : '+') + '</span><span class="tx"><b>' + esc(talentRecordLabel(x, k.deptId, y)) + '</b><span>' + esc(fmtDate(x.date)) + '</span></span><span class="rt"><b>' + (spend ? '−' : '+') + (Number(x.points) || 0) + '점</b></span></div>';
      });
      h += '</div>';
      if (rows.length > 20) h += '<p class="muted" style="margin:6px 0 0">최근 20건만 보입니다.</p>';
    }
    h += '</div>';
  });
  return h;
}

/* ---------------- 기준 수정 ---------------- */
function talentRuleModal() {
  if (!talentCanWrite()) return toast('달란트 기준을 고칠 권한이 없습니다', 'err');
  const deptId = talentDeptId();
  const y = talentYear();
  const items = talentItems(deptId, y).map(x => ({ key: x.key, label: x.label, points: x.points }));
  V.talRuleEdit = { deptId: deptId, year: y, items: items };
  let h = '<div class="banner sky">' + esc((deptById(deptId) || {}).name || '') + ' · ' + y + '년 기준입니다. 해가 바뀌면 그 해 기준을 따로 정할 수 있습니다.</div>';
  h += '<div id="talRuleList">' + talentRuleRowsHtml() + '</div>';
  h += '<div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn sm" data-act="tal-rule-add">＋ 항목 추가</button><button class="btn sm ghost" data-act="tal-rule-reset">기본값(출석 3·가정 공과 3·암송 10·전도 20)</button></div>';
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="tal-rule-save">저장</button></div>';
  openModal('달란트 기준', h);
}
function talentRuleRowsHtml() {
  const e = V.talRuleEdit || { items: [] };
  let h = '';
  e.items.forEach((x, i) => {
    h += '<div class="row" style="gap:6px;margin-bottom:6px"><input id="trLabel' + i + '" value="' + esc(x.label) + '" placeholder="항목 (예: 암송)" style="flex:2">' +
      '<input id="trPoint' + i + '" type="number" min="0" step="1" value="' + esc(String(x.points)) + '" style="flex:0 0 84px">' +
      '<button class="plan-del" data-act="tal-rule-del" data-i="' + i + '">✕</button></div>';
  });
  if (!e.items.length) h = '<p class="muted" style="margin:0">항목이 없습니다.</p>';
  return h;
}
function captureTalentRule() {
  const e = V.talRuleEdit;
  if (!e) return e;
  e.items.forEach((x, i) => {
    const l = document.getElementById('trLabel' + i), p = document.getElementById('trPoint' + i);
    if (l) x.label = String(l.value || '').trim();
    if (p) x.points = Number(p.value) || 0;
  });
  e.items = e.items.filter(x => x.label);
  return e;
}
function saveTalentRule() {
  const e = captureTalentRule();
  if (!e) return;
  if (!e.items.length) return toast('항목을 하나 이상 넣어 주세요', 'err');
  const id = talentRuleId(e.deptId, e.year);
  let rec = (S.state.talentRules || []).find(x => x.id === id);
  if (!rec) { rec = { id: id, deptId: e.deptId, year: e.year, items: [], u: 0 }; S.state.talentRules.push(rec); }
  rec.items = e.items.map(x => ({ key: x.key, label: x.label, points: Number(x.points) || 0 }));
  rec.by = S.me.uid; touch(rec); rec._del = false;
  V.talRuleEdit = null;
  closeModal();
  Sync.save().then(() => { renderApp(); toast('달란트 기준을 저장했습니다', 'ok'); });
}
function talentRuleFromPlan() {
  const deptId = talentDeptId();
  const y = talentYear();
  const sheets = (S.state.planSheets || []).filter(x => !x._del && x.deptId === deptId && Number(x.year) === y)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  let found = null, from = '';
  for (const sh of sheets) {
    const tl = (sh.talent && sh.talent.length) ? sh.talent : parseTalentText(sh.talentNote || '');
    if (tl && tl.length) { found = tl; from = sh.title || monthLabel(sh.month); break; }
  }
  if (!found) return toast('이 부서·이 해 월별계획표에 달란트 기준이 없습니다', 'err');
  if (!talentCanWrite()) return toast('권한이 없습니다', 'err');
  confirmBox('계획표에서 불러오기', '「' + from + '」의 달란트 기준(' + found.map(x => x.label + ' ' + x.points).join(', ') + ')으로 바꿀까요?', '불러오기', async () => {
    const id = talentRuleId(deptId, y);
    let rec = (S.state.talentRules || []).find(x => x.id === id);
    if (!rec) { rec = { id: id, deptId: deptId, year: y, items: [], u: 0 }; S.state.talentRules.push(rec); }
    rec.items = found.map(x => ({ key: x.key, label: x.label, points: Number(x.points) || 0 }));
    rec.by = S.me.uid; touch(rec); rec._del = false;
    await Sync.save(); closeModal(); renderApp();
    toast('계획표의 달란트 기준을 불러왔습니다', 'ok');
  });
}

/* ---------------- 사용·시상 기록 창 ---------------- */
function talentSpendModal(sid) {
  if (!talentCanWrite()) return toast('달란트 사용을 기록할 권한이 없습니다', 'err');
  const deptId = talentDeptId();
  const studs = studentsOfDept(deptId);
  if (!studs.length) return toast('이 부서에 학생이 없습니다', 'err');
  const sel = sid || (studs[0] || {}).id;
  let h = '<div class="field"><label>학생</label><select id="tsStudent">' + studs.map(s => '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc((classById(s.classId) || {}).name || '반 미지정') + ')</option>').join('') + '</select></div>';
  h += '<div class="grid2"><div class="field"><label>날짜</label><input id="tsDate" type="date" value="' + esc(talentDate()) + '"></div><div class="field"><label>달란트(점)</label><input id="tsPoints" type="number" min="1" step="1" value="10"></div></div>';
  h += '<div class="field"><label>사용·시상 내용</label><input id="tsMemo" placeholder="예: 문구 선물 교환 / 암송왕 시상"><div class="hint">적립에서 뺍니다(차감).</div></div>';
  const t = talentTotals(sel, talentYear());
  h += '<div class="kv"><span>' + esc((studs.find(s => s.id === sel) || {}).name || '') + ' 잔액</span><b>' + t.balance + '점</b></div>';
  h += '<div class="row" style="margin-top:10px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="tal-spend-save">기록</button></div>';
  openModal('달란트 사용·시상', h);
}
function saveTalentSpend() {
  const sid = (document.getElementById('tsStudent') || {}).value || '';
  const date = (document.getElementById('tsDate') || {}).value || '';
  const pts = Number((document.getElementById('tsPoints') || {}).value || 0);
  const memo = (document.getElementById('tsMemo') || {}).value || '';
  const s = (S.state.students || []).find(x => x.id === sid);
  if (!s) return toast('학생을 골라 주세요', 'err');
  if (!date) return toast('날짜를 골라 주세요', 'err');
  if (!pts) return toast('점수를 넣어 주세요', 'err');
  if (!memo.trim()) return toast('사용·시상 내용을 적어 주세요', 'err');
  addTalentSpend(date, s.deptId, s.id, pts, memo.trim());
  closeModal();
  Sync.save().then(() => { renderApp(); toast(s.name + ' ' + pts + '점 사용으로 기록했습니다', 'ok'); });
}

/* 기타 달란트 직접 주기 (정해진 기준 밖 — 도움·친절 등) */
function talentBonusModal(sid) {
  if (!talentCanWrite()) return toast('달란트를 줄 권한이 없습니다', 'err');
  const s = (S.state.students || []).find(x => x.id === sid);
  if (!s) return;
  const rec = talentEarnRec(talentDate(), sid);
  let h = '<div class="banner sky">' + esc(s.name) + ' · ' + esc(fmtDate(talentDate())) + ' — 정해진 기준 밖의 달란트를 더합니다.</div>';
  h += '<div class="grid2"><div class="field"><label>더할 달란트(점)</label><input id="tbPoints" type="number" min="1" step="1" value="' + esc(String((rec && rec.bonus) || 5)) + '"></div><div class="field"><label>날짜</label><input id="tbDate" type="date" value="' + esc(talentDate()) + '"></div></div>';
  h += '<div class="field"><label>이유</label><input id="tbMemo" value="' + esc((rec && rec.memo) || '') + '" placeholder="예: 친구 도와줌 / 예배 시간 잘 지킴"></div>';
  h += '<div class="row"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="tal-bonus-save" data-sid="' + esc(sid) + '">더하기</button></div>';
  openModal('기타 달란트', h);
}
function saveTalentBonus(sid) {
  const s = (S.state.students || []).find(x => x.id === sid);
  if (!s) return;
  const date = (document.getElementById('tbDate') || {}).value || talentDate();
  const pts = Number((document.getElementById('tbPoints') || {}).value || 0);
  const memo = ((document.getElementById('tbMemo') || {}).value || '').trim();
  if (!pts) return toast('점수를 넣어 주세요', 'err');
  const items = talentDayItems(date, sid);
  saveTalentDay(date, s.deptId, sid, items, pts, memo);
  closeModal();
  Sync.save().then(() => { renderApp(); toast(s.name + ' 기타 달란트 ' + pts + '점을 더했습니다', 'ok'); });
}

/* ---------------- 인쇄 ---------------- */
function talentPrintCss() {
  return '@page{size:A4 portrait;margin:12mm 10mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#111;margin:0}' +
    'h1{font-size:15pt;text-align:center;margin:0 0 1mm}' +
    'h2{font-size:9pt;text-align:center;color:#666;font-weight:600;margin:0 0 4mm}' +
    'table{width:100%;border-collapse:collapse;font-size:9pt;table-layout:fixed}' +
    'th,td{border:1px solid #333;padding:1.4mm 1.6mm;vertical-align:middle}' +
    'th{background:#f2f2f2;font-weight:700;text-align:center}' +
    'td.ctr{text-align:center}td.num{text-align:right;font-variant-numeric:tabular-nums}' +
    'tfoot td{font-weight:800;background:#fafafa}' +
    'p.foot{font-size:7.5pt;color:#999;text-align:center;margin-top:4mm}';
}
function talentPrintDoc(title, body) {
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다. 브라우저의 팝업 허용을 켜 주세요', 'err');
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + talentPrintCss() + '</style></head><body>' + body +
    '<p class="foot">' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}
function printTalentLedger() {
  const deptId = talentDeptId();
  const y = talentYear();
  const items = talentItems(deptId, y);
  const rows = talentLedgerRows(deptId, y);
  let b = '<h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 달란트 대장</h1>';
  b += '<h2>' + esc((deptById(deptId) || {}).name || '') + ' · ' + y + '년 · 기준 ' + esc(items.map(x => x.label + ' ' + x.points).join(', ')) + '</h2>';
  b += '<table><thead><tr><th style="width:20%">이름</th><th style="width:12%">반</th>' + items.map(x => '<th>' + esc(x.label) + '</th>').join('') + '<th>적립</th><th>사용</th><th>잔액</th></tr></thead><tbody>';
  rows.forEach(r => {
    b += '<tr><td>' + esc(r.s.name) + '</td><td class="ctr">' + esc(r.cls || '-') + '</td>' + items.map(x => '<td class="ctr">' + (r.t.byItem[x.key] || 0) + '</td>').join('') +
      '<td class="ctr">' + r.t.earn + '</td><td class="ctr">' + r.t.spend + '</td><td class="ctr"><b>' + r.t.balance + '</b></td></tr>';
  });
  const tot = rows.reduce((a, r) => { a.earn += r.t.earn; a.spend += r.t.spend; a.balance += r.t.balance; return a; }, { earn: 0, spend: 0, balance: 0 });
  b += '</tbody><tfoot><tr><td colspan="2">합계</td>' + items.map(x => '<td class="ctr">' + rows.reduce((n, r) => n + (r.t.byItem[x.key] || 0), 0) + '</td>').join('') +
    '<td class="ctr">' + tot.earn + '</td><td class="ctr">' + tot.spend + '</td><td class="ctr">' + tot.balance + '</td></tr></tfoot></table>';
  talentPrintDoc('달란트 대장', b);
}
function printTalentStudent(sid) {
  const s = (S.state.students || []).find(x => x.id === sid);
  if (!s) return;
  const y = talentYear();
  const items = talentItems(s.deptId, y);
  const t = talentTotals(sid, y);
  const rows = talentRowsOf(sid, y).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let b = '<h1>' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 달란트 내역서</h1>';
  b += '<h2>' + esc(s.name) + ' · ' + esc((deptById(s.deptId) || {}).name || '') + ' ' + esc((classById(s.classId) || {}).name || '') + ' · ' + y + '년</h2>';
  b += '<p style="font-size:9pt;text-align:center;margin:0 0 3mm">적립 ' + t.earn + '점 · 사용 ' + t.spend + '점 · <b>잔액 ' + t.balance + '점</b></p>';
  b += '<table><thead><tr><th style="width:22mm">날짜</th><th>내용</th><th style="width:20mm">점수</th></tr></thead><tbody>';
  rows.forEach(x => {
    const spend = x.kind === 'spend';
    b += '<tr><td class="ctr">' + esc(fmtShort(x.date)) + '</td><td>' + esc(spend ? ('사용·시상 — ' + (x.memo || '')) : [talentRecordLabel(x, s.deptId, y), x.memo].filter(Boolean).join(' · ')) + '</td><td class="ctr">' + (spend ? '−' : '+') + (Number(x.points) || 0) + '</td></tr>';
  });
  if (!rows.length) b += '<tr><td colspan="3" class="ctr">기록 없음</td></tr>';
  b += '</tbody><tfoot><tr><td colspan="2">잔액</td><td class="ctr">' + t.balance + '</td></tr></tfoot></table>';
  b += '<p style="font-size:8pt;color:#666;margin-top:3mm">기준 — ' + esc(items.map(x => x.label + ' ' + x.points).join(', ')) + '</p>';
  talentPrintDoc('달란트 내역서', b);
}

/* ---------------- 동작 ---------------- */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case 'tal-tab': V.talTab = t.dataset.v; renderApp(); return;
      case 'tal-dept': V.talDept = t.dataset.id; V.talCls = ''; renderApp(); return;
      case 'tal-cls': V.talCls = t.dataset.id; renderApp(); return;
      case 'tal-date-move': V.talDate = shiftDate(talentDate(), Number(t.dataset.v)); renderApp(); return;
      case 'tal-toggle': {
        if (!talentCanWrite()) return toast('달란트를 적립할 권한이 없습니다', 'err');
        const sid = t.dataset.sid, key = t.dataset.key;
        const s = (S.state.students || []).find(x => x.id === sid);
        if (!s) return;
        const date = talentDate();
        const items = talentDayItems(date, sid);
        if (items[key]) delete items[key]; else items[key] = 1;
        const rec = talentEarnRec(date, sid);
        saveTalentDay(date, s.deptId, sid, items, (rec && rec.bonus) || 0, (rec && rec.memo) || '');
        renderApp(); await Sync.save(); return;
      }
      case 'tal-bulk': {
        if (!talentCanWrite()) return toast('달란트를 적립할 권한이 없습니다', 'err');
        const deptId = talentDeptId();
        const key = t.dataset.key;
        const date = talentDate();
        const list = V.talCls ? studentsOfClassIn(V.talCls, talentYear()).filter(s => s.deptId === deptId) : studentsOfDept(deptId);
        list.forEach(s => {
          const items = talentDayItems(date, s.id);
          if (items[key]) return;
          items[key] = 1;
          const rec = talentEarnRec(date, s.id);
          saveTalentDay(date, s.deptId, s.id, items, (rec && rec.bonus) || 0, (rec && rec.memo) || '');
        });
        renderApp(); await Sync.save();
        toast(list.length + '명에게 ' + talentItemLabel(deptId, talentYear(), key) + ' 달란트를 주었습니다', 'ok');
        return;
      }
      case 'tal-clear': {
        if (!talentCanWrite()) return toast('권한이 없습니다', 'err');
        const deptId = talentDeptId();
        const date = talentDate();
        const list = V.talCls ? studentsOfClassIn(V.talCls, talentYear()).filter(s => s.deptId === deptId) : studentsOfDept(deptId);
        list.forEach(s => {
          const rec = talentEarnRec(date, s.id);
          if (!rec) return;
          saveTalentDay(date, s.deptId, s.id, {}, 0, '');
        });
        renderApp(); await Sync.save(); toast('그 날 적립을 모두 지웠습니다', 'ok'); return;
      }
      case 'tal-auto': {
        if (!talentCanWrite()) return;
        S.state.settings = S.state.settings || {};
        S.state.settings.talentAuto = !talentAutoOn();
        S.state.settings.updatedAt = Date.now();
        renderApp(); await Sync.save();
        toast(talentAutoOn() ? '출석하면 출석 달란트가 자동으로 붙습니다' : '자동 적립을 껐습니다 (달란트 탭에서 직접 부여)', 'ok');
        return;
      }
      case 'tal-rule-edit': talentRuleModal(); return;
      case 'tal-rule-add': {
        captureTalentRule();
        (V.talRuleEdit.items = V.talRuleEdit.items || []).push({ key: 'x' + Date.now().toString(36), label: '', points: 1 });
        const box = document.getElementById('talRuleList');
        if (box) box.innerHTML = talentRuleRowsHtml();
        return;
      }
      case 'tal-rule-del': {
        captureTalentRule();
        V.talRuleEdit.items.splice(Number(t.dataset.i), 1);
        const box = document.getElementById('talRuleList');
        if (box) box.innerHTML = talentRuleRowsHtml();
        return;
      }
      case 'tal-rule-reset': {
        V.talRuleEdit.items = defaultTalentItems();
        const box = document.getElementById('talRuleList');
        if (box) box.innerHTML = talentRuleRowsHtml();
        return;
      }
      case 'tal-rule-save': saveTalentRule(); return;
      case 'tal-rule-from-plan': talentRuleFromPlan(); return;
      case 'tal-spend-new': talentSpendModal(t.dataset.sid || ''); return;
      case 'tal-bonus-new': talentBonusModal(t.dataset.sid || ''); return;
      case 'tal-bonus-save': saveTalentBonus(t.dataset.sid); return;
      case 'tal-spend-save': saveTalentSpend(); return;
      case 'tal-spend-del': {
        const id = t.dataset.id;
        confirmBox('기록 삭제', '이 사용·시상 기록을 지울까요? 잔액이 다시 올라갑니다.', '삭제', async () => {
          const rec = (S.state.talents || []).find(x => x.id === id);
          if (rec) { rec._del = true; touch(rec); await Sync.save(); renderApp(); }
        });
        return;
      }
      case 'tal-detail': talentDetailModal(t.dataset.sid); return;
      case 'tal-print': printTalentLedger(); return;
      case 'tal-print-student': printTalentStudent(t.dataset.sid); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});

document.addEventListener('change', function (ev) {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.change) return;
  if (t.dataset.change === 'tal-date') { V.talDate = t.value; syncYearToDate(t.value); renderApp(); }
});
