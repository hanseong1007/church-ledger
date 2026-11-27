/* 덕신교회 부서업무 — 회계 통계 · 개별 항목 조회 · 연말 결산/예산 보고서 (2026-11-27 추가)
   · 회계 화면을 `장부 / 통계 / 항목별 조회 / 연말 결산·예산` 네 가지로 나눕니다.
   · 통계: 월간·연간 항목별 합계·건수·비중, 펼쳐 보는 세부 거래, A4 인쇄.
   · 항목별 조회: 행사·항목 하나를 골라 `수입 | 지출` 2단 보고서 양식으로 조회·인쇄.
   · 연말 결산·예산: 올해 결산은 장부에서 자동 합산, 다음 해 예산은 직접 적고 시트에 저장.
   자료는 기존과 같은 암호문 한 덩어리에 함께 저장됩니다. */
'use strict';

/* ================= 1. 항목(분류) =================
   입력 화면의 항목 목록입니다. 예전에 쓰던 항목 이름도 그대로 남겨 두어 기존 기록을 고칠 때
   선택지가 사라지지 않습니다. */
const LEDGER_CATS_IN = [
  '주정헌금', '지원금', '찬조금', '기타수입(이자)', '전년도이월금',
  '헌금', '주일헌금', '감사헌금', '특별헌금', '찬조', '기타수입'
];
const LEDGER_CATS_OUT = [
  '간식비', '생일잔치(교사,아동)', '환경정리 및 비품', '특별활동 재료비', '여름성경학교',
  '공과(상/하반기)', '축하 및 위로', '어린이날행사', '달란트시장', '겨울성경학교',
  '졸업 및 연말시상', '교사단합 및 식사', '성탄절선물 및 준비', '미션 이벤트 쿠폰', '반별모임',
  '불이웃돕기',
  '교육자료', '간식·식비', '행사물품', '선물·상품', '교통비', '기타지출'
];
function ledgerCatsOf(type) { return type === 'in' ? LEDGER_CATS_IN : LEDGER_CATS_OUT; }
function catListFor(type, current) {
  const base = ledgerCatsOf(type).slice();
  const cur = String(current || '').trim();
  if (cur && base.indexOf(cur) < 0) base.push(cur);
  return base;
}

/* ================= 2. 공통 조회 ================= */
function ledMode() { return V.ledMode || 'book'; }
function ledPeriod() { return V.ledPeriod === 'year' ? 'year' : 'month'; }
function ledCatOf(e) {
  const c = String((e && e.category) || '').trim();
  if (c) return c;
  return (e && e.type === 'out') ? '지출' : '수입';
}
function ledYearEntries() {
  return (S.state.ledger || []).filter(e => e && !e._del && inYear(e) && (e.type === 'in' || e.type === 'out'));
}
function ledPeriodEntries() {
  const ym = ledgerState();
  let list = ledYearEntries();
  if (V.ledDept) list = list.filter(e => e.deptId === V.ledDept);
  if (ledPeriod() === 'month') list = list.filter(e => monthKeyOf(e.date) === ym);
  return list;
}
function ledPeriodLabel() {
  return ledPeriod() === 'year' ? (curYear() + '년') : monthLabel(ledgerState());
}
function ledDeptLabel() {
  if (!V.ledDept) return '전체 부서';
  return ((deptById(V.ledDept) || {}).name || '');
}
function ledByDate(a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }
function ledSum(list) { return list.reduce((s, e) => s + (Number(e.amount) || 0), 0); }
function ledPct(part, total) {
  if (!total) return '0';
  const v = Math.round((part / total) * 1000) / 10;
  return (v % 1 ? v.toFixed(1) : String(v));
}
function ledChurch() { return (S.state.settings && S.state.settings.church) || '덕신교회'; }

/* 항목별로 묶고, 정해진 항목 순서 → 금액 큰 순서로 정렬합니다 */
function ledGroup(list, type) {
  const map = new Map();
  list.filter(e => e.type === type).forEach(e => {
    const cat = ledCatOf(e);
    let g = map.get(cat);
    if (!g) { g = { cat: cat, amount: 0, count: 0, rows: [] }; map.set(cat, g); }
    g.amount += Number(e.amount) || 0;
    g.count++;
    g.rows.push(e);
  });
  const order = ledgerCatsOf(type);
  return Array.from(map.values()).sort((a, b) => {
    const ia = order.indexOf(a.cat), ib = order.indexOf(b.cat);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return b.amount - a.amount;
  });
}

