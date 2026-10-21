'use strict';

/* ===================== Просмотр таблиц как в Excel ===================== */

/* Тема Office по умолчанию: lt1, dk1, lt2, dk2, accent1…6, hlink, folHlink (в таком порядке их индексирует Excel) */
const XL_THEME_DEFAULT = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
const XL_INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
const XL_BORDER = { thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed', medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed', thick: '3px solid', double: '3px double' };
const XL_HEAD_W = 46, XL_HEAD_H = 22;

function xlTheme(wb) {
  const xml = wb._themes && Object.values(wb._themes)[0];
  if (!xml) return XL_THEME_DEFAULT;
  try {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    const scheme = d.getElementsByTagName('a:clrScheme')[0];
    const pick = n => { const e = scheme.getElementsByTagName('a:' + n)[0]; const c = e && (e.getElementsByTagName('a:srgbClr')[0] || e.getElementsByTagName('a:sysClr')[0]); return c ? (c.getAttribute('val') === 'windowText' ? '000000' : c.getAttribute('val') === 'window' ? 'FFFFFF' : c.getAttribute('lastClr') || c.getAttribute('val')) : null; };
    const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
    return order.map((n, i) => pick(n) || XL_THEME_DEFAULT[i]);
  } catch { return XL_THEME_DEFAULT; }
}

function xlColor(c, theme) {
  if (!c) return null;
  let hex = null;
  if (c.argb) hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
  else if (c.theme != null) hex = theme[c.theme] || null;
  else if (c.indexed != null) hex = c.indexed === 64 ? null : XL_INDEXED[c.indexed] || null;
  if (!hex) return null;
  if (c.tint) {
    const t = c.tint;
    hex = [0, 2, 4].map(i => {
      const v = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t).toString(16).padStart(2, '0');
    }).join('');
  }
  return '#' + hex;
}

const XL_EPOCH = Date.UTC(1899, 11, 30);
const xlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const XL_MONTHS = { January: 'января', February: 'февраля', March: 'марта', April: 'апреля', May: 'мая', June: 'июня', July: 'июля', August: 'августа', September: 'сентября', October: 'октября', November: 'ноября', December: 'декабря' };
const XL_MON = { Jan: 'янв', Feb: 'фев', Mar: 'мар', Apr: 'апр', Jun: 'июн', Jul: 'июл', Aug: 'авг', Sep: 'сен', Oct: 'окт', Nov: 'ноя', Dec: 'дек' };
const XL_DAYS = { Monday: 'понедельник', Tuesday: 'вторник', Wednesday: 'среда', Thursday: 'четверг', Friday: 'пятница', Saturday: 'суббота', Sunday: 'воскресенье' };

