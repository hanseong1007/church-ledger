/* 덕신교회 부서업무 — 회계 장부 엑셀 올리기 (2026-11-28)
 * 유치부·초등부·청소년부 회계자료(.xlsx / .csv)를 장부에 그대로 넣습니다.
 * · SheetImport(sheet-import.js)가 표를 읽고, JSZip(jzip.min.js)이 엑셀 압축을 풉니다.
 * · 기존 기록을 지우고 넣을 때는 지울 기록을 먼저 백업 파일(JSON)로 내려받습니다.
 */
'use strict';

function lgimpPick() {
  fileInput('.xlsx,.csv', lgimpRead);
}

function lgimpOpen() {
  if (typeof can === 'function' && !can('ledger.manage')) return toast('회계를 고칠 권한이 없습니다', 'err');
  let h = '<p class="pre" style="margin:0 0 10px">엑셀 파일의 <b>Sheet1</b>을 읽어 회계 장부에 넣습니다.<br>머리글에 <b>날짜 · 항목 · 내용 · 수입 · 지출</b> 칸이 있으면 됩니다(누계가 있어도 됩니다).</p>';
  h += '<p class="muted" style="margin:0 0 14px">기존 기록을 지우고 넣는 경우에는, 지울 기록을 먼저 백업 파일로 내려받습니다.</p>';
  h += '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="lgimp-pick">📥 파일 고르기</button></div>';
  openModal('엑셀 회계자료 올리기', h);
}

function lgimpRead(file) {
  if (!window.SheetImport) return toast('엑셀 읽기 기능을 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요', 'err');
  const depts = visibleDepts();
  const def = V.ledDept || (depts[0] || {}).id || '';
  openModal('엑셀 회계자료 올리기', '<p class="muted">' + esc(file.name) + ' 를 읽고 있습니다…</p>');
  window.SheetImport.parseFile(file, window.JSZip).then(res => {
    const first = String(res.from).slice(0, 4), last = String(res.to).slice(0, 4);
    let deptId = def;
    if (depts.some(d => d.id === 'dept-kids')) {
      const names = { 'dept-kids': '유치부', 'dept-elem': '초등부', 'dept-teen': '청소년부' };
      /* 파일 이름에 부서 이름이 있으면 그 부서로 미리 골라 둡니다 */
      const hit = depts.find(d => String(file.name).indexOf(d.name) >= 0);
      if (hit) deptId = hit.id;
    }
    V.lgImport = { res: res, fileName: file.name, deptId: deptId, mode: 'replace' };
    lgimpPreview();
  }).catch(err => {
    V.lgImport = null;
    openModal('엑셀 회계자료 올리기', '<p class="pre" style="margin:0 0 14px">' + esc((err && err.message) || '파일을 읽지 못했습니다') + '</p>' +
      '<div class="row"><span class="sp"></span><button class="btn" data-act="modal-close">닫기</button><button class="btn primary" data-act="lgimp-pick">다른 파일 고르기</button></div>');
  });
}

function lgimpYears(res) {
  const set = {};
  res.rows.forEach(r => { const y = Number(String(r.date).slice(0, 4)); if (y) set[y] = 1; });
  return Object.keys(set).map(Number).sort();
}

