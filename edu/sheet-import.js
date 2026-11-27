/* 금전출납부 · 부서업무 회계 — 엑셀(.xlsx)·CSV 장부 읽기 (2026-11-28)
 *
 *  쓰는 곳: /church-ledger/index.html (금전출납부), /church-ledger/edu/ (교육부서 회계)
 *  하는 일: 파일에서 표를 읽어 [{date, item, memo, income, expense, cum}] 로 돌려줍니다.
 *           · 엑셀은 시트 이름이 'Sheet1' 인 시트를 먼저 찾고, 없으면 첫 시트를 읽습니다.
 *           · 머리글(날짜·항목·내용·수입·지출·누계)은 이름을 보고 스스로 찾습니다.
 *           · 엑셀 날짜(45658 같은 일련번호)는 날짜로 바꿉니다.
 *  엑셀(.xlsx)은 압축파일이라 JSZip 이 필요합니다 — 부르는 쪽에서 넘겨 주세요.
 */
(function (global) {
  'use strict';

  /* ---------------- 작은 도구들 ---------------- */
  function decodeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
      .replace(/&amp;/g, '&');
  }
  function text(v) {
    if (v == null) return '';
    return String(v).replace(/\u00a0/g, ' ').trim();
  }
  function colIndex(ref) {
    var m = /^([A-Z]+)/i.exec(String(ref || ''));
    if (!m) return -1;
    var s = m[1].toUpperCase(), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, m, d) {
    if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* 엑셀 일련번호 → 날짜 (1900 체계, 엑셀의 1900년 윤년 오류 보정 포함) */
  function excelSerialToISO(n) {
    if (!(n > 20000 && n < 80000)) return '';
    var ms = Math.round((n - 25569) * 86400000);      // 25569 = 1970-01-01의 엑셀 일련번호
    var d = new Date(ms);
    return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /* 금액 칸 → 숫자 (쉼표·원·공백, 괄호/△ 음수 표기 처리) */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || /^[△▲\-−]/.test(s);
    s = s.replace(/[^0-9.]/g, '');
    if (!s) return 0;
    var n = Math.round(Number(s) || 0);
    return neg ? -n : n;
  }

  /* 날짜 칸 → 'YYYY-MM-DD' (엑셀 일련번호·날짜형식 문자열 모두) */
  function dateOf(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      var isoN = excelSerialToISO(v);
      if (isoN) return isoN;
      var s8 = String(Math.round(v));
      if (/^\d{8}$/.test(s8)) return isoOf(Number(s8.slice(0, 4)), Number(s8.slice(4, 6)), Number(s8.slice(6, 8)));
      return '';
    }
    var s = String(v).trim();
    if (!s) return '';
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
    var m = /^(\d{4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/.exec(s);
    if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/.exec(s);
    if (m) return isoOf(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{8})$/.exec(s);
    if (m) return isoOf(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    return '';
  }

  /* ---------------- CSV ---------------- */
  function parseCsvText(txt) {
    txt = String(txt || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var c = txt[i];
      if (q) {
        if (c === '"') {
          if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ---------------- XLSX ---------------- */
  function gridFromSheetXml(xml, shared) {
    var grid = [];
    var rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g, r;
    while ((r = rowRe.exec(xml))) {
      var rn = /r="(\d+)"/.exec(r[1]);
      var idx = rn ? Number(rn[1]) - 1 : grid.length;
      var cells = [];
      var cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c;
      while ((c = cRe.exec(r[2]))) {
        var attrs = c[1] || '', body = c[2] || '';
        var ref = /r="([A-Za-z]+\d+)"/.exec(attrs);
        var ci = ref ? colIndex(ref[1]) : cells.length;
        if (ci < 0) continue;
        var t = /t="([^"]+)"/.exec(attrs);
        var type = t ? t[1] : '';
        var vNode = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        var vRaw = vNode ? vNode[1] : '';
        var val;
        if (type === 's') val = shared[Number(vRaw)] != null ? shared[Number(vRaw)] : '';
        else if (type === 'inlineStr') {
          var its = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
          val = its ? decodeXml(its[1]) : '';
        } else if (type === 'str') val = decodeXml(vRaw);
        else if (type === 'b') val = vRaw === '1';
        else if (type === 'e') val = '';
        else {
          val = vRaw === '' ? '' : (isFinite(Number(vRaw)) ? Number(vRaw) : decodeXml(vRaw));
        }
        cells[ci] = val;
      }
      grid[idx] = cells;
    }
    /* 빈 줄은 빼고 앞에서부터 채웁니다 */
    var out = [];
    for (var i = 0; i < grid.length; i++) if (grid[i]) out.push(grid[i]);
    return out;
  }

  function readXlsx(buf, JSZip) {
    return JSZip.loadAsync(buf).then(function (zip) {
      var sharedFile = zip.file('xl/sharedStrings.xml');
      var sharedP = sharedFile ? sharedFile.async('string') : Promise.resolve('');
      var wbFile = zip.file('xl/workbook.xml');
      var relFile = zip.file('xl/_rels/workbook.xml.rels');
      return Promise.all([
        sharedP,
        wbFile ? wbFile.async('string') : Promise.resolve(''),
        relFile ? relFile.async('string') : Promise.resolve('')
      ]).then(function (arr) {
        var sharedXml = arr[0], wbXml = arr[1], relXml = arr[2];
        var shared = [];
        var siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
        while ((m = siRe.exec(sharedXml))) {
          var inner = m[1], txt = '', tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g, t;
          while ((t = tRe.exec(inner))) txt += t[1];
          shared.push(decodeXml(txt));
        }
        /* 시트 파일 고르기 (workbook.xml 문자열은 위에서 읽은 것을 재사용) */
        var relMap = {};
        var rRe = /<Relationship\b[^>]*>/g, rm;
        while ((rm = rRe.exec(relXml))) {
          var id = /Id="([^"]+)"/.exec(rm[0]);
          var tg = /Target="([^"]+)"/.exec(rm[0]);
          if (id && tg) relMap[id[1]] = tg[1].replace(/^\.?\//, '').replace(/^xl\//, '');
        }
        var sheets = [], sRe = /<sheet\b[^>]*>/g, sm;
        while ((sm = sRe.exec(wbXml))) {
          var nm = /name="([^"]*)"/.exec(sm[0]);
          var rid = /r:id="([^"]+)"/.exec(sm[0]);
          sheets.push({
            name: decodeXml(nm ? nm[1] : ''),
            file: rid && relMap[rid[1]] ? ('xl/' + relMap[rid[1]]) : ''
          });
        }
        var pick = null, i;
        for (i = 0; i < sheets.length; i++) if (/^sheet1$/i.test(sheets[i].name) && sheets[i].file) { pick = sheets[i]; break; }
        if (!pick) for (i = 0; i < sheets.length; i++) if (sheets[i].file) { pick = sheets[i]; break; }
        if (!pick) pick = { name: '', file: 'xl/worksheets/sheet1.xml' };
        var f = zip.file(pick.file);
        if (!f) {
          var cands = ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'];
          for (i = 0; i < cands.length; i++) { if (zip.file(cands[i])) { f = zip.file(cands[i]); pick = { name: '', file: cands[i] }; break; } }
        }
        if (!f) throw new Error('엑셀 안에서 표를 찾지 못했습니다.');
        return f.async('string').then(function (sheetXml) {
          return { sheetName: pick.name || 'Sheet1', grid: gridFromSheetXml(sheetXml, shared) };
        });
      });
    });
  }

  /* ---------------- 머리글 찾기 · 줄 읽기 ---------------- */
  var HEAD = {
    date: /^(날짜|일자|거래일|거래일자|일시|date)$/i,
    item: /^(항목|과목|분류|계정|구분|item)$/i,
    memo: /^(내용|적요|세부내용|세부내역|세부|내역|비고|memo)$/i,
    income: /^(수입|수입액|수입금액|입금|income|in)$/i,
    expense: /^(지출|지출액|지출금액|출금|expense|out)$/i,
    cum: /^(누계|잔액|누적|balance)$/i
  };
  function matchHead(cell) {
    var t = text(cell).replace(/\s+/g, '');
    if (!t) return '';
    for (var k in HEAD) if (HEAD[k].test(t)) return k;
    return '';
  }
  function parseGrid(grid) {
    var headerIdx = -1, map = {};
    for (var i = 0; i < Math.min(grid.length, 15); i++) {
      var cells = grid[i] || [], found = {}, hasDate = false, hasMoney = false;
      for (var c = 0; c < cells.length; c++) {
        var key = matchHead(cells[c]);
        if (!key) continue;
        if (found[key] === undefined) found[key] = c;
        if (key === 'date') hasDate = true;
        if (key === 'income' || key === 'expense') hasMoney = true;
      }
      if (hasDate && hasMoney) { headerIdx = i; map = found; break; }
    }
    if (headerIdx < 0) throw new Error('머리글(날짜·수입·지출)을 찾지 못했습니다. 첫 줄에 날짜·항목·수입·지출 칸이 있어야 합니다.');

    /* '내용'과 '적요'가 둘 다 있으면 '내용'을 씁니다 */
    var memoSrc = map.memo;
    var headerCells = grid[headerIdx] || [];
    for (var h = 0; h < headerCells.length; h++) {
      if (/^내용$/.test(text(headerCells[h]).replace(/\s+/g, ''))) { memoSrc = h; break; }
    }

    var rows = [], skipped = 0, cumMismatch = 0, running = 0, hasCum = false;
    for (var r = headerIdx + 1; r < grid.length; r++) {
      var cells2 = grid[r] || [];
      var date = dateOf(map.date !== undefined ? cells2[map.date] : '');
      var inc = map.income !== undefined ? num(cells2[map.income]) : 0;
      var exp = map.expense !== undefined ? num(cells2[map.expense]) : 0;
      if (!date || (!inc && !exp)) { if (!date && (inc || exp)) skipped++; continue; }
      var cum = map.cum !== undefined && cells2[map.cum] !== '' && cells2[map.cum] != null ? num(cells2[map.cum]) : null;
      var row = {
        date: date,
        item: text(map.item !== undefined ? cells2[map.item] : ''),
        memo: text(memoSrc !== undefined ? cells2[memoSrc] : ''),
        income: inc, expense: exp, cum: cum
      };
      running += inc - exp;
      if (cum !== null) { hasCum = true; if (cum !== running) cumMismatch++; }
      rows.push(row);
    }
    if (!rows.length) throw new Error('표에서 넣을 기록을 찾지 못했습니다. 날짜와 수입·지출이 적힌 줄이 있는지 확인해 주세요.');
    rows.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var incT = rows.reduce(function (s, x) { return s + x.income; }, 0);
    var expT = rows.reduce(function (s, x) { return s + x.expense; }, 0);
    return {
      rows: rows, skipped: skipped, hasCum: hasCum, cumMismatch: cumMismatch,
      income: incT, expense: expT, balance: incT - expT,
      from: rows[0].date, to: rows[rows.length - 1].date,
      headerRow: headerIdx + 1
    };
  }

  function readFile(file, as) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = function () { rej(new Error('파일을 읽지 못했습니다.')); };
      r.onload = function () { res(r.result); };
      if (as === 'text') r.readAsText(file);
      else r.readAsArrayBuffer(file);
    });
  }

  function parseFile(file, JSZip) {
    var name = String((file && file.name) || '');
    if (/\.csv$/i.test(name)) {
      return readFile(file, 'text').then(function (txt) {
        var out = parseGrid(parseCsvText(txt));
        out.sheetName = 'CSV';
        out.fileName = name;
        return out;
      });
    }
    if (/\.xls$/i.test(name)) return Promise.reject(new Error('예전 엑셀(.xls)은 읽을 수 없습니다. 엑셀에서 "다른 이름으로 저장 → .xlsx" 로 저장한 뒤 올려 주세요.'));
    if (!JSZip) return Promise.reject(new Error('엑셀을 읽는 준비가 끝나지 않았습니다. 잠시 뒤 다시 시도해 주세요.'));
    return readFile(file, 'arraybuffer').then(function (buf) {
      return readXlsx(buf, JSZip);
    }).then(function (out) {
      var res = parseGrid(out.grid);
      res.sheetName = out.sheetName;
      res.fileName = name;
      return res;
    });
  }

  global.SheetImport = {
    parseFile: parseFile,
    parseGrid: parseGrid,
    parseCsvText: parseCsvText,
    readXlsx: readXlsx,
    dateOf: dateOf,
    num: num
  };
})(typeof window !== 'undefined' ? window : this);