/** Готовит формат Excel для SSF: символы вроде ₽ — в кавычки, точки в датах — тоже (иначе SSF принимает их за доли секунды). */
function xlFmt(fmt) {
  let f = fmt.split(/("[^"]*"|\\.|\[[^\]]*\])/).map((part, i) => i % 2 ? part : part.replace(/[^\x00-\x7F]/g, c => `"${c}"`)).join('');
  if (/[dymh]/i.test(f.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) f = f.replace(/(?<!s)\.(?!0)/g, '"."');
  return f;
}

/** Значение ячейки так, как его показывает Excel с русскими настройками: 59 990,50 ₽, 01.10.2026. */
function xlFormat(v, fmt) {
  const ru = document.documentElement.lang !== 'en';
  try {
    if (v instanceof Date) v = (v.getTime() - XL_EPOCH) / 86400000, fmt = fmt && fmt !== 'General' ? fmt : 'dd.mm.yyyy';
    if (typeof v !== 'number') return String(v);
    if (!fmt || fmt === 'General') { const s = String(Math.round(v * 1e10) / 1e10); return ru ? s.replace('.', ',') : s; }
    const f = xlFmt(fmt);
    let out = XLSX.SSF.format(f, v, {});
    if (!ru) return out;
    if (XLSX.SSF.is_date(f)) return out.replace(/\b[A-Z][a-z]+\b/g, w => XL_MONTHS[w] || XL_DAYS[w] || XL_MON[w] || w);
    return out.replace(/(\d),(?=\d{3})/g, '$1 ').replace(/(\d)\.(\d)/g, '$1,$2');
  } catch { return String(v); }
}

function fontCss(f, theme) {
  if (!f) return '';
  let s = '';
  if (f.name) s += `font-family:'${f.name.replace(/['"<>]/g, '')}',Calibri,Arial,sans-serif;`;
  if (f.size) s += `font-size:${f.size}pt;`;
  if (f.bold) s += 'font-weight:700;';
  if (f.italic) s += 'font-style:italic;';
  const deco = [f.underline && 'underline', f.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) s += `text-decoration:${deco};`;
  const col = xlColor(f.color, theme);
  if (col) s += `color:${col};`;
  if (f.vertAlign === 'superscript') s += 'vertical-align:super;'; else if (f.vertAlign === 'subscript') s += 'vertical-align:sub;';
  return s;
}

/* ---------- Модель листа: из ExcelJS (XLSX со стилями) или SheetJS (XLS, ODS, CSV) ---------- */

/**
 * Картинки листов читаем сами: ExcelJS падает на части файлов с рисунками.
 * Возвращает файл без рисунков (для ExcelJS) и картинки по порядку листов.
 */
async function xlSplitDrawings(buf, stripNotes = false) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(buf);
  const parse = async path => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async('text'), 'application/xml') : null; };
  const rels = async path => {
    const d = await parse(path.replace(/([^/]+)$/, '_rels/$1.rels'));
    const m = {};
    if (d) for (const r of d.getElementsByTagName('Relationship')) m[r.getAttribute('Id')] = zipResolve(path, r.getAttribute('Target'));
    return m;
  };
  const wbRels = await rels('xl/workbook.xml');
  const wbXml = await parse('xl/workbook.xml');
  const images = [];
  for (const sh of wbXml ? [...wbXml.getElementsByTagName('sheet')] : []) {
    const path = wbRels[sh.getAttribute('r:id')] || wbRels[sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
    const list = [];
    images.push(list);
    if (!path || !zip.file(path)) continue;
    let xml = await zip.file(path).async('text');
    if (stripNotes) {
      // Запасной вариант для файлов, где ExcelJS не понимает примечания: убираем их, остальное сохраняем
      const lm = xml.match(/<legacyDrawing\b[^>]*r:id="([^"]+)"[^>]*\/>/);
      if (lm) xml = xml.replace(lm[0], '');
      const rp = path.replace(/([^/]+)$/, '_rels/$1.rels'), rf = zip.file(rp);
      if (rf) zip.file(rp, (await rf.async('text')).replace(/<Relationship[^>]*(comments|vmlDrawing)"[^>]*\/>/g, ''));
      zip.file(path, xml);
    }
    const m = xml.match(/<drawing\b[^>]*r:id="([^"]+)"[^>]*\/>/);
    if (!m) continue;
    const dPath = (await rels(path))[m[1]];
    zip.file(path, xml.replace(m[0], ''));
    // Убираем и ссылку на рисунок из связей листа, иначе ExcelJS всё равно попробует его разобрать
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const relFile = zip.file(relPath);
    if (relFile) zip.file(relPath, (await relFile.async('text')).replace(new RegExp(`<Relationship[^>]*Id="${m[1]}"[^>]*/>`), ''));
    const d = dPath && await parse(dPath);
    if (!d) continue;
    const dRels = await rels(dPath);
    // Префиксы пространств имён бывают разными (xdr:, без префикса) — ищем по локальному имени
    const tags = (n, name) => n ? [...n.getElementsByTagNameNS('*', name)] : [];
    const num = (n, name) => Number(tags(n, name)[0]?.textContent || 0);
    const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    for (const a of [...tags(d, 'twoCellAnchor'), ...tags(d, 'oneCellAnchor'), ...tags(d, 'absoluteAnchor')]) {
      const blip = tags(a, 'blip')[0];
      const media = blip && dRels[blip.getAttributeNS(R_NS, 'embed') || blip.getAttribute('r:embed')];
      if (!media || !zip.file(media)) continue;
      const from = tags(a, 'from')[0], to = tags(a, 'to')[0], ext = tags(a, 'ext').find(e => e.parentNode === a) || tags(a, 'ext')[0];
      const blob = new Blob([await zip.file(media).async('uint8array')], { type: `image/${extOf(media) === 'jpg' ? 'jpeg' : extOf(media)}` });
      list.push({
        src: URL.createObjectURL(blob),
        from: from && { col: num(from, 'col'), colOff: num(from, 'colOff') / 9525, row: num(from, 'row'), rowOff: num(from, 'rowOff') / 9525 },
        to: to && { col: num(to, 'col'), colOff: num(to, 'colOff') / 9525, row: num(to, 'row'), rowOff: num(to, 'rowOff') / 9525 },
        ext: ext && { width: Number(ext.getAttribute('cx')) / 9525, height: Number(ext.getAttribute('cy')) / 9525 },
      });
    }
  }
  // Сами файлы рисунков тоже убираем: ExcelJS разбирает их отдельно от листов и на некоторых падает
  for (const n of Object.keys(zip.files)) if (/^xl\/drawings\/(_rels\/)?drawing\d+\.xml(\.rels)?$/.test(n)) zip.remove(n);
  const ct = zip.file('[Content_Types].xml');
  if (ct) zip.file('[Content_Types].xml', (await ct.async('text')).replace(/<Override[^>]*PartName="\/xl\/drawings\/drawing\d+\.xml"[^>]*\/>/g, ''));
  return { buf: await zip.generateAsync({ type: 'arraybuffer' }), images };
}