/* ================= 3. 화면 틀 ================= */
function ledgerModeChips() {
  const m = ledMode();
  const items = [['book', '📒 장부'], ['stat', '📊 통계'], ['item', '📄 항목별 조회'], ['year', '📅 연말 결산·예산']];
  return '<div class="row wrap" style="gap:6px;margin:0 0 12px">' + items.map(x =>
    '<button class="chip big ' + (m === x[0] ? 'coral' : 'gray') + '" data-act="led-mode" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
}

function ledgerView() {
  if (!can('ledger.manage')) return '<div class="card">' + emptyBox('🔒', '회계는 교육부서담당·목회자·관리자만 볼 수 있습니다') + '</div>';
  ledgerState();
  const m = ledMode();
  const sub = m === 'book' ? '부서 수입·지출과 영수증을 한 곳에서 정리합니다'
    : m === 'stat' ? '월간·연간 항목별 통계를 조회하고 인쇄합니다'
      : m === 'item' ? '항목(행사) 하나를 골라 수입·지출 2단 보고서로 조회·인쇄합니다'
        : '올해 사업결산과 다음 해 예산을 작성해 인쇄합니다';
  const btn = '<button class="btn sm" data-act="led-print-' + m + '">🖨 인쇄</button>';
  let h = subHead('회계 관리', sub, btn);
  h += ledgerModeChips();
  if (m === 'stat') h += ledgerStatBody();
  else if (m === 'item') h += ledgerItemBody();
  else if (m === 'year') h += ledgerYearBody();
  else h += ledgerBookBody();
  return h;
}

function ledPeriodBar() {
  const p = ledPeriod();
  let h = '<div class="row wrap" style="gap:6px;margin-bottom:10px">' +
    '<button class="chip big ' + (p === 'month' ? 'coral' : 'gray') + '" data-act="led-period" data-v="month">월간</button>' +
    '<button class="chip big ' + (p === 'year' ? 'coral' : 'gray') + '" data-act="led-period" data-v="year">연간</button></div>';
  if (p === 'month') {
    h += '<div class="daybar"><button class="icon-btn" data-act="led-month" data-v="-1">‹</button>' +
      '<div class="month-label">' + esc(monthLabel(ledgerState())) + '</div>' +
      '<button class="icon-btn" data-act="led-month" data-v="1">›</button></div>';
  } else {
    h += '<div class="daybar"><div class="month-label">' + curYear() + '년 1월 ~ 12월</div></div>';
  }
  return h;
}

function ledDeptChips(withAll) {
  const depts = visibleDepts();
  let h = '<div class="row wrap" style="gap:6px">';
  if (withAll !== false) h += '<button class="chip big ' + (!V.ledDept ? 'coral' : 'gray') + '" data-act="led-dept" data-id="">전체 부서</button>';
  h += depts.map(d => '<button class="chip big ' + (d.id === V.ledDept ? 'coral' : 'gray') + '" data-act="led-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('');
  return h + '</div>';
}

/* ================= 4. 통계 ================= */
function ledgerStatBody() {
  const list = ledPeriodEntries();
  const inc = list.filter(e => e.type === 'in');
  const out = list.filter(e => e.type === 'out');
  const incT = ledSum(inc), outT = ledSum(out);
  const gi = ledGroup(list, 'in'), go = ledGroup(list, 'out');

  let h = '<div class="card flat" style="padding:12px">' + ledPeriodBar() + ledDeptChips() + '</div>';
  h += '<div class="stat-grid" style="margin-bottom:12px">' +
    '<div class="stat present"><b>' + money(incT) + '</b><span>수입 계</span></div>' +
    '<div class="stat absent"><b>' + money(outT) + '</b><span>지출 계</span></div>' +
    '<div class="stat enroll"><b>' + money(incT - outT) + '</b><span>수지</span></div>' +
    '<div class="stat new"><b>' + (inc.length + out.length) + '</b><span>거래 건수</span></div></div>';

  h += ledCatTable('in', gi, incT);
  h += ledCatTable('out', go, outT);

  if (ledPeriod() === 'year') h += ledMonthTrendTable();

  h += '<p class="muted" style="margin-top:10px">항목을 누르면 그 항목의 거래 내역이 펼쳐집니다. 위의 <b>🖨 인쇄</b>로 요약 또는 세부 내역까지 A4로 인쇄할 수 있습니다.</p>';
  return h;
}

function ledCatTable(type, groups, total) {
  const isIn = type === 'in';
  const title = isIn ? '＋ 수입 항목별' : '－ 지출 항목별';
  const count = groups.reduce((n, g) => n + g.count, 0);
  let h = '<div class="card"><h3>' + title + '<span class="sp"></span><small>' + money(total) + '원 · ' + count + '건</small></h3>';
  if (!groups.length) return h + '<p class="muted" style="margin:0">이 기간에 기록이 없습니다.</p></div>';
  h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="num">건수</th><th class="num">금액</th><th class="num">비중</th></tr></thead><tbody>';
  groups.forEach(g => {
    const key = (isIn ? 'i:' : 'o:') + g.cat;
    const open = !!(V.ledOpen || {})[key];
    h += '<tr data-act="led-cat-open" data-v="' + esc(key) + '" style="cursor:pointer">' +
      '<td><b>' + (open ? '▾ ' : '▸ ') + esc(g.cat) + '</b></td>' +
      '<td class="num">' + g.count + '</td><td class="num">' + money(g.amount) + '</td>' +
      '<td class="num">' + ledPct(g.amount, total) + '%</td></tr>';
    if (open) {
      const rows = g.rows.slice().sort(ledByDate);
      h += '<tr><td colspan="4" style="background:#fffaf6;padding:6px 8px">';
      h += '<table class="tbl" style="font-size:11.5px">' + rows.map(e =>
        '<tr><td style="border:0;padding:3px 0;color:#8a7a70;width:74px">' + esc(fmtShort(e.date)) + '</td>' +
        '<td style="border:0;padding:3px 0">' + esc(String(e.memo || '').trim() || '—') + (V.ledDept ? '' : ' <span class="muted">· ' + esc((deptById(e.deptId) || {}).name || '공통') + '</span>') + '</td>' +
        '<td class="num" style="border:0;padding:3px 0">' + money(e.amount) + '</td></tr>').join('') + '</table>';
      h += '</td></tr>';
    }
  });
  h += '</tbody><tfoot><tr><td><b>계</b></td><td class="num">' + count + '</td><td class="num"><b>' + money(total) + '</b></td><td class="num">100%</td></tr></tfoot></table></div></div>';
  return h;
}

/* 연간 통계 — 달별 수입·지출·수지 */
function ledMonthTrendTable() {
  const list = ledYearEntries().filter(e => !V.ledDept || e.deptId === V.ledDept);
  let hi = 0, hout = 0;
  const cells = [];
  for (let m = 1; m <= 12; m++) {
    const ym = curYear() + '-' + pad2(m);
    const rows = list.filter(e => monthKeyOf(e.date) === ym);
    const i = ledSum(rows.filter(e => e.type === 'in')), o = ledSum(rows.filter(e => e.type === 'out'));
    hi += i; hout += o;
    cells.push('<tr data-act="led-month-jump" data-v="' + ym + '" style="cursor:pointer"><td>' + m + '월</td><td class="num">' + (i ? money(i) : '-') + '</td><td class="num">' + (o ? money(o) : '-') + '</td><td class="num">' + ((i || o) ? money(i - o) : '-') + '</td></tr>');
  }
  let h = '<div class="card"><h3>📅 달별 추이 <span class="sp"></span><small>' + esc(ledDeptLabel()) + '</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>달</th><th class="num">수입</th><th class="num">지출</th><th class="num">수지</th></tr></thead><tbody>';
  h += cells.join('');
  h += '</tbody><tfoot><tr><td><b>계</b></td><td class="num"><b>' + money(hi) + '</b></td><td class="num"><b>' + money(hout) + '</b></td><td class="num"><b>' + money(hi - hout) + '</b></td></tr></tfoot></table></div>';
  h += '<p class="hint">달을 누르면 그 달 장부로 이동합니다.</p></div>';
  return h;
}

/* ================= 5. 항목별 조회 (수입 | 지출 2단) ================= */
function ledCategoriesInPeriod(list) {
  const map = new Map();
  list.forEach(e => {
    const cat = ledCatOf(e);
    let g = map.get(cat);
    if (!g) { g = { cat: cat, inc: 0, out: 0, count: 0 }; map.set(cat, g); }
    if (e.type === 'in') g.inc += Number(e.amount) || 0; else g.out += Number(e.amount) || 0;
    g.count++;
  });
  return Array.from(map.values()).sort((a, b) => (b.inc + b.out) - (a.inc + a.out));
}

function ledgerItemBody() {
  const list = ledPeriodEntries();
  const cats = ledCategoriesInPeriod(list);
  let cat = String(V.ledItemCat || '').trim();
  const has = cats.some(c => c.cat === cat);
  if (!has) cat = cats.length ? cats[0].cat : '';   // 2026-11-28: 이 기간에 기록이 없을 때 오류가 나지 않게

  let h = '<div class="card flat" style="padding:12px">' + ledPeriodBar() + ledDeptChips() + '</div>';

  if (!cats.length) {
    h += '<div class="card">' + emptyBox('📄', '이 기간에는 조회할 항목이 없습니다', '장부에 수입·지출을 기록하면 항목별로 모아 볼 수 있습니다') + '</div>';
    return h;
  }

  h += '<div class="card"><div class="field" style="margin:0"><label>조회할 항목</label><select data-sel="led-item-cat">' +
    cats.map(c => '<option value="' + esc(c.cat) + '"' + (c.cat === cat ? ' selected' : '') + '>' + esc(c.cat) + ' · ' + c.count + '건</option>').join('') +
    '</select></div></div>';

  const rows = cat ? list.filter(e => ledCatOf(e) === cat) : [];
  const incT = ledSum(rows.filter(e => e.type === 'in')), outT = ledSum(rows.filter(e => e.type === 'out'));

  h += '<div class="card" style="padding:12px">';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px"><span class="chip coral big">' + esc(cat) + '</span><span class="chip gray big">' + esc(ledPeriodLabel()) + '</span><span class="chip gray big">' + esc(ledDeptLabel()) + '</span><span class="sp"></span><button class="btn sm" data-act="led-item-print">🖨 이 항목 인쇄</button></div>';
  h += '<div class="tbl-wrap">' + itemTableHtml(cat, rows) + '</div>';
  h += '<div class="row" style="margin-top:10px"><span class="muted">수입 ' + money(incT) + '원 · 지출 ' + money(outT) + '원 · 수지 ' + money(incT - outT) + '원</span></div>';
  h += '<p class="hint">표의 <b>항목</b> 칸은 회계 기록의 <b>세부 내역(적요)</b> 입니다. 인쇄하면 1번 양식(수입 | 지출 2단) 그대로 A4에 나옵니다.</p>';
  h += '</div>';

  /* 항목 전체 목록 — 눌러서 바로 고르기 */
  h += '<div class="card"><h3>항목 목록 <span class="sp"></span><small>' + cats.length + '개</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="num">수입</th><th class="num">지출</th><th class="num">건수</th></tr></thead><tbody>' +
    cats.map(c => '<tr data-act="led-item-pick" data-v="' + esc(c.cat) + '" style="cursor:pointer' + (c.cat === cat ? ';background:#fff6f0' : '') + '"><td><b>' + esc(c.cat) + '</b></td><td class="num">' + (c.inc ? money(c.inc) : '-') + '</td><td class="num">' + (c.out ? money(c.out) : '-') + '</td><td class="num">' + c.count + '</td></tr>').join('') +
    '</tbody></table></div></div>';
  return h;
}

/* 1번 사진 양식 — 제목(항목명) + 수입 | 지출 2단, 아래 계 */
function itemTableHtml(cat, rows, opts) {
  opts = opts || {};
  const inc = rows.filter(e => e.type === 'in').slice().sort(ledByDate);
  const out = rows.filter(e => e.type === 'out').slice().sort(ledByDate);
  const n = Math.max(opts.min || 10, inc.length, out.length);
  const incT = ledSum(inc), outT = ledSum(out);
  const nameOf = e => String(e.memo || '').trim() || fmtShort(e.date);
  let h = '<table class="led-form"><colgroup><col style="width:32%"><col style="width:18%"><col style="width:32%"><col style="width:18%"></colgroup><thead>' +
    '<tr><th colspan="4" class="title">' + esc(cat || '항목') + '</th></tr>' +
    '<tr class="grp"><th colspan="2">수입</th><th colspan="2">지출</th></tr>' +
    '<tr class="sub"><th>항목</th><th>금액</th><th>항목</th><th>금액</th></tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    const a = inc[i], b = out[i];
    h += '<tr><td class="it">' + (a ? esc(nameOf(a)) : '') + '</td><td class="num">' + (a ? money(a.amount) : '') + '</td>' +
      '<td class="it">' + (b ? esc(nameOf(b)) : '') + '</td><td class="num">' + (b ? money(b.amount) : '') + '</td></tr>';
  }
  h += '</tbody><tfoot><tr class="total"><td class="ctr">계</td><td class="num">' + money(incT) + '</td><td class="ctr">계</td><td class="num">' + money(outT) + '</td></tr></tfoot></table>';
  return h;
}

/* ================= 6. 연말 결산 · 다음 해 예산 ================= */
/* 연말 보고서는 부서 하나를 골라 작성합니다. 장부의 부서 거르개(V.ledDept)와 따로 둡니다. */
function reportDeptId() {
  if (V.ledYearDept) return V.ledYearDept;
  const d = visibleDepts()[0];
  return d ? d.id : '';
}
function ledYearDeptChips() {
  const depts = visibleDepts();
  const cur = reportDeptId();
  return '<div class="row wrap" style="gap:6px">' + depts.map(d =>
    '<button class="chip big ' + (d.id === cur ? 'coral' : 'gray') + '" data-act="led-year-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') + '</div>';
}
function settlementOf(deptId, y) {
  const list = (S.state.ledger || []).filter(e => e && !e._del && (e.type === 'in' || e.type === 'out') &&
    recYear(e) === Number(y) && (!deptId || e.deptId === deptId));
  const inc = ledGroup(list, 'in'), out = ledGroup(list, 'out');
  return { inc: inc, out: out, incT: ledSum(list.filter(e => e.type === 'in')), outT: ledSum(list.filter(e => e.type === 'out')), count: list.length };
}
function budgetRows(deptId, y) {
  return (S.state.budgets || []).filter(b => b && !b._del && Number(b.year) === Number(y) && String(b.deptId || '') === String(deptId || ''))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}
function budgetReportOf(deptId, y) {
  const rows = budgetRows(deptId, y);
  const inc = rows.filter(b => b.type === 'in').map(b => ({ cat: b.category || '(항목 없음)', amount: Number(b.amount) || 0, id: b.id }));
  const out = rows.filter(b => b.type === 'out').map(b => ({ cat: b.category || '(항목 없음)', amount: Number(b.amount) || 0, id: b.id }));
  return { inc: inc, out: out, incT: inc.reduce((s, x) => s + x.amount, 0), outT: out.reduce((s, x) => s + x.amount, 0) };
}

function ledgerYearBody() {
  const depts = visibleDepts();
  if (!depts.length) return '<div class="card">' + emptyBox('🏫', '볼 수 있는 부서가 없습니다') + '</div>';
  const deptId = reportDeptId();
  const y = curYear(), ny = y + 1;
  const s = settlementOf(deptId, y);
  const b = budgetReportOf(deptId, ny);
  const prev = settlementOf(deptId, y - 1);
  const carry = prev.incT - prev.outT;
  const dept = deptById(deptId) || {};

  let h = '<div class="banner sky">왼쪽 <b>' + y + '년 결산</b>은 회계 장부에서 항목별로 자동 합산됩니다. 오른쪽 <b>' + ny + '년 예산</b>은 아래에서 직접 적으면 시트에 저장되어 다른 기기도 함께 씁니다.</div>';
  h += '<div class="card flat" style="padding:12px">' + ledYearDeptChips() +
    '<p class="hint" style="margin:6px 0 0">부서마다 결산·예산을 따로 작성합니다. 지금은 <b>' + esc((dept.emoji || '') + ' ' + dept.name) + '</b> 기준입니다.</p></div>';

  h += '<div class="card" style="padding:12px">';
  h += '<h3 style="margin-bottom:10px">(1) ' + y + '년 사업결산 및 ' + ny + '년 예산 <span class="sp"></span><button class="btn sm" data-act="led-year-print">🖨 연말 보고서 인쇄</button></h3>';
  h += '<div class="tbl-wrap" id="yrPreview">' + yearReportTableHtml(deptId, y, ny) + '</div>';
  h += '<p class="hint">표가 넓으면 옆으로 넘겨 보세요. 인쇄는 A4 가로로 나옵니다.</p>';
  h += '<p class="hint">결산 수입계 ' + money(s.incT) + '원 · 지출계 ' + money(s.outT) + '원 · 수지 ' + money(s.incT - s.outT) + '원<br>예산 수입계 ' + money(b.incT) + '원 · 지출계 ' + money(b.outT) + '원 · 수지 ' + money(b.incT - b.outT) + '원</p>';
  h += '</div>';

  /* 전년도 이월금 안내 */
  if (prev.count) {
    h += '<div class="banner">' + (y - 1) + '년 잔액은 <b>' + money(carry) + '원</b>입니다. 장부에 <b>전년도이월금</b> 수입으로 기록하면 ' + y + '년 결산에 그대로 반영됩니다.</div>';
  }

  /* 예산 작성 */
  h += '<div class="sect-title">✍️ ' + ny + '년 예산 작성</div>';
  h += '<div class="row wrap" style="gap:6px;margin-bottom:10px">' +
    '<button class="btn sm" data-act="led-bg-add" data-v="in">＋ 수입 항목</button>' +
    '<button class="btn sm" data-act="led-bg-add" data-v="out">＋ 지출 항목</button>' +
    '<button class="btn sm ghost" data-act="led-bg-load">📥 결산 항목 불러오기</button>' +
    '<button class="btn sm ghost" data-act="led-bg-carry">🔄 전년도이월금 자동 계산</button></div>';

  h += '<datalist id="ledCatList">' + LEDGER_CATS_IN.concat(LEDGER_CATS_OUT).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>';
  h += budgetEditorHtml(deptId, ny, 'in');
  h += budgetEditorHtml(deptId, ny, 'out');
  h += '<p class="hint">금액은 숫자만 적어도 됩니다(쉼표는 자동). 다른 기기에서도 같은 예산을 이어서 작성할 수 있습니다.</p>';
  return h;
}

function budgetEditorHtml(deptId, y, type) {
  const rows = budgetRows(deptId, y).filter(b => b.type === type);
  const isIn = type === 'in';
  const total = rows.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  let h = '<div class="card"><h3>' + (isIn ? '＋ 수입 예산' : '－ 지출 예산') + '<span class="sp"></span><small>' + money(total) + '원 · ' + rows.length + '개</small></h3>';
  if (!rows.length) h += '<p class="muted" style="margin:0 0 8px">아직 없습니다. 위의 <b>' + (isIn ? '＋ 수입 항목' : '＋ 지출 항목') + '</b>으로 추가하세요.</p>';
  h += rows.map(b => '<div class="bg-row">' +
    '<input class="bg-cat" data-bg="category" data-id="' + esc(b.id) + '" value="' + esc(b.category || '') + '" placeholder="항목 이름" list="ledCatList" autocapitalize="none">' +
    '<input class="bg-amt" data-bg="amount" data-id="' + esc(b.id) + '" inputmode="numeric" value="' + money(b.amount) + '" placeholder="0">' +
    '<button class="btn sm ghost" data-act="led-bg-del" data-id="' + esc(b.id) + '" title="이 예산 항목 지우기">✕</button></div>').join('');
  h += '</div>';
  return h;
}

/* 2번 사진 양식 — 2026결산 | 2027예산 4단 표 */
function yearReportTableHtml(deptId, y, ny, opts) {
  opts = opts || {};
  const s = settlementOf(deptId, y);
  const b = budgetReportOf(deptId, ny);
  const n = Math.max(opts.min || 14, s.inc.length, s.out.length, b.inc.length, b.out.length);
  const cell = (r) => '<td class="it">' + (r ? esc(r.cat) : '') + '</td><td class="num">' + (r ? money(r.amount) : '') + '</td>';
  let h = '<table class="led-form yr"><colgroup><col style="width:19%"><col style="width:12%"><col style="width:19%"><col style="width:12%"><col style="width:19%"><col style="width:12%"><col style="width:19%"><col style="width:12%"></colgroup><thead>' +
    '<tr class="grp"><th colspan="4">' + y + '결산</th><th colspan="4">' + ny + '예산</th></tr>' +
    '<tr class="sub"><th colspan="2">수입</th><th colspan="2">지출</th><th colspan="2">수입</th><th colspan="2">지출</th></tr>' +
    '<tr><th>항목</th><th>금액</th><th>항목</th><th>금액</th><th>항목</th><th>금액</th><th>항목</th><th>금액</th></tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    h += '<tr>' + cell(s.inc[i]) + cell(s.out[i]) + cell(b.inc[i]) + cell(b.out[i]) + '</tr>';
  }
  h += '</tbody><tfoot><tr class="total"><td class="ctr">계</td><td class="num">' + money(s.incT) + '</td><td class="ctr">계</td><td class="num">' + money(s.outT) + '</td>' +
    '<td class="ctr">계</td><td class="num">' + money(b.incT) + '</td><td class="ctr">계</td><td class="num">' + money(b.outT) + '</td></tr></tfoot></table>';
  return h;
}

