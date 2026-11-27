/* 덕신교회 부서업무 — 월별계획안 (한글 양식 그대로)
   제목 · 교사회의 기도 · 기도해요 · 주차별 표(날짜·말씀·행사·담당자·기도·헌금위원·청소) ·
   행사 진행 · 교사(환경 구성·달란트 기준)를 한 장으로 입력·조회·인쇄하고,
   .hwpx 계획안을 올리면 이 칸들에 그대로 담습니다. */
'use strict';

/* ---------------- 화면 ---------------- */
function planView() {
  if (V.planMode === 'list') return planListView();
  return planSheetScreen();
}

function planSheetScreen() {
  if (!can('plan.read') && !can('plan.write')) return '<div class="card">' + emptyBox('🔒', '월별계획표를 볼 권한이 없습니다') + '</div>';
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  const ym = planState();
  if (!V.planDept || !depts.some(d => d.id === V.planDept)) V.planDept = depts[0].id;
  const dept = deptById(V.planDept);
  const sheet = planSheetOf(dept.id, ym);
  const w = can('plan.write');

  let h = subHead('월별계획표', '한글 계획안 양식 그대로 — 주차별 말씀·행사·담당자·기도·헌금위원·청소',
    (sheet ? '<button class="btn sm" data-act="plan-print">🖨 인쇄</button>' : '') +
    (w ? '<button class="btn primary sm" data-act="plan-sheet-edit">' + (sheet ? '✏️ 수정' : '＋ 작성') + '</button>' : ''));

  h += '<div class="card flat" style="padding:12px">' + monthBar('planMonth', ym, 'plan-month') +
    '<div class="row wrap" style="gap:6px">' + depts.map(d => '<button class="chip big ' + (d.id === dept.id ? 'coral' : 'gray') + '" data-act="plan-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div>';
  h += '<div class="row wrap" style="gap:6px;margin-top:10px">';
  if (w) h += '<button class="btn sm" data-act="plan-hwpx">📄 한글파일(.hwpx) 올리기</button>';
  h += '<button class="btn sm ghost" data-act="plan-legacy">📋 간단 목록 보기</button>';
  h += '</div></div>';

  if (!sheet) {
    h += '<div class="card">' + emptyBox('🗓️', esc(monthLabel(ym)) + ' ' + esc(dept.name) + ' 계획안이 없습니다', '한글(.hwpx) 계획안을 올리면 칸마다 자동으로 담기고, ＋ 작성으로 직접 적을 수도 있습니다') + '</div>';
    if (w) h += '<button class="btn primary block" data-act="plan-sheet-edit">＋ ' + esc(monthLabel(ym)) + ' 계획안 작성</button>';
    h += '<div class="card flat" style="margin-top:14px"><h3>📄 한글 계획안 자동 반영</h3><p class="muted" style="margin:0">계획안(.hwpx)의 표에서 <b>날짜·말씀·행사·담당자·기도·헌금위원·청소</b>를 줄마다 나눠 읽고, <b>기도해요·행사 진행·교사(환경 구성·달란트)</b>까지 각 칸에 넣습니다. 구버전 .hwp 는 한글에서 <b>다른 이름으로 저장 → .hwpx</b> 로 바꿔 올려 주세요.</p></div>';
    return h;
  }

  h += '<div class="card sheet-card">';
  h += '<div class="sheet-title">' + esc(sheet.title || planSheetTitle(dept.id, ym)) + '</div>';
  h += '<div class="sheet-sub">' + esc(dept.name) + ' · ' + esc(monthLabel(sheet.month || ym)) + (sheet.u ? ' · 고침 ' + timeAgo(sheet.u) : '') + '</div>';
  h += '<div class="sheet-band">' + esc(sheet.meeting || '교사회의 기도 – 한마디 기도') + '</div>';
  h += '<div class="sheet-sec"><div class="sheet-lab">기도해요</div><div class="sheet-body pre">' + (sheet.prayer ? esc(sheet.prayer) : '<span class="muted">—</span>') + '</div></div>';
  h += sheetTableHtml(sheet, w);
  h += '<div class="sheet-sec"><div class="sheet-lab">행사 진행</div><div class="sheet-body pre">' + (sheet.progress ? esc(sheet.progress) : '<span class="muted">—</span>') + '</div></div>';
  h += '<div class="sheet-sec"><div class="sheet-lab">교사</div><div class="sheet-body">';
  if (sheet.teacherEnv) h += '<div class="pre">' + esc(sheet.teacherEnv) + '</div>';
  const tl = (sheet.talent && sheet.talent.length) ? sheet.talent : parseTalentText(sheet.talentNote || '');
  if (tl && tl.length) {
    h += '<div class="row wrap" style="gap:6px;margin-top:6px"><span class="muted" style="font-size:11.5px;font-weight:800">달란트</span>' +
      tl.map(x => '<span class="chip violet">' + esc(x.label) + ' ' + esc(String(x.points)) + '</span>').join('') + '</div>';
  } else if (sheet.talentNote) h += '<div class="muted" style="margin-top:6px">' + esc(sheet.talentNote) + '</div>';
  else h += '<p class="muted" style="margin:6px 0 0">달란트 기준이 없습니다. 수정에서 적으면 기준으로도 불러올 수 있습니다.</p>';
  h += '</div></div>';
  if (sheet.note) h += '<div class="sheet-sec"><div class="sheet-lab">비고</div><div class="sheet-body pre">' + esc(sheet.note) + '</div></div>';
  h += '</div>';

  h += '<div class="card flat"><h3>🔗 주일보고 연결</h3><p class="muted" style="margin:0">주일보고를 쓰면 그 주일의 말씀·행사·담당자·기도·헌금위원·청소와 행사 진행이 자동으로 불러와집니다. 주일보고 화면에서 다시 불러올 수도 있습니다.</p></div>';
  return h;
}

function sheetTableHtml(sheet, editable) {
  const ws = sheet.weeks || [];
  let h = '<div class="sheet-scroll"><table class="sheet-tbl"><colgroup><col style="width:58px"><col style="width:22%"><col style="width:17%"><col style="width:14%"><col style="width:16%"><col style="width:13%"><col style="width:13%"></colgroup><thead><tr>';
  SHEET_COLS.forEach(c => { h += '<th>' + esc(c[1]) + '</th>'; });
  h += '</tr></thead><tbody>';
  if (!ws.length) h += '<tr><td colspan="7" class="ctr muted">주차가 없습니다. 수정에서 날짜를 넣어 주세요.</td></tr>';
  ws.forEach((w, i) => {
    const attr = editable ? ' data-act="plan-week" data-i="' + i + '" class="clickable"' : '';
    h += '<tr' + attr + '>';
    SHEET_COLS.forEach(c => {
      const v = c[0] === 'date' ? (w.date ? fmtShort(w.date) : '') : (w[c[0]] || '');
      h += '<td' + (c[0] === 'date' ? ' class="ctr"' : '') + (v ? '' : ' muted') + '>' + esc(v || (c[0] === 'date' ? '—' : '')) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (editable) h += '<p class="hint" style="margin:6px 2px 0">표의 줄을 누르면 그 주만 고칠 수 있습니다.</p>';
  return h;
}

/* ---------------- 작성·수정 ---------------- */
function planSheetEditorModal() {
  if (!can('plan.write')) return toast('계획안을 고칠 권한이 없습니다', 'err');
  const ym = planState();
  const dept = deptById(V.planDept);
  const cur = planSheetOf(V.planDept, ym);
  /* 편집 중이던 값이 있으면 그대로 이어서 (주차를 넣다가 적은 글을 잃지 않도록) */
  const s = V.sheetEdit ? JSON.parse(JSON.stringify(V.sheetEdit)) : (cur ? JSON.parse(JSON.stringify(cur)) : newPlanSheet(V.planDept, ym));
  V.sheetEdit = s;
  let h = '';
  h += '<div class="field"><label>제목</label><input id="psTitle" value="' + esc(s.title || '') + '" placeholder="예: 유치부 11월 교육계획"></div>';
  h += '<div class="field"><label>교사회의 기도 (한 줄 제목)</label><input id="psMeeting" value="' + esc(s.meeting || '') + '" placeholder="교사회의 기도 – 한마디 기도"></div>';
  h += '<div class="field"><label>기도해요</label><textarea id="psPrayer" style="min-height:92px" placeholder="*한 줄에 기도 제목 하나씩">' + esc(s.prayer || '') + '</textarea></div>';

  h += '<div class="sect-title" style="margin-top:14px">주차별 계획</div>';
  h += '<div class="row" style="margin-bottom:6px"><span class="muted" style="font-size:11.5px;flex:1">주차 줄을 누르면 그 주만 고칠 수 있어요.</span><button class="btn sm" data-act="ps-add-week">＋ 주차</button></div>';
  h += '<div class="list">';
  (s.weeks || []).forEach((w, i) => {
    const parts = SHEET_COLS.filter(c => c[0] !== 'date').map(c => (w[c[0]] ? c[1] + ' ' + w[c[0]] : '')).filter(Boolean);
    h += '<button class="item" data-act="ps-week" data-i="' + i + '"><span class="av" style="background:#efe9fd">' + esc(w.date ? fmtShort(w.date) : (i + 1) + '주') + '</span><span class="tx"><b>' + esc(w.word || '(말씀 없음)') + '</b><span>' + esc(parts.slice(1).join(' · ') || '—') + '</span></span><span class="rt">✎</span></button>';
  });
  h += '</div>';

  h += '<div class="field" style="margin-top:12px"><label>행사 진행</label><textarea id="psProgress" style="min-height:92px" placeholder="11/1 특별활동 – 복음십자가 – 김미성&#10;11/8 말씀공과 – 도시락 가방 만들기 – 교사전체">' + esc(s.progress || '') + '</textarea></div>';
  h += '<div class="field"><label>교사 — 환경 구성</label><textarea id="psEnv" style="min-height:64px" placeholder="예: 11월 – 사순절, 종려주일 환경 구성">' + esc(s.teacherEnv || '') + '</textarea></div>';
  h += '<div class="field"><label>달란트 기준 (교사 칸)</label><input id="psTalent" value="' + esc(s.talentNote || talentNoteOf(s)) + '" placeholder="달란트 – 출석 3, 가정 공과 3, 암송 10, 전도 20"><div class="hint">여기에 적은 숫자를 달란트 기준으로 불러올 수 있습니다.</div></div>';
  h += '<div class="field"><label>비고 (선택)</label><input id="psNote" value="' + esc(s.note || '') + '"></div>';
  h += '<div class="row" style="margin-top:8px">' + (cur ? '<button class="btn" style="color:#c33e5f" data-act="ps-del">삭제</button>' : '') + '<span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="ps-save">저장</button></div>';
  openModal('월별계획안 작성', h);
}

function talentNoteOf(s) {
  const list = (s && s.talent) || [];
  if (!list.length) return '';
  return '달란트 – ' + list.map(x => x.label + ' ' + x.points).join(', ');
}

function planWeekModal(i) {
  const fromEditor = !!document.getElementById('psTitle');
  if (fromEditor) captureSheetEdit();
  const ym = planState();
  const sheet = V.sheetEdit || planSheetOf(V.planDept, ym) || newPlanSheet(V.planDept, ym);
  const w = (sheet.weeks || [])[Number(i)] || emptySheetWeek('');
  V.sheetWeekEdit = { i: Number(i), week: JSON.parse(JSON.stringify(w)), fromEditor: fromEditor };
  let h = '';
  h += '<div class="field"><label>날짜 (주일)</label><input id="pwDate" type="date" value="' + esc(w.date || '') + '"></div>';
  SHEET_COLS.forEach(c => {
    if (c[0] === 'date') return;
    const long = ['word', 'event', 'prayer'].indexOf(c[0]) >= 0;
    h += '<div class="field"><label>' + esc(c[1]) + '</label>' + (long
      ? '<textarea id="pw_' + c[0] + '" style="min-height:56px" data-change="pw-dyn">' + esc(w[c[0]] || '') + '</textarea>'
      : '<input id="pw_' + c[0] + '" value="' + esc(w[c[0]] || '') + '" data-change="pw-dyn">') + '</div>';
  });
  h += '<div class="row" style="margin-top:8px"><button class="btn" data-act="ps-week-back">← 전체</button><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="pw-save">저장</button></div>';
  openModal('주차 계획', h);
}

function readWeekForm() {
  const w = (V.sheetWeekEdit && V.sheetWeekEdit.week) || emptySheetWeek('');
  SHEET_COLS.forEach(c => {
    const el = document.getElementById('pw_' + c[0]);
    if (el) w[c[0]] = String(el.value || '').trim();
  });
  return w;
}

/* 편집 창에 적힌 값을 편집 중인 계획안에 담아 둡니다 (창을 오갈 때 잃지 않도록) */
function captureSheetEdit() {
  const s = V.sheetEdit;
  if (!s) return null;
  const g = id => { const e = document.getElementById(id); return e ? String(e.value || '') : null; };
  const put = (id, key) => { const v = g(id); if (v !== null) s[key] = v; };
  put('psTitle', 'title'); put('psMeeting', 'meeting'); put('psPrayer', 'prayer');
  put('psProgress', 'progress'); put('psEnv', 'teacherEnv'); put('psTalent', 'talentNote'); put('psNote', 'note');
  return s;
}

/* ---------------- 저장 ---------------- */
function persistSheet(s) {
  const deptId = s.deptId || V.planDept;
  const ym = s.month || planState();
  const id = planSheetId(deptId, ym);
  S.state.planSheets = S.state.planSheets || [];
  let rec = S.state.planSheets.find(x => x.id === id);
  if (!rec) { rec = newPlanSheet(deptId, ym); S.state.planSheets.push(rec); }
  rec.deptId = deptId; rec.month = ym; rec.year = Number(String(ym).slice(0, 4));
  rec.title = String(s.title || planSheetTitle(deptId, ym)).trim();
  rec.meeting = String(s.meeting || '교사회의 기도 – 한마디 기도').trim();
  rec.prayer = s.prayer || '';
  rec.progress = s.progress || '';
  rec.teacherEnv = s.teacherEnv || '';
  rec.talentNote = s.talentNote || '';
  rec.talent = parseTalentText(rec.talentNote) || (s.talent || []);
  rec.note = s.note || '';
  rec.weeks = (s.weeks || []).map(w => {
    const o = { date: w.date || '' };
    SHEET_COLS.forEach(c => { if (c[0] !== 'date') o[c[0]] = w[c[0]] || ''; });
    return o;
  }).sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')));
  rec.by = S.me.uid; touch(rec); rec._del = false;
  s.weeks = rec.weeks.map(w => Object.assign({}, w));
  return rec;
}

function savePlanSheet() {
  if (!can('plan.write')) return toast('계획안을 고칠 권한이 없습니다', 'err');
  const s = captureSheetEdit() || newPlanSheet(V.planDept, planState());
  persistSheet(s);
  V.sheetEdit = null;
  closeModal();
  Sync.save().then(() => { renderApp(); toast('계획안을 저장했습니다 · 주일보고에도 연결됩니다', 'ok'); });
}

function saveWeekEdit() {
  if (!can('plan.write')) return toast('계획안을 고칠 권한이 없습니다', 'err');
  const w = readWeekForm();
  const back = !!(V.sheetWeekEdit && V.sheetWeekEdit.fromEditor);
  let s = captureSheetEdit();
  if (!s) {
    const rec = planSheetOf(V.planDept, planState());
    s = rec ? JSON.parse(JSON.stringify(rec)) : newPlanSheet(V.planDept, planState());
    V.sheetEdit = s;
  }
  s.weeks = s.weeks || [];
  const i = Number(V.sheetWeekEdit.i);
  while (s.weeks.length <= i) s.weeks.push(emptySheetWeek(''));
  s.weeks[i] = w;
  persistSheet(s);
  if (back) { planSheetEditorModal(); }
  else { V.sheetEdit = null; closeModal(); }
  Sync.save().then(() => { renderApp(); toast('주차 계획을 저장했습니다', 'ok'); });
}

function deletePlanSheet() {
  const ym = planState();
  const rec = planSheetOf(V.planDept, ym);
  if (!rec) return;
  confirmBox('계획안 삭제', monthLabel(ym) + ' ' + ((deptById(V.planDept) || {}).name || '') + ' 계획안을 지울까요? 인쇄본은 그대로 남습니다.', '삭제', async () => {
    rec._del = true; touch(rec);
    V.sheetEdit = null;
    await Sync.save(); closeModal(); renderApp(); toast('삭제했습니다', 'ok');
  });
}

/* ---------------- 인쇄 (A4 · 한글 양식) ---------------- */
function planSheetPrintCss() {
  return '@page{size:A4 portrait;margin:12mm 11mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#111;margin:0}' +
    'h1{font-size:15pt;text-align:center;margin:0 0 1mm;letter-spacing:-.4px}' +
    'h2{font-size:8.5pt;text-align:center;color:#666;font-weight:600;margin:0 0 4mm}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.6pt}' +
    'th,td{border:1px solid #222;padding:1.4mm 1.6mm;vertical-align:middle;word-break:keep-all;line-height:1.35}' +
    'th{background:#f2f2f2;font-weight:700;text-align:center;font-size:8.4pt}' +
    'td.ctr{text-align:center}' +
    'td.lab,td.band{background:#f7f7f7;font-weight:700;text-align:center}' +
    'td.band{background:#efefef;font-size:9.4pt;letter-spacing:.5px}' +
    'td.box{white-space:pre-wrap;vertical-align:top;min-height:14mm}' +
    'p.foot{font-size:7pt;color:#999;text-align:center;margin-top:4mm}';
}
function planSheetPrintBody(sheet, deptName) {
  const ws = sheet.weeks || [];
  let b = '<h1>' + esc(sheet.title || '') + '</h1><h2>' + esc(deptName) + ' · ' + esc(monthLabel(sheet.month || '')) + '</h2>';
  b += '<table><colgroup><col style="width:16mm"><col style="width:20%"><col style="width:17%"><col style="width:15%"><col style="width:15%"><col style="width:12%"><col style="width:11%"></colgroup>';
  b += '<tr><td style="width:16mm"></td><td class="band" colspan="6">' + esc(sheet.meeting || '교사회의 기도 – 한마디 기도') + '</td></tr>';
  b += '<tr><td class="lab">기도<br>해요</td><td class="box" colspan="6">' + esc(sheet.prayer || '') + '</td></tr>';
  b += '<tr>';
  SHEET_COLS.forEach(c => { b += '<th>' + esc(c[1]) + '</th>'; });
  b += '</tr>';
  ws.forEach(w => {
    b += '<tr>';
    SHEET_COLS.forEach(c => {
      const v = c[0] === 'date' ? (w.date ? fmtShort(w.date) : '') : (w[c[0]] || '');
      b += '<td class="' + (c[0] === 'date' ? 'ctr' : '') + ' box">' + esc(v) + '</td>';
    });
    b += '</tr>';
  });
  if (!ws.length) b += '<tr><td class="ctr box" colspan="7">—</td></tr>';
  b += '<tr><td class="lab">행사<br>진행</td><td class="box" colspan="6">' + esc(sheet.progress || '') + '</td></tr>';
  const tl = (sheet.talent && sheet.talent.length) ? sheet.talent : parseTalentText(sheet.talentNote || '');
  let teacher = String(sheet.teacherEnv || '');
  if (tl && tl.length) teacher += (teacher ? '\n' : '') + '달란트 – ' + tl.map(x => x.label + ' ' + x.points).join(', ');
  else if (sheet.talentNote) teacher += (teacher ? '\n' : '') + sheet.talentNote;
  b += '<tr><td class="lab">교사</td><td class="box" colspan="6">' + esc(teacher) + '</td></tr>';
  b += '</table>';
  return b;
}
function printPlanSheet(sheet) {
  const dept = deptById(sheet.deptId) || {};
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다. 브라우저의 팝업 허용을 켜 주세요', 'err');
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(sheet.title || '월별계획안') + '</title><style>' +
    planSheetPrintCss() + '</style></head><body>' + planSheetPrintBody(sheet, dept.name || '') +
    '<p class="foot">' + esc((S.state.settings && S.state.settings.church) || '덕신교회') + ' 교육부서 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script></body></html>';
  w.document.open(); w.document.write(html); w.document.close();
}

/* ================= 한글(.hwpx) 계획안 읽기 ================= */

/* 문단(<p>) 안의 글자만 — 줄 사이에 공백을 넣지 않습니다 */
function hwpxRunText(el) {
  const parts = [];
  const walk = n => {
    if (n.nodeType === 1 && String(n.nodeName).split(':').pop() === 't') parts.push(n.textContent || '');
    if (n.childNodes) for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
  };
  walk(el);
  return parts.join('');
}
/* 표 한 칸의 줄들 — 한글은 한 줄이 한 문단(<p>)입니다 */
function hwpxCellLines(tc) {
  const ps = Array.prototype.slice.call(tc.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'p' && elTag(e.parentNode, 'tc') === tc);
  let lines = ps.map(p => hwpxRunText(p).replace(/\u00a0/g, ' ').replace(/\s+$/g, '').replace(/^\s+/, ''));
  lines = lines.filter(l => l !== '');
  if (!lines.length) { const t = hwpxText(tc); if (t) lines = [t]; }
  return lines;
}
/* 문단 글자 — 표(<tbl>) 안의 글자는 빼고 문단에 직접 적힌 글자만 */
function hwpxParaText(el) {
  const parts = [];
  const walk = n => {
    if (n.nodeType === 1) {
      const tag = String(n.nodeName).split(':').pop();
      if (tag === 'tbl') return;
      if (tag === 't') { parts.push(n.textContent || ''); return; }
    }
    if (n.childNodes) for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
/* 표를 7칸 격자로 — 병합(colSpan)은 빈 칸으로 채워 열 위치를 맞춥니다 */
function hwpxGrid(tbl) {
  const trs = Array.prototype.slice.call(tbl.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'tr' && elTag(e.parentNode, 'tbl') === tbl);
  const rows = [];
  trs.forEach(tr => {
    const tcs = Array.prototype.slice.call(tr.getElementsByTagName('*')).filter(e => String(e.nodeName).split(':').pop() === 'tc' && elTag(e.parentNode, 'tr') === tr);
    const row = [];
    tcs.forEach(tc => {
      let span = 1;
      const all = Array.prototype.slice.call(tc.getElementsByTagName('*'));
      const cs = all.find(e => String(e.nodeName).split(':').pop() === 'cellSpan');
      if (cs) {
        const v = Number(cs.getAttribute('colSpan') || cs.getAttribute('colspan') || cs.getAttribute('hp:colSpan') || 1);
        if (v > 0) span = v;
      }
      const lines = hwpxCellLines(tc);
      row.push({ text: lines.join('\n'), lines: lines, span: span });
      for (let i = 1; i < span; i++) row.push({ text: '', lines: [], span: 0, filler: true });
    });
    if (row.some(c => c.text)) rows.push(row);
  });
  return rows;
}
function normCell(s) { return String(s || '').replace(/\s+/g, ''); }
function splitLines(text) {
  return String(text || '').split(/\r?\n/).map(s => s.replace(/\s+$/, '').replace(/^\s+/, '')).filter(s => s !== '');
}
function pickLine(lines, i, n) {
  if (!lines || !lines.length) return '';
  if (lines.length === 1 && n > 1) return lines[0];
  return lines[i] != null ? lines[i] : '';
}

/* 계획안 표 하나 읽기 → {prayer, meeting, weeks, progress, teacherEnv, talentNote, talent} */
function parseSheetTable(tbl, yearGuess) {
  const grid = hwpxGrid(tbl);
  if (!grid.length) return null;
  const hIdx = grid.findIndex(r => normCell(r[0] && r[0].text) === '날짜' && r.some(c => /말씀/.test(normCell(c.text))));
  if (hIdx < 0) return null;
  const hdr = grid[hIdx].map(c => normCell(c.text));
  const colOf = names => {
    for (const nm of names) { const i = hdr.indexOf(nm); if (i >= 0) return i; }
    return -1;
  };
  const ci = {
    date: colOf(['날짜']), word: colOf(['말씀']), event: colOf(['행사']), owner: colOf(['담당자']),
    prayer: colOf(['기도']), offering: colOf(['헌금위원']), cleaning: colOf(['청소'])
  };
  if (ci.date < 0) return null;
  /* 7칸이 아니어도 이름이 붙은 칸이 4개 이상이면 계획안 표로 봅니다 */
  if (Object.keys(ci).filter(k => ci[k] >= 0).length < 4) return null;

  let prayer = '', meeting = '';
  for (let i = 0; i < hIdx; i++) {
    const row = grid[i];
    const joined = row.map(c => c.text).join('\n');
    if (!meeting && /교사회의/.test(normCell(joined))) {
      const cells = row.filter(c => c.text && !c.filler);
      const head = cells.find(c => /교사회의/.test(normCell(c.text)));
      const extra = head ? head.lines.filter(l => !/교사회의/.test(normCell(l))) : [];
      meeting = head ? (extra.length ? head.lines[0] : head.text.split('\n')[0]) : joined.trim();
      if (extra.length > 1) prayer = (prayer ? prayer + '\n' : '') + extra.slice(1).join('\n');
    }
    if (!prayer && /^(기도해요|기도)$/.test(normCell(row[0] && row[0].text))) {
      const body = row.slice(1).filter(c => c.text && !c.filler).sort((a, b) => b.text.length - a.text.length)[0];
      if (body) prayer = body.lines.join('\n');
    }
  }

  /* 주차 줄 — 머리글 다음부터 '행사 진행'·'교사' 줄 전까지. 한 줄에 여러 줄이 들어 있을 수도, 여러 줄일 수도 있습니다 */
  const weekRows = [];
  let progress = '', teacherEnv = '', talentNote = '';
  for (let i = hIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const lbl = normCell(row[0] && row[0].text);
    const body = row.slice(1).filter(c => c.text && !c.filler);
    if (/행사진행/.test(lbl)) { progress = body.length ? body[0].lines.join('\n') : ''; continue; }
    if (/^교사$/.test(lbl)) {
      const lines = body.length ? body.reduce((a, c) => a.concat(c.lines), []) : [];
      const tal = [], env = [];
      lines.forEach(l => { if (/달란트/.test(l)) tal.push(l); else env.push(l); });
      teacherEnv = env.join('\n');
      talentNote = tal.join(' ');
      continue;
    }
    if (/비고|특기|참고/.test(lbl)) continue;
    if (lbl && lbl.length <= 4 && ci.date !== 0) continue;
    weekRows.push(row);
  }
  if (!weekRows.length) return null;

  /* 칸마다 줄을 모아 순서대로 맞춥니다 (1줄짜리 칸은 모든 주에 같은 값) */
  const linesOf = f => {
    const out = [];
    weekRows.forEach(r => {
      const cell = r[ci[f]];
      if (!cell) return;
      splitLines(cell.text).forEach(l => out.push(l));
    });
    return out;
  };
  const L = {};
  SHEET_COLS.forEach(c => { L[c[0]] = linesOf(c[0]); });
  const n = Math.max(0, ...SHEET_COLS.map(c => L[c[0]].length));
  if (!n) return null;
  const yg = String(yearGuess || new Date().getFullYear());
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const rawdate = pickLine(L.date, i, n);
    let d = rawdate ? dateFromText(rawdate, yg + '-01') : '';
    weeks.push({
      date: d, word: pickLine(L.word, i, n), event: pickLine(L.event, i, n),
      owner: pickLine(L.owner, i, n), prayer: pickLine(L.prayer, i, n),
      offering: pickLine(L.offering, i, n), cleaning: pickLine(L.cleaning, i, n)
    });
  }
  /* 날짜가 빠진 줄은 그 달의 주일 순서로 채웁니다 */
  const monthHit = weeks.map(w => w.date).filter(Boolean).sort()[0];
  const month = monthHit ? monthHit.slice(0, 7) : '';
  if (month) {
    const suns = sundaysOfMonth(month);
    weeks.forEach((w, i) => { if (!w.date && suns[i]) w.date = suns[i]; });
  }
  return {
    prayer: prayer, meeting: meeting, weeks: weeks, progress: progress,
    teacherEnv: teacherEnv, talentNote: talentNote, talent: parseTalentText(talentNote) || [],
    month: month
  };
}

/* .hwpx 파일 → 계획안 */
async function parsePlanSheetHwpx(file) {
  const buf = await readFileBytes(file);
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isCfb = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isCfb) throw new Error('구버전 한글(.hwp) 파일입니다. 한글에서 [다른 이름으로 저장] → [한글 문서(*.hwpx)]로 저장한 뒤 올려 주세요.');
  if (!isZip) throw new Error('한글(.hwpx) 파일이 아닙니다. 확장자를 확인해 주세요.');
  const sections = await hwpxSections(buf);
  const parser = new DOMParser();
  let best = null, title = '', deptName = '';
  const yg = Number(String(planState()).slice(0, 4)) || new Date().getFullYear();
  for (const xml of sections) {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) continue;
    const all = Array.prototype.slice.call(doc.getElementsByTagName('*'));
    const tables = all.filter(e => String(e.nodeName).split(':').pop() === 'tbl');
    for (const tbl of tables) {
      const got = parseSheetTable(tbl, yg);
      if (got && (!best || got.weeks.length > best.weeks.length)) best = got;
    }
    /* 표 밖 글(제목) — 표 안 글자는 빼고 문단 글자만. 제목 문단은 표를 품고 있을 수 있습니다 */
    const ps = all.filter(e => String(e.nodeName).split(':').pop() === 'p');
    ps.forEach(p => {
      const t = hwpxParaText(p);
      if (!t || title) return;
      if (/(교육계획|계획안|월계획)/.test(t) && t.length <= 40) title = t;
    });
  }
  if (!best) return { ok: false };
  /* 제목에서 부서·월 */
  let month = best.month || '';
  const tm = title.match(/(\d{1,2})\s*월/);
  if (!month && tm) month = String(yg) + '-' + pad2(Number(tm[1]));
  const depts = (S.state.departments || []).filter(d => !d._del);
  const hit = depts.find(d => title && title.indexOf(d.name) >= 0);
  if (hit) deptName = hit.name;
  if (!title) {
    const m = best.talentNote || best.teacherEnv || '';
    const mm = m.match(/(\d{1,2})\s*월/);
    if (mm && !month) month = String(yg) + '-' + pad2(Number(mm[1]));
    title = (deptName || '부서') + ' ' + (month ? Number(month.slice(5, 7)) : '') + '월 교육계획';
  }
  return { ok: true, sheet: best, title: title, deptName: deptName, month: month, deptId: hit ? hit.id : '' };
}

/* 올린 계획안을 어느 부서·어느 달에 담을지 확인 */
function sheetImportModal(res, fname) {
  const depts = visibleDepts().length ? visibleDepts() : (S.state.departments || []).filter(d => !d._del);
  const guessDept = res.deptId || (depts[0] ? depts[0].id : '');
  const guessMonth = res.month || planState();
  V.sheetImport = { res: res, fname: fname, deptId: guessDept, month: guessMonth };
  const ws = res.sheet.weeks || [];
  let h = '<div class="banner sky">' + esc(fname) + ' 에서 계획안 표를 찾았습니다. <b>' + ws.length + '개 주차</b>' +
    (res.sheet.prayer ? ' · 기도제목' : '') + (res.sheet.progress ? ' · 행사 진행' : '') + (res.sheet.talent.length ? ' · 달란트 ' + res.sheet.talent.length + '항목' : '') + '</div>';
  h += '<div class="grid2"><div class="field"><label>부서</label><select id="siDept">' + depts.map(d => '<option value="' + esc(d.id) + '"' + (d.id === guessDept ? ' selected' : '') + '>' + esc((d.emoji || '') + ' ' + d.name) + '</option>').join('') + '</select></div>';
  h += '<div class="field"><label>담을 달</label><input id="siMonth" type="month" value="' + esc(guessMonth) + '"></div></div>';
  h += '<div class="field"><label>제목</label><input id="siTitle" value="' + esc(res.title || '') + '"></div>';
  h += '<div class="card flat" style="padding:10px;margin:6px 0 12px"><div class="muted" style="font-size:11.5px;font-weight:700;margin-bottom:6px">읽어 온 내용</div>';
  h += '<div class="kv"><span>교사회의 기도</span><b>' + esc(res.sheet.meeting || '-') + '</b></div>';
  h += '<div class="kv"><span>기도해요</span><b>' + esc(String(res.sheet.prayer || '').split('\n').filter(Boolean).length) + '줄</b></div>';
  ws.forEach(w => {
    h += '<div class="kv"><span>' + esc(w.date ? fmtShort(w.date) : '-') + '</span><b style="text-align:right">' + esc(w.word || '-') + '<br><span class="muted" style="font-weight:600">' + esc([w.event, w.owner, w.prayer, w.offering, w.cleaning].filter(Boolean).join(' · ') || '—') + '</span></b></div>';
  });
  h += '</div>';
  h += '<div class="row wrap" style="gap:8px;align-items:flex-start"><input type="checkbox" id="siTalent" checked style="width:18px;height:18px;margin-top:2px"><span style="font-size:12.5px;font-weight:600">달란트 기준도 함께 저장' + (res.sheet.talent.length ? ' (' + esc(res.sheet.talent.map(x => x.label + ' ' + x.points).join(', ')) + ')' : ' (읽은 달란트 기준 없음)') + '</span></div>';
  h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="modal-close">취소</button><span class="sp"></span><button class="btn primary" data-act="si-save">이 계획안으로 저장</button></div>';
  openModal('한글파일 → 월별계획안', h);
}

async function saveSheetImport() {
  const box = V.sheetImport;
  if (!box) return;
  const deptId = (document.getElementById('siDept') || {}).value || '';
  const month = (document.getElementById('siMonth') || {}).value || '';
  const title = (document.getElementById('siTitle') || {}).value || '';
  const withTalent = !!(document.getElementById('siTalent') || {}).checked;
  if (!deptId || !/^\d{4}-\d{2}$/.test(month)) return toast('부서와 달을 골라 주세요', 'err');
  const src = box.res.sheet;
  const id = planSheetId(deptId, month);
  let rec = (S.state.planSheets || []).find(x => x.id === id);
  const exists = !!rec && !rec._del;
  if (!rec) { rec = newPlanSheet(deptId, month); S.state.planSheets.push(rec); }
  rec.deptId = deptId; rec.month = month; rec.year = Number(month.slice(0, 4));
  rec.title = String(title || planSheetTitle(deptId, month)).trim();
  rec.meeting = src.meeting || '교사회의 기도 – 한마디 기도';
  rec.prayer = src.prayer || '';
  rec.progress = src.progress || '';
  rec.teacherEnv = src.teacherEnv || '';
  rec.talentNote = src.talentNote || '';
  rec.talent = (src.talent || []).slice();
  rec.weeks = (src.weeks || []).map(w => {
    const o = { date: w.date || '' };
    SHEET_COLS.forEach(c => { if (c[0] !== 'date') o[c[0]] = w[c[0]] || ''; });
    return o;
  });
  rec.by = S.me.uid; rec.u = Date.now(); rec._del = false;
  if (withTalent && (src.talent || []).length) {
    const rid = talentRuleId(deptId, rec.year);
    let rule = (S.state.talentRules || []).find(x => x.id === rid);
    if (!rule) { rule = { id: rid, deptId: deptId, year: rec.year, items: [], u: 0 }; S.state.talentRules.push(rule); }
    rule.items = src.talent.map(x => ({ key: x.key, label: x.label, points: x.points }));
    touch(rule);
  }
  V.planDept = deptId; V.planMonth = month;
  V.sheetImport = null;
  await Sync.save();
  closeModal();
  renderApp();
  toast('계획안을 저장했습니다' + (exists ? ' (같은 달 계획안을 새로 담았습니다)' : '') + ' · 주일보고에 연결됩니다', 'ok');
}

/* ---------------- 동작 ---------------- */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case 'plan-legacy': V.planMode = 'list'; renderApp(); return;
      case 'plan-sheet': V.planMode = ''; renderApp(); return;
      case 'plan-sheet-edit': planSheetEditorModal(); return;
      case 'plan-week': planWeekModal(Number(t.dataset.i)); return;
      case 'ps-save': savePlanSheet(); return;
      case 'ps-del': deletePlanSheet(); return;
      case 'ps-week': planWeekModal(Number(t.dataset.i)); return;
      case 'ps-week-back': { V.sheetWeekEdit = null; planSheetEditorModal(); return; }
      case 'ps-add-week': {
        const s = captureSheetEdit();
        if (!s) return;
        s.weeks = s.weeks || [];
        const last = s.weeks.length ? s.weeks[s.weeks.length - 1].date : '';
        let next = '';
        if (last) { const d = parseYmd(last); d.setDate(d.getDate() + 7); next = ymd(d); }
        s.weeks.push(emptySheetWeek(next));
        planSheetEditorModal();
        return;
      }
      case 'pw-save': saveWeekEdit(); return;
      case 'plan-print': {
        const sheet = planSheetOf(V.planDept, planState());
        if (!sheet) return toast('인쇄할 계획안이 없습니다', 'err');
        printPlanSheet(sheet);
        return;
      }
      case 'si-save': await saveSheetImport(); return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});

/* 창을 닫으면 편집 중이던 사본을 버립니다 (다음에 열 때 저장된 값부터) */
document.addEventListener('click', function (ev) {
  const t = ev.target.closest('[data-act="modal-close"]');
  if (!t) return;
  V.sheetEdit = null;
  V.sheetWeekEdit = null;
});

/* 주차 칸에서 글을 고치면 편집 중인 계획안에 담아 둡니다 (화면을 다시 그려도 남도록) */
document.addEventListener('input', function (ev) {
  const t = ev.target;
  if (!t || !t.id || t.id.indexOf('pw_') !== 0) return;
  if (!V.sheetWeekEdit) return;
  const key = t.id.slice(3);
  if (key === 'date') V.sheetWeekEdit.week.date = t.value;
  else if (SHEET_LABEL[key]) V.sheetWeekEdit.week[key] = t.value;
});

/* ---------------- 주일보고 연계 ---------------- */
/* 그 주일의 계획안 줄을 보고서에 담습니다. 빈 칸만 채우고, 손으로 고친 값은 그대로 둡니다. */
function applySheetToReport(rep, stampOnly) {
  if (!rep) return false;
  const snap = planSnapshotFor(rep.deptId, rep.date);
  if (!snap) return false;
  rep.plan = snap;
  if (!stampOnly) {
    if (!rep.scripture && snap.word) rep.scripture = snap.word;
    if (!rep.lesson && snap.word) rep.lesson = snap.word;
    /* 기도 칸은 '기도 맡은 사람'이라 기도제목란에는 넣지 않고 특이사항에 적습니다 */
    const notes = [
      snap.word ? '말씀: ' + snap.word : '',
      snap.event ? '행사: ' + snap.event : '',
      snap.owner ? '담당자: ' + snap.owner : '',
      snap.prayer ? '기도: ' + snap.prayer : '',
      snap.offering ? '헌금위원: ' + snap.offering : '',
      snap.cleaning ? '청소: ' + snap.cleaning : '',
      snap.progress || ''
    ].filter(Boolean).join('\n');
    if (!rep.notes && notes) rep.notes = notes;
  }
  touch(rep);
  return true;
}
/* 인쇄·보기용 계획 표 (말씀·행사·담당자·기도·헌금위원·청소) */
function planBlockHtml(snap) {
  if (!snap) return '';
  let h = '<div class="plan-kv">';
  [['word', '말씀'], ['event', '행사'], ['owner', '담당자'], ['prayer', '기도'], ['offering', '헌금위원'], ['cleaning', '청소']].forEach(x => {
    if (!snap[x[0]]) return;
    h += '<div class="kv"><span>' + esc(x[1]) + '</span><b>' + esc(snap[x[0]]) + '</b></div>';
  });
  h += '</div>';
  if (snap.progress) h += '<div class="muted" style="margin-top:4px;font-size:12px;white-space:pre-wrap">' + esc(snap.progress) + '</div>';
  return h;
}