async function xlModelExcelJS(file) {
  const src = await file.arrayBuffer();
  let split = await xlSplitDrawings(src), wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(split.buf); }
  catch (e) {
    console.warn('ExcelJS: повтор без примечаний', e);
    split = await xlSplitDrawings(src, true);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(split.buf);
  }
  const sheetImages = split.images;
  const theme = xlTheme(wb);
  return wb.worksheets.map((ws, wi) => ({ ws, images: sheetImages[wi] || [] })).filter(({ ws }) => ws.state !== 'veryHidden').map(({ ws, images }) => {
    const rows = Math.max(ws.rowCount || 0, 1), cols = Math.max(ws.columnCount || 0, 1);
    const defW = ws.properties.defaultColWidth || 8.43, defH = ws.properties.defaultRowHeight || 15;
    const colW = [], hiddenC = new Set(), rowH = [], hiddenR = new Set();
    for (let c = 1; c <= cols; c++) { const col = ws.getColumn(c); colW[c] = Math.round((col.width || defW) * 7 + 5); if (col.hidden) hiddenC.add(c); }
    const cells = new Map();
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      rowH[r] = Math.round((row.height || defH) * 4 / 3);
      if (row.hidden) hiddenR.add(r);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (cell.isMerged && cell.master !== cell) return;
        const st = cell.style || {}, v = cell.value;
        let raw = v, text = '', html = null, formula = null, link = null, kind = 's';
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if (v.richText) { html = v.richText.map(p => `<span style="${fontCss(p.font, theme)}">${xlEsc(p.text)}</span>`).join(''); text = v.richText.map(p => p.text).join(''); }
          else if ('formula' in v || 'sharedFormula' in v) { formula = '=' + (v.formula || v.sharedFormula); raw = v.result; }
          else if (v.hyperlink) { link = v.hyperlink; raw = v.text?.richText ? v.text.richText.map(p => p.text).join('') : v.text; }
          else if (v.error) { raw = v.error; kind = 'e'; }
        }
        if (html == null) {
          if (raw == null || raw === '') text = '';
          else if (raw && typeof raw === 'object' && raw.error) { text = raw.error; kind = 'e'; }
          else if (typeof raw === 'boolean') { text = raw ? 'ИСТИНА' : 'ЛОЖЬ'; kind = 'b'; }
          else if (typeof raw === 'number' || raw instanceof Date) { text = xlFormat(raw, st.numFmt); kind = 'n'; }
          else text = String(raw);
        }
        let css = fontCss(st.font, theme);
        const fill = st.fill;
        if (fill) {
          const bg = fill.type === 'gradient' ? xlColor(fill.stops?.[0]?.color, theme) : fill.pattern && fill.pattern !== 'none' ? xlColor(fill.fgColor, theme) || xlColor(fill.bgColor, theme) : null;
          if (bg) css += `background:${bg};`;
        }
        const b = st.border || {};
        for (const side of ['top', 'right', 'bottom', 'left']) if (b[side]?.style) css += `border-${side}:${XL_BORDER[b[side].style] || '1px solid'} ${xlColor(b[side].color, theme) || '#000'};`;
        const a = st.alignment || {};
        const h = a.horizontal && a.horizontal !== 'general' ? ({ centerContinuous: 'center', distributed: 'justify', fill: 'left' }[a.horizontal] || a.horizontal) : (kind === 'n' ? 'right' : kind === 'b' || kind === 'e' ? 'center' : 'left');
        css += `text-align:${h};`;
        css += `vertical-align:${{ top: 'top', middle: 'middle', center: 'middle' }[a.vertical] || 'bottom'};`;
        if (a.wrapText) css += 'white-space:pre-wrap;';
        if (a.indent) css += `padding-left:${4 + a.indent * 9}px;`;
        if (!text && !html && css === `text-align:${h};vertical-align:bottom;`) return;
        cells.set(`${r},${c}`, { text, html, formula, raw, link, kind, css, note: cell.note ? (typeof cell.note === 'string' ? cell.note : cell.note.texts?.map(t => t.text).join('')) : null });
      });
    });
    for (let r = 1; r <= rows; r++) if (!rowH[r]) rowH[r] = Math.round(defH * 4 / 3);
    const view = ws.views?.[0] || {};
    return {
      defColW: Math.round(defW * 7 + 5), defRowH: Math.round(defH * 4 / 3),
      name: ws.name, hidden: ws.state === 'hidden', tab: xlColor(ws.properties?.tabColor, theme), rows, cols, colW, rowH, hiddenC, hiddenR, cells, images,
      merges: (ws.model?.merges || []).map(s => XLSX.utils.decode_range(s)).map(m => ({ r1: m.s.r + 1, c1: m.s.c + 1, r2: m.e.r + 1, c2: m.e.c + 1 })),
      frozen: view.state === 'frozen' ? { rows: view.ySplit || 0, cols: view.xSplit || 0 } : { rows: 0, cols: 0 },
      grid: view.showGridLines !== false, styled: true,
    };
  });
}