/* 예산을 고친 뒤 미리보기 표만 다시 그립니다(입력 중 화면이 튀지 않게) */
function refreshYearPreview() {
  const box = document.getElementById('yrPreview');
  if (!box) return;
  box.innerHTML = yearReportTableHtml(reportDeptId(), curYear(), curYear() + 1);
}

/* ================= 7. 인쇄 ================= */
function printDocCss(landscape) {
  return '@page{size:A4' + (landscape ? ' landscape' : '') + ';margin:11mm 10mm}' +
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#111;margin:0}' +
    'h1{font-size:15pt;text-align:center;margin:0 0 2mm;letter-spacing:-.3px}' +
    'h2{font-size:9.5pt;text-align:center;color:#555;font-weight:600;margin:0 0 4mm}' +
    'table{border-collapse:collapse;width:100%;font-size:9pt;table-layout:fixed}' +
    'th,td{border:1px solid #333;padding:1.6mm 2mm;height:6mm;vertical-align:middle}' +
    'th{background:#f2f2f2;font-weight:700;text-align:center}' +
    'td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}' +
    'td.ctr,th.ctr{text-align:center}' +
    'td.it{font-weight:600;word-break:break-all}' +
    'tr.total td{font-weight:800;background:#fafafa}' +
    'table.led-form tr.grp th{background:#e9e9e9;font-size:9.5pt}' +
    'table.led-form tr.sub th{background:#f5f5f5}' +
    'table.led-form th.title{background:#fff;font-size:11pt;height:8mm}' +
    'p.foot{font-size:7.5pt;color:#999;text-align:center;margin-top:4mm}' +
    'p.hint{font-size:8pt;color:#666;margin:2mm 0 0}';
}
function printDocHtml(title, body, landscape) {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
    printDocCss(landscape) + '</style></head><body>' + body +
    '<p class="foot">' + esc(ledChurch()) + ' 교육부서 · 인쇄 ' + new Date().toLocaleString('ko-KR') + '</p>' +
    '<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script></body></html>';
}
function printLedgerDoc(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('팝업이 차단되었습니다. 브라우저의 팝업 허용을 켜 주세요', 'err'); return null; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return w;
}