function lgimpPreview(msg) {
  const st = V.lgImport;
  if (!st) return;
  const res = st.res;
  const depts = visibleDepts();
  const dept = deptById(st.deptId) || {};
  const years = lgimpYears(res);
  const sameDept = (S.state.ledger || []).filter(e => e && !e._del && String(e.deptId || '') === String(st.deptId || '') && years.indexOf(recYear(e)) >= 0);
  const runBal = res.balance;

  let h = '';
  if (msg) h += '<div class="banner mint">' + esc(msg) + '</div>';
  h += '<div class="banner sky">' + esc(st.fileName) + ' · ' + esc(res.sheetName) + ' 시트 · 머리글 ' + res.headerRow + '행</div>';
  h += '<div class="card flat" style="padding:12px">';
  h += '<div class="kv"><span>기간</span><b>' + esc(res.from) + ' ~ ' + esc(res.to) + '</b></div>';
  h += '<div class="kv"><span>줄 수</span><b>' + res.rows.length + '줄</b></div>';
  h += '<div class="kv"><span>수입 합계</span><b>' + money(res.income) + '원</b></div>';
  h += '<div class="kv"><span>지출 합계</span><b>' + money(res.expense) + '원</b></div>';
  h += '<div class="kv"><span>최종 잔액</span><b>' + money(runBal) + '원</b></div>';
  if (res.hasCum) h += '<div class="kv"><span>누계 검사</span><b>' + (res.cumMismatch ? res.cumMismatch + '줄이 엑셀 누계와 다름' : '엑셀 누계와 모두 일치') + '</b></div>';
  if (res.skipped) h += '<div class="kv"><span>건너뛴 줄</span><b>' + res.skipped + '줄 (날짜 없음)</b></div>';
  h += '</div>';

  h += '<div class="field"><label>넣을 부서</label><div class="row wrap" style="gap:6px">' +
    depts.map(d => '<button class="chip big ' + (d.id === st.deptId ? 'coral' : 'gray') + '" data-act="lgimp-dept" data-id="' + esc(d.id) + '">' + esc((d.emoji || '') + ' ' + d.name) + '</button>').join('') +
    '</div><div class="hint">고른 부서의 장부에 들어갑니다. <b>유치부 회계자료는 꼭 유치부</b>를 골라 주세요.</div></div>';

  h += '<div class="field"><label>넣는 방법</label><div class="row wrap" style="gap:6px">' +
    '<button class="chip big ' + (st.mode === 'replace' ? 'coral' : 'gray') + '" data-act="lgimp-mode" data-v="replace">기존 기록 지우고 넣기</button>' +
    '<button class="chip big ' + (st.mode === 'append' ? 'coral' : 'gray') + '" data-act="lgimp-mode" data-v="append">기존 기록에 더하기</button></div>' +
    '<div class="hint">' + (dept.name ? esc(dept.name) : '고른 부서') + ' · ' + years.join('·') + '년 기록 가운데 <b>' + sameDept.length + '건</b>이 지워집니다(백업 파일 자동 저장).</div></div>';

  h += '<div class="row" style="margin-top:12px"><span class="muted" style="font-size:11.5px">' + (dept.emoji || '') + ' ' + esc(dept.name || '부서') + ' · ' + res.rows.length + '줄</span><span class="sp"></span>' +
    '<button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="lgimp-apply">이대로 넣기</button></div>';
  openModal('엑셀 회계자료 올리기', h);
}

function lgimpBackup(rows, deptName) {
  try {
    const payload = { app: 'deoksin-edu-ledger', exportedAt: new Date().toISOString(), dept: deptName, entries: rows };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '회계백업_' + (deptName || '부서') + '_' + ymd() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  } catch (e) { console.warn('백업 파일을 만들지 못했습니다', e); }
}

async function lgimpApply() {
  const st = V.lgImport;
  if (!st) return;
  const res = st.res, deptId = st.deptId, mode = st.mode;
  const dept = deptById(deptId) || {};
  const years = lgimpYears(res);
  const all = S.state.ledger || [];
  const removed = mode === 'replace'
    ? all.filter(e => e && !e._del && String(e.deptId || '') === String(deptId || '') && years.indexOf(recYear(e)) >= 0)
    : [];

  if (mode === 'replace' && removed.length) {
    lgimpBackup(removed, dept.name || '부서');
  }

  const now = Date.now();
  const made = [];
  res.rows.forEach((r, i) => {
    const year = Number(String(r.date).slice(0, 4)) || curYear();
    if (r.income) made.push({
      id: 'lg-' + Crypto.uid() + 'i' + i, year: year, by: S.me.uid, u: now + i * 2 + 1,
      date: r.date, type: 'in', category: r.item || '수입', memo: r.memo || '', amount: r.income, deptId: deptId, receipt: null
    });
    if (r.expense) made.push({
      id: 'lg-' + Crypto.uid() + 'o' + i, year: year, by: S.me.uid, u: now + i * 2 + 2,
      date: r.date, type: 'out', category: r.item || '지출', memo: r.memo || '', amount: r.expense, deptId: deptId, receipt: null
    });
  });

  if (mode === 'replace') {
    const drop = {};
    removed.forEach(e => { drop[e.id] = 1; });
    S.state.ledger = all.filter(e => !drop[e.id]).concat(made);
  } else {
    S.state.ledger = all.concat(made);
  }

  V.lgImport = null;
  V.ledMonth = String(res.to).slice(0, 7);
  V.ledDept = deptId;
  V.ledMode = 'book';
  V.ledPeriod = 'month';
  closeModal();
  renderApp();
  toast(made.length + '건을 ' + (dept.name || '부서') + ' 회계 장부에 넣었습니다 · ' + money(res.balance) + '원', 'ok');
  try { await Sync.save(); renderApp(); } catch (e) { toast('저장하지 못했습니다. 인터넷 연결을 확인해 주세요', 'err'); }
}

document.addEventListener('click', function (ev) {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'lgimp-open') { ev.preventDefault(); lgimpOpen(); return; }
  if (act === 'lgimp-pick') { ev.preventDefault(); lgimpPick(); return; }
  if (act === 'lgimp-dept') { if (V.lgImport) { V.lgImport.deptId = t.dataset.id; lgimpPreview(); } return; }
  if (act === 'lgimp-mode') { if (V.lgImport) { V.lgImport.mode = t.dataset.v === 'append' ? 'append' : 'replace'; lgimpPreview(); } return; }
  if (act === 'lgimp-apply') { ev.preventDefault(); lgimpApply(); return; }
});