async function xlModelSheetJS(file) {
  const wb = await readWorkbook(file);
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name], ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const rows = ref.e.r + 1, cols = ref.e.c + 1, colW = [], rowH = [], cells = new Map();
    for (let c = 1; c <= cols; c++) { const ci = ws['!cols']?.[c - 1]; colW[c] = ci?.wpx || (ci?.wch ? Math.round(ci.wch * 7 + 5) : 64); }
    for (let r = 1; r <= rows; r++) { const ri = ws['!rows']?.[r - 1]; rowH[r] = ri?.hpx || (ri?.hpt ? Math.round(ri.hpt * 4 / 3) : 20); }
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr[0] === '!') continue;
      const { r, c } = XLSX.utils.decode_cell(addr);
      const kind = cell.t === 'n' || cell.t === 'd' ? 'n' : cell.t === 'b' ? 'b' : cell.t === 'e' ? 'e' : 's';
      const text = cell.t === 'b' ? (cell.v ? 'ИСТИНА' : 'ЛОЖЬ') : cell.w ?? (cell.v == null ? '' : kind === 'n' ? xlFormat(cell.v, cell.z) : String(cell.v));
      cells.set(`${r + 1},${c + 1}`, { text, raw: cell.v, formula: cell.f ? '=' + cell.f : null, link: cell.l?.Target || null, kind, css: `text-align:${kind === 'n' ? 'right' : kind === 's' ? 'left' : 'center'};vertical-align:bottom;`, note: cell.c?.map(x => x.t).join('\n') || null });
    }
    return {
      name, hidden: false, tab: null, rows, cols, colW, rowH, hiddenC: new Set((ws['!cols'] || []).map((x, i) => x?.hidden && i + 1).filter(Boolean)), hiddenR: new Set((ws['!rows'] || []).map((x, i) => x?.hidden && i + 1).filter(Boolean)),
      cells, images: [], merges: (ws['!merges'] || []).map(m => ({ r1: m.s.r + 1, c1: m.s.c + 1, r2: m.e.r + 1, c2: m.e.c + 1 })), frozen: { rows: 0, cols: 0 }, grid: true, styled: false,
    };
  });
}