/* 통계 인쇄 — 요약만 / 항목별 세부 내역까지 */
function ledgerStatPrintHtml(withDetail) {
  const list = ledPeriodEntries();
  const incT = ledSum(list.filter(e => e.type === 'in')), outT = ledSum(list.filter(e => e.type === 'out'));
  const gi = ledGroup(list, 'in'), go = ledGroup(list, 'out');
  let body = '<h1>' + esc(ledChurch()) + ' 교육부서 회계 통계</h1>';
  body += '<h2>' + esc(ledPeriodLabel()) + ' · ' + esc(ledDeptLabel()) + '</h2>';
  body += '<p class="hint">수입 계 ' + money(incT) + '원 · 지출 계 ' + money(outT) + '원 · 수지 ' + money(incT - outT) + '원 · 거래 ' + list.length + '건</p>';
  body += statPrintTable('수입', gi, incT, withDetail, 'in');
  body += statPrintTable('지출', go, outT, withDetail, 'out');
  return printDocHtml('회계 통계', body, false);
}
function statPrintTable(label, groups, total, withDetail, type) {
  const count = groups.reduce((n, g) => n + g.count, 0);
  let h = '<table style="margin-top:4mm"><thead><tr><th colspan="' + (withDetail ? 6 : 4) + '">' + esc(label) + '</th></tr>' +
    '<tr><th>항목</th><th>건수</th><th>금액</th><th>비중</th>' + (withDetail ? '<th>날짜</th><th>세부 내역</th>' : '') + '</tr></thead><tbody>';
  if (!groups.length) h += '<tr><td colspan="' + (withDetail ? 6 : 4) + '" class="ctr">기록 없음</td></tr>';
  groups.forEach(g => {
    if (withDetail) {
      g.rows.slice().sort(ledByDate).forEach((e, i) => {
        h += '<tr>' + (i === 0 ? '<td rowspan="' + g.rows.length + '" class="it">' + esc(g.cat) + '</td><td rowspan="' + g.rows.length + '" class="ctr">' + g.count + '</td><td rowspan="' + g.rows.length + '" class="num">' + money(g.amount) + '</td><td rowspan="' + g.rows.length + '" class="num">' + ledPct(g.amount, total) + '%</td>' : '') +
          '<td class="ctr">' + esc(fmtShort(e.date)) + '</td><td>' + esc(String(e.memo || '').trim() || '—') + '</td></tr>';
      });
    } else {
      h += '<tr><td class="it">' + esc(g.cat) + '</td><td class="ctr">' + g.count + '</td><td class="num">' + money(g.amount) + '</td><td class="num">' + ledPct(g.amount, total) + '%</td></tr>';
    }
  });
  h += '</tbody><tfoot><tr class="total"><td>계</td><td class="ctr">' + count + '</td><td class="num">' + money(total) + '</td><td class="num">100%</td>' + (withDetail ? '<td colspan="2"></td>' : '') + '</tr></tfoot></table>';
  return h;
}

function statPrintModal() {
  let h = '<div class="banner sky">' + esc(ledPeriodLabel()) + ' · ' + esc(ledDeptLabel()) + '</div>';
  h += '<div class="row" style="gap:8px;margin:6px 0 14px"><input type="checkbox" id="sprDetail" style="width:18px;height:18px"><span>항목별 <b>세부 거래 내역</b>까지 함께 인쇄</span></div>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="led-stat-print-go">🖨 인쇄</button></div>';
  openModal('통계 인쇄', h);
}

/* 항목별 조회 인쇄 — 1번 양식 */
function ledgerItemPrintHtml(cat) {
  const list = ledPeriodEntries().filter(e => ledCatOf(e) === cat);
  let body = '<h1 style="margin-bottom:3mm">' + esc(cat) + '</h1>';
  body += '<h2>' + esc(ledPeriodLabel()) + ' · ' + esc(ledDeptLabel()) + '</h2>';
  body += itemTableHtml(cat, list, { min: 12 });
  return printDocHtml(cat, body, false);
}

/* 연말 보고서 인쇄 — 2번 양식 (A4 가로) */
function ledgerYearPrintHtml() {
  const deptId = reportDeptId();
  const y = curYear(), ny = y + 1;
  const dept = deptById(deptId) || {};
  let body = '<h1>(1) ' + y + '년 사업결산 및 ' + ny + '년 예산</h1>';
  body += '<h2>' + esc(ledChurch()) + ' · ' + esc((dept.emoji || '') + ' ' + dept.name) + '</h2>';
  body += yearReportTableHtml(deptId, y, ny, { min: 16 });
  const s = settlementOf(deptId, y), b = budgetReportOf(deptId, ny);
  body += '<p class="hint">' + y + '년 결산 수지 ' + money(s.incT - s.outT) + '원 · ' + ny + '년 예산 수지 ' + money(b.incT - b.outT) + '원</p>';
  return printDocHtml('연말 결산·예산', body, true);
}