/* ---------- Отрисовка ---------- */

const XL_MAX_ROWS = 3000, XL_MAX_COLS = 250;

function xlRender(sh) {
  // Как в Excel: после данных видно немного пустых ячеек; область расширяем и под картинки
  let needR = sh.rows, needC = sh.cols;
  for (const im of sh.images) { needC = Math.max(needC, (im.to?.col ?? im.from?.col ?? 0) + 2); needR = Math.max(needR, (im.to?.row ?? im.from?.row ?? 0) + 2); }
  const rows = Math.min(needR + 20, XL_MAX_ROWS), cols = Math.min(needC + 6, XL_MAX_COLS);
  for (let c = 1; c <= cols; c++) if (!sh.colW[c]) sh.colW[c] = sh.defColW || 64;
  for (let r = 1; r <= rows; r++) if (!sh.rowH[r]) sh.rowH[r] = sh.defRowH || 20;
  const covered = new Set(), span = new Map();
  for (const m of sh.merges) {
    span.set(`${m.r1},${m.c1}`, m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
  }
  const visC = [], visR = [];
  for (let c = 1; c <= cols; c++) if (!sh.hiddenC.has(c)) visC.push(c);
  for (let r = 1; r <= rows; r++) if (!sh.hiddenR.has(r)) visR.push(r);
  // Отступы для закреплённых строк и столбцов
  const left = {}, top = {};
  let x = XL_HEAD_W; for (const c of visC) { left[c] = x; x += sh.colW[c]; }
  let y = XL_HEAD_H; for (const r of visR) { top[r] = y; y += sh.rowH[r]; }
  const fr = sh.frozen.rows, fc = sh.frozen.cols;
  let h = `<table class="xl-grid${sh.grid ? '' : ' no-grid'}"><colgroup><col style="width:${XL_HEAD_W}px">${visC.map(c => `<col style="width:${sh.colW[c]}px">`).join('')}</colgroup>`;
  h += `<thead><tr style="height:${XL_HEAD_H}px"><th class="xl-corner"></th>${visC.map(c => `<th class="xl-ch${c <= fc ? ' fz' : ''}" data-c="${c}" style="${c <= fc ? `left:${left[c]}px;` : ''}">${XLSX.utils.encode_col(c - 1)}</th>`).join('')}</tr></thead><tbody>`;
  for (const r of visR) {
    const frozenRow = r <= fr;
    h += `<tr style="height:${sh.rowH[r]}px"><th class="xl-rh${frozenRow ? ' fz' : ''}" data-r="${r}" style="${frozenRow ? `top:${top[r]}px;` : ''}">${r}</th>`;
    for (const c of visC) {
      const key = `${r},${c}`;
      if (covered.has(key)) continue;
      const cell = sh.cells.get(key), m = span.get(key);
      let attrs = '';
      if (m) {
        const cs = visC.filter(k => k >= m.c1 && k <= m.c2).length, rs = visR.filter(k => k >= m.r1 && k <= m.r2).length;
        if (cs > 1) attrs += ` colspan="${cs}"`; if (rs > 1) attrs += ` rowspan="${rs}"`;
      }
      let css = cell ? cell.css : '';
      let cls = '';
      if (frozenRow || c <= fc) { cls = ' class="fz"'; css += `${frozenRow ? `top:${top[r]}px;` : ''}${c <= fc ? `left:${left[c]}px;` : ''}z-index:${frozenRow && c <= fc ? 3 : 2};`; }
      let inner = cell ? (cell.html ?? xlEsc(cell.text)) : '';
      if (cell?.link) inner = `<a href="${xlEsc(cell.link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      if (cell?.note) inner += '<i class="xl-note"></i>';
      h += `<td data-r="${r}" data-c="${c}"${attrs}${cls}${css ? ` style="${css}"` : ''}${cell?.note ? ` title="${xlEsc(cell.note)}"` : ''}>${inner}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  // Картинки поверх сетки: якорь — ячейка (0-based) плюс смещение в пикселях
  const at = (idx, off, axis) => {
    const list = axis === 'c' ? visC : visR, sizes = axis === 'c' ? sh.colW : sh.rowH;
    let v = axis === 'c' ? XL_HEAD_W : XL_HEAD_H;
    for (const k of list) { if (k - 1 < idx) v += sizes[k]; else break; }
    return v + off;
  };
  for (const im of sh.images) {
    if (!im.from) continue;
    const x1 = at(im.from.col, im.from.colOff, 'c'), y1 = at(im.from.row, im.from.rowOff, 'r');
    const w = im.to ? at(im.to.col, im.to.colOff, 'c') - x1 : im.ext?.width || 100;
    const hh = im.to ? at(im.to.row, im.to.rowOff, 'r') - y1 : im.ext?.height || 100;
    h += `<img class="xl-img" src="${im.src}" alt="" style="left:${x1}px;top:${y1}px;width:${w}px;height:${hh}px">`;
  }
  return { html: h, cut: sh.rows > XL_MAX_ROWS || sh.cols > XL_MAX_COLS };
}

/* ---------- Окно просмотра ---------- */

async function viewExcel(file, box, ctx) {
  const ext = extOf(file.name);
  let sheets;
  if (['xlsx', 'xlsm', 'xltx'].includes(ext)) {
    try { await loadLib('exceljs'); sheets = await xlModelExcelJS(file); }
    catch (e) { console.warn('ExcelJS не смог прочитать файл, открываю без стилей', e); }
  }
  if (!sheets) sheets = await xlModelSheetJS(file);
  let cur = Math.max(0, sheets.findIndex(s => !s.hidden));
  let sel = null, matches = [], mi = -1;

  const nameBox = el('input', { class: 'xl-name', type: 'text', readonly: true, 'aria-label': 'Адрес ячейки', value: 'A1' });
  const fx = el('input', { class: 'xl-fx notranslate', type: 'text', readonly: true, 'aria-label': 'Содержимое ячейки' });
  const find = el('input', { type: 'search', class: 'xl-find', placeholder: 'Найти…', 'aria-label': 'Найти в таблице' });
  const findInfo = el('span', { class: 'muted xl-find-info' });
  const zoom = el('select', { 'aria-label': 'Масштаб' }, ['50', '75', '90', '100', '125', '150', '200'].map(v => el('option', { value: v }, v + '%')));
  zoom.value = '100';
  const fsBtn = el('button', { class: 'btn small', type: 'button' }, '⛶ На весь экран');
  const scroller = el('div', { class: 'xl-scroll', tabindex: 0 });
  const tabs = el('div', { class: 'xl-tabs' });
  const info = el('span', { class: 'muted xl-info' });
  const app = el('div', { class: 'xl-app' },
    el('div', { class: 'xl-toolbar' }, find, findInfo, el('span', { class: 'spacer' }), info, zoom, fsBtn),
    el('div', { class: 'xl-formula' }, nameBox, el('span', { class: 'xl-fx-label', 'aria-hidden': 'true' }, 'fx'), fx),
    scroller, tabs);
  box.append(app);

  const sheet = () => sheets[cur];
  const cellAt = (r, c) => sheet().cells.get(`${r},${c}`);
  function draw() {
    const sh = sheet(), r = xlRender(sh);
    scroller.innerHTML = `<div class="xl-canvas">${r.html}</div>`;
    scroller.querySelector('.xl-canvas').style.zoom = Number(zoom.value) / 100;
    info.textContent = `${sh.rows} × ${sh.cols}${r.cut ? ` · показаны первые ${Math.min(sh.rows, XL_MAX_ROWS)} строк и ${Math.min(sh.cols, XL_MAX_COLS)} столбцов` : ''}${sh.styled ? '' : ' · без оформления'}`;
    tabs.replaceChildren(...sheets.map((s, i) => el('button', { class: `xl-tab${i === cur ? ' on' : ''}${s.hidden ? ' hid' : ''}`, type: 'button', style: s.tab ? `--tab:${s.tab}` : '', title: s.hidden ? 'Скрытый лист' : s.name, onclick: () => { cur = i; sel = null; draw(); runFind(); } }, s.name)));
    select(1, 1, false);
  }
  function select(r, c, scroll = true) {
    scroller.querySelectorAll('td.sel, th.hl').forEach(n => n.classList.remove('sel', 'hl'));
    const td = scroller.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    sel = { r, c };
    nameBox.value = XLSX.utils.encode_col(c - 1) + r;
    const cell = cellAt(r, c);
    fx.value = cell ? (cell.formula || (cell.raw instanceof Date ? cell.text : cell.raw ?? cell.text ?? '')) : '';
    if (!td) return;
    td.classList.add('sel');
    scroller.querySelector(`th[data-c="${c}"]`)?.classList.add('hl');
    scroller.querySelector(`th[data-r="${r}"]`)?.classList.add('hl');
    if (scroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  scroller.addEventListener('click', e => {
    const td = e.target.closest('td');
    if (td && !e.target.closest('a')) select(Number(td.dataset.r), Number(td.dataset.c), false);
  });
  scroller.addEventListener('keydown', e => {
    if (!sel) return;
    const sh = sheet();
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, e.shiftKey ? -1 : 1] }[e.key];
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { const cell = cellAt(sel.r, sel.c); copyText(cell ? cell.text : ''); return; }
    if (!d) return;
    e.preventDefault();
    let { r, c } = sel;
    do { r += d[0]; c += d[1]; } while ((sh.hiddenR.has(r) || sh.hiddenC.has(c)) && r > 0 && c > 0 && r <= sh.rows && c <= sh.cols);
    if (r >= 1 && c >= 1 && r <= Math.min(sh.rows, XL_MAX_ROWS) && c <= Math.min(sh.cols, XL_MAX_COLS)) {
      const m = sh.merges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
      select(m ? m.r1 : r, m ? m.c1 : c);
    }
  });

  function runFind() {
    scroller.querySelectorAll('td.found').forEach(n => n.classList.remove('found'));
    const q = find.value.trim().toLowerCase();
    matches = []; mi = -1;
    if (!q) { findInfo.textContent = ''; return; }
    for (const [k, cell] of sheet().cells) if (String(cell.text).toLowerCase().includes(q) || (cell.formula || '').toLowerCase().includes(q)) matches.push(k.split(',').map(Number));
    matches.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [r, c] of matches) scroller.querySelector(`td[data-r="${r}"][data-c="${c}"]`)?.classList.add('found');
    findInfo.textContent = matches.length ? `Найдено: ${matches.length}. Enter — следующее` : 'Ничего не найдено';
    if (matches.length) { mi = 0; select(...matches[0]); }
  }
  find.addEventListener('input', runFind);
  find.addEventListener('keydown', e => { if (e.key === 'Enter' && matches.length) { e.preventDefault(); mi = (mi + (e.shiftKey ? matches.length - 1 : 1)) % matches.length; select(...matches[mi]); } });
  zoom.addEventListener('change', () => { const cv = scroller.querySelector('.xl-canvas'); if (cv) cv.style.zoom = Number(zoom.value) / 100; });

  const setFsLabel = on => (fsBtn.textContent = on ? '✕ Выйти из полноэкранного' : '⛶ На весь экран');
  fsBtn.addEventListener('click', async () => {
    if (document.fullscreenElement === app) return document.exitFullscreen();
    if (app.classList.contains('pseudo-fs')) { app.classList.remove('pseudo-fs'); document.body.classList.remove('xl-lock'); return setFsLabel(false); }
    try { await app.requestFullscreen(); }
    catch { app.classList.add('pseudo-fs'); document.body.classList.add('xl-lock'); setFsLabel(true); }
  });
  document.addEventListener('fullscreenchange', () => setFsLabel(document.fullscreenElement === app));
  app.addEventListener('keydown', e => { if (e.key === 'Escape' && app.classList.contains('pseudo-fs')) fsBtn.click(); });

  draw();
  scroller.focus({ preventScroll: true });

  const base = baseName(file.name);
  const plainRows = () => {
    const sh = sheet(), out = [];
    for (let r = 1; r <= sh.rows; r++) { const row = []; for (let c = 1; c <= sh.cols; c++) row.push(sh.cells.get(`${r},${c}`)?.text ?? ''); out.push(row); }
    while (out.length && out[out.length - 1].every(v => v === '')) out.pop();
    return out;
  };
  const csvCellEsc = (v, d) => /["\n\r]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v;
  ctx.action('CSV для Excel', () => textBlob('﻿' + plainRows().map(r => r.map(v => csvCellEsc(v, ';')).join(';')).join('\r\n'), `${base}_${sheet().name}.csv`, 'text/csv;charset=utf-8'));
  ctx.action('JSON', () => { const [head = [], ...body] = plainRows(); return textBlob(JSON.stringify(body.map(r => Object.fromEntries(head.map((h, i) => [h || `col${i + 1}`, r[i] ?? '']))), null, 2), `${base}_${sheet().name}.json`, 'application/json'); });
  ctx.action('HTML', () => textBlob(htmlDoc(`${base} — ${sheet().name}`, xlRender(sheet()).html, '.xl-grid{border-collapse:collapse;table-layout:fixed;font:11pt Calibri,Arial,sans-serif}.xl-grid td{border:1px solid #e1e1e1;padding:1px 4px;overflow:hidden;white-space:nowrap}.xl-grid th{background:#f3f3f3;border:1px solid #d4d4d4;font-weight:400;color:#555}.xl-img{position:absolute}'), `${base}.html`, 'text/html'));
  ctx.action('PDF', async () => {
    await loadLib('html2pdf');
    await ctx.progress('Верстаю PDF…');
    const node = el('div', { class: 'doc-render xl-print' }, el('h2', {}, sheet().name));
    node.insertAdjacentHTML('beforeend', xlRender(sheet()).html);
    return { blob: await htmlToPdf(node, file.name, { orientation: 'landscape' }), name: `${base}_${sheet().name}.pdf` };
  });
}