/* ================= 8. 예산 저장 ================= */
function budgetSave() {
  return Sync.save();
}
async function budgetAdd(type) {
  const deptId = reportDeptId();
  if (!deptId) return toast('부서를 먼저 골라 주세요', 'err');
  S.state.budgets = S.state.budgets || [];
  const row = {
    id: 'bg-' + Crypto.uid(), year: curYear() + 1, deptId: deptId, type: type === 'out' ? 'out' : 'in',
    category: '', amount: 0, order: Date.now(), by: S.me.uid, u: Date.now()
  };
  S.state.budgets.push(row);
  await budgetSave();
  renderApp();
  const inp = document.querySelector('[data-bg="category"][data-id="' + row.id + '"]');
  if (inp) { try { inp.focus(); } catch (e) { } }
  toast('예산 항목을 추가했습니다. 항목 이름과 금액을 적어 주세요', 'ok');
}
async function budgetDelete(id) {
  const row = (S.state.budgets || []).find(b => b.id === id);
  if (!row) return;
  row._del = true; touch(row);
  await budgetSave();
  renderApp();
  toast('예산 항목을 지웠습니다', 'ok');
}
function budgetLoadSettlement() {
  const deptId = reportDeptId();
  const y = curYear(), ny = y + 1;
  const s = settlementOf(deptId, y);
  const rows = budgetRows(deptId, ny);
  const have = rows.map(b => b.type + '|' + String(b.category || '').trim());
  let add = 0;
  [['in', s.inc], ['out', s.out]].forEach(pair => {
    pair[1].forEach(g => {
      if (have.indexOf(pair[0] + '|' + g.cat) >= 0) return;
      S.state.budgets = S.state.budgets || [];
      S.state.budgets.push({
        id: 'bg-' + Crypto.uid(), year: ny, deptId: deptId, type: pair[0],
        category: g.cat, amount: g.amount, order: Date.now() + add, by: S.me.uid, u: Date.now()
      });
      add++;
    });
  });
  if (!add) { toast('이미 결산 항목이 모두 들어 있습니다', 'ok'); return; }
  Sync.save().then(() => { renderApp(); toast('결산 항목 ' + add + '개를 예산에 불러왔습니다. 금액을 고쳐 주세요', 'ok'); });
}
function budgetCarryOver() {
  const deptId = reportDeptId();
  const y = curYear(), ny = y + 1;
  const s = settlementOf(deptId, y);
  const carry = s.incT - s.outT;
  S.state.budgets = S.state.budgets || [];
  let row = (S.state.budgets || []).find(b => b && !b._del && b.type === 'in' && String(b.category || '').trim() === '전년도이월금' && Number(b.year) === ny && String(b.deptId || '') === String(deptId));
  if (!row) {
    row = { id: 'bg-' + Crypto.uid(), year: ny, deptId: deptId, type: 'in', category: '전년도이월금', amount: carry, order: Date.now(), by: S.me.uid, u: Date.now() };
    S.state.budgets.push(row);
  } else {
    row.amount = carry; touch(row);
  }
  Sync.save().then(() => { renderApp(); toast('전년도이월금 ' + money(carry) + '원을 예산 수입에 넣었습니다', 'ok'); });
}

/* ================= 9. 동작 ================= */
document.addEventListener('click', async function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case 'led-mode': {
        V.ledMode = t.dataset.v;
        if (V.ledMode === 'year' && !V.ledYearDept) {
          const d = (V.ledDept ? deptById(V.ledDept) : null) || visibleDepts()[0];
          if (d) V.ledYearDept = d.id;
        }
        renderApp(); return;
      }
      case 'led-period': V.ledPeriod = t.dataset.v; renderApp(); return;
      case 'led-year-dept': V.ledYearDept = t.dataset.id; renderApp(); return;
      case 'led-cat-open': {
        V.ledOpen = V.ledOpen || {};
        const k = t.dataset.v;
        if (V.ledOpen[k]) delete V.ledOpen[k]; else V.ledOpen[k] = true;
        renderApp(); return;
      }
      case 'led-month-jump': {
        V.ledMonth = t.dataset.v;
        V.ledMode = 'book';
        renderApp(); return;
      }
      case 'led-item-pick': V.ledItemCat = t.dataset.v; renderApp(); return;

      /* 인쇄 */
      case 'led-print-book': printLedger(); return;
      case 'led-print-stat': statPrintModal(); return;
      case 'led-stat-print-go': {
        const cb = document.getElementById('sprDetail');
        const detail = !cb || cb.checked;
        closeModal();
        printLedgerDoc(ledgerStatPrintHtml(detail));
        return;
      }
      case 'led-print-item':
      case 'led-item-print': {
        const list = ledPeriodEntries();
        const cats = ledCategoriesInPeriod(list);
        let cat = String(V.ledItemCat || '').trim() || (cats[0] && cats[0].cat) || '';
        if (!cat) return toast('인쇄할 항목이 없습니다', 'err');
        printLedgerDoc(ledgerItemPrintHtml(cat));
        return;
      }
      case 'led-print-year':
      case 'led-year-print': printLedgerDoc(ledgerYearPrintHtml()); return;

      /* 예산 */
      case 'led-bg-add': budgetAdd(t.dataset.v); return;
      case 'led-bg-del': {
        const id = t.dataset.id;
        confirmBox('예산 항목 삭제', '이 예산 항목을 지울까요?', '삭제', () => budgetDelete(id));
        return;
      }
      case 'led-bg-load':
        confirmBox('결산 항목 불러오기', curYear() + '년 결산 항목과 금액을 ' + (curYear() + 1) + '년 예산에 그대로 넣을까요? (이미 있는 항목은 건너뜁니다)', '불러오기', budgetLoadSettlement);
        return;
      case 'led-bg-carry': {
        const s = settlementOf(reportDeptId(), curYear());
        confirmBox('전년도이월금 자동 계산', curYear() + '년 수입계 − 지출계 = ' + money(s.incT - s.outT) + '원을 ' + (curYear() + 1) + '년 예산의 수입 `전년도이월금`으로 넣을까요?', '넣기', budgetCarryOver);
        return;
      }
      default: return;
    }
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '처리하지 못했습니다', 'err');
  }
});

/* 항목 선택 · 예산 입력 */
document.addEventListener('change', async function (ev) {
  const t = ev.target;
  if (!t || !t.dataset) return;
  try {
    if (t.dataset.sel === 'led-item-cat') {
      V.ledItemCat = t.value;
      renderApp();
      return;
    }
    if (!t.dataset.bg) return;
    const row = (S.state.budgets || []).find(b => b.id === t.dataset.id);
    if (!row) return;
    if (t.dataset.bg === 'category') {
      row.category = String(t.value || '').trim();
    } else {
      row.amount = Number(String(t.value || '').replace(/[^0-9]/g, '')) || 0;
      t.value = money(row.amount);
    }
    touch(row);
    refreshYearPreview();
    await Sync.save();
  } catch (e) {
    console.error(e);
    toast((e && e.message) || '저장하지 못했습니다', 'err');
  }
});

/* ---------------------------- 끝 ---------------------------- */
