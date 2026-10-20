'use strict';

/* ===================== Просмотр файлов ===================== */

const CODE_LANGS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp',
  go: 'go', rs: 'rust', swift: 'swift', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', bat: 'dos', cmd: 'dos', ps1: 'powershell', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  ini: 'ini', cfg: 'ini', conf: 'ini', env: 'bash', properties: 'properties', gradle: 'gradle', lua: 'lua', pl: 'perl', r: 'r', dart: 'dart', vue: 'xml', svelte: 'xml',
  tex: 'latex', diff: 'diff', patch: 'diff', dockerfile: 'dockerfile', makefile: 'makefile', kts: 'kotlin', scala: 'scala', m: 'objectivec',
};
const TEXT_EXTS = ['txt', 'log', 'srt', 'vtt', 'nfo', 'readme', ...Object.keys(CODE_LANGS).filter(e => e !== 'svg')];

const VIEW_TYPES = [
  { key: 'excel', exts: ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'csv', 'tsv', 'numbers'], libs: ['xlsx'], render: viewExcel },
  { key: 'word', exts: ['docx', 'docm', 'dotx', 'doc', 'odt', 'rtf'], libs: ['jszip'], render: viewWord },
  { key: 'slides', exts: ['pptx', 'ppsx', 'potx', 'pptm', 'odp'], libs: ['jszip'], render: viewSlides },
  { key: 'pdf', exts: ['pdf'], libs: ['pdfjs'], render: viewPdf },
  { key: 'book', exts: ['epub', 'fb2', 'fbz'], libs: ['jszip'], render: viewBook },
  { key: 'djvu', exts: ['djvu', 'djv'], libs: ['djvu'], render: viewDjvu },
  { key: 'archive', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'cab', 'iso', 'lzma', 'cpio'], render: viewArchive },
  { key: 'psd', exts: ['psd', 'psb'], libs: ['psd'], render: viewPsd },
  { key: 'mail', exts: ['eml', 'msg', 'mht', 'mhtml'], render: viewMail },
  { key: 'markdown', exts: ['md', 'markdown', 'mdown'], libs: ['markdown'], render: viewMarkdown },
  { key: 'font', exts: ['ttf', 'otf', 'woff', 'woff2'], libs: ['fontkit'], render: viewFont },
  { key: 'media', exts: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'], render: viewMedia },
  { key: 'image', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff'], libs: ['exif'], render: viewImage },
  { key: 'code', exts: TEXT_EXTS, libs: ['hljs'], render: viewCode },
];

function viewTypeFor(file) {
  const name = file.name.toLowerCase();
  if (/\.fb2\.zip$/.test(name)) return VIEW_TYPES.find(t => t.key === 'book');
  const ext = extOf(name) || name;
  return VIEW_TYPES.find(t => t.exts.includes(ext))
    || (/^text\/|json|xml|javascript/.test(file.type) ? VIEW_TYPES.find(t => t.key === 'code') : null);
}
const acceptFor = keys => VIEW_TYPES.filter(t => keys.includes(t.key)).flatMap(t => t.exts.map(e => '.' + e)).join(',');

/* ---------- Общая оболочка просмотрщика ---------- */

function viewerUI(root, { only, label, hint }) {
  const stack = [];
  const accept = only ? acceptFor(only) + (only.includes('book') ? ',.zip' : '') : undefined;
  const dz = dropzone({ accept, label: label || 'Выберите файл', hint, onFiles: f => { stack.length = 0; show(f[0]); } });
  const title = el('div', { class: 'viewer-title' });
  const actions = el('div', { class: 'row viewer-actions' });
  const back = el('button', { class: 'btn ghost small', type: 'button', hidden: true, onclick: () => { stack.pop(); show(stack.pop(), true); } }, '← Назад');
  const head = el('div', { class: 'viewer-head', hidden: true }, el('div', { class: 'row' }, back, title), actions,
    el('button', { class: 'btn ghost small', type: 'button', onclick: () => dz.pick() }, 'Открыть другой файл'));
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const body = el('div', { class: 'viewer-body' });
  const results = el('div', { class: 'results' });
  root.append(dz, head, status, body, results);

  async function show(file) {
    stack.push(file);
    back.hidden = stack.length < 2;
    results.replaceChildren(); body.replaceChildren(); actions.replaceChildren(); status.replaceChildren();
    dz.hidden = true; head.hidden = false;
    title.replaceChildren(el('strong', { class: 'notranslate' }, file.name), el('span', { class: 'muted' }, ` · ${fmtSize(file.size)}`));
    const type = viewTypeFor(file);
    if (!type) {
      setStatus(status, 'error', `Формат «.${extOf(file.name) || '?'}» пока не поддерживается. Поддерживаются Excel, Word, PowerPoint, PDF, DjVu, EPUB, FB2, архивы, письма, PSD, шрифты, видео, аудио, картинки и текстовые файлы.`);
      return;
    }
    const ctx = {
      status,
      progress: msg => { setStatus(status, 'busy', msg); return tick(); },
      action(label, fn, primary) {
        const b = el('button', { class: `btn small${primary ? ' primary' : ''}`, type: 'button' }, label);
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const r = await fn();
            status.replaceChildren();
            if (r) renderResults(results, Array.isArray(r) ? { files: r } : r.files ? r : { files: [r] });
            if (r) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
          finally { b.disabled = false; }
        });
        actions.append(b);
        return b;
      },
      open: f => show(f),
    };
    try {
      await ctx.progress('Открываю…');
      await Promise.all((type.libs || []).map(loadLib));
      await type.render(file, body, ctx);
      if (!status.querySelector('.error')) status.replaceChildren();
      const next = nextSteps([{ blob: file, name: file.name }]);
      if (next) body.append(next);
    } catch (e) {
      console.error(e);
      setStatus(status, 'error', e.message || 'Не удалось открыть файл.');
    }
  }
}

function viewerTool(cfg) {
  tool({ ...cfg, cat: cfg.cat || 'docs', render: root => viewerUI(root, cfg) });
}

const textBlob = (text, name, type = 'text/plain;charset=utf-8') => ({ blob: new Blob([text], { type }), name });
const htmlDoc = (title, body, css = '') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xmlEsc(title)}</title><style>body{font:16px/1.6 Arial,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}${css}</style></head><body>${body}</body></html>`;

/* ---------- Таблицы ---------- */

async function readWorkbook(file) {
  const ext = extOf(file.name), buf = await file.arrayBuffer();
  if (ext === 'csv' || ext === 'tsv') {
    const text = decodeText(buf);
    const first = text.split('\n')[0];
    const FS = ext === 'tsv' ? '\t' : [';', '\t', ',', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    return XLSX.read(text, { type: 'string', FS, raw: false, cellDates: true });
  }
  return XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
}

function sheetTable(ws, query, limit = 2000) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
  const cols = Math.min(200, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const q = query.trim().toLowerCase();
  const shown = [];
  rows.forEach((r, i) => { if (shown.length < limit && (!q || r.some(c => String(c).toLowerCase().includes(q)))) shown.push([i, r]); });
  const table = el('table', { class: 'sheet' },
    el('thead', {}, el('tr', {}, el('th', { class: 'corner' }), Array.from({ length: cols }, (_, c) => el('th', {}, XLSX.utils.encode_col(c))))),
    el('tbody', {}, shown.map(([i, r]) => el('tr', {}, el('th', {}, i + 1), Array.from({ length: cols }, (_, c) => el('td', { class: typeof r[c] === 'number' || /^-?[\d\s.,]+%?$/.test(r[c]) ? 'num' : '' }, r[c] ?? ''))))));
  return { table, rows: rows.length, cols, shown: shown.length };
}

async function viewExcel(file, box, ctx) {
  const wb = await readWorkbook(file);
  let current = wb.SheetNames[0];
  const tabs = el('div', { class: 'chips sheet-tabs' });
  const search = el('input', { type: 'search', id: 'sheet-q', placeholder: 'Найти в таблице…', 'aria-label': 'Поиск в таблице' });
  const info = el('span', { class: 'muted' });
  const holder = el('div', { class: 'sheet-wrap' });
  const draw = () => {
    tabs.replaceChildren(...wb.SheetNames.map(n => el('button', { class: `chip${n === current ? ' on' : ''}`, type: 'button', onclick: () => { current = n; draw(); } }, n)));
    const r = sheetTable(wb.Sheets[current], search.value);
    holder.replaceChildren(r.table);
    info.textContent = `${r.rows} ${plural(r.rows, ['строка', 'строки', 'строк'])} × ${r.cols} ${plural(r.cols, ['столбец', 'столбца', 'столбцов'])}${r.shown < r.rows ? ` · показано ${r.shown}` : ''}`;
  };
  search.addEventListener('input', draw);
  box.append(el('div', { class: 'row' }, wb.SheetNames.length > 1 && tabs, search, info), holder);
  draw();
  const base = baseName(file.name);
  ctx.action('CSV для Excel', () => textBlob('﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[current], { FS: ';' }), `${base}_${current}.csv`, 'text/csv;charset=utf-8'));
  ctx.action('JSON', () => textBlob(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[current], { defval: '' }), null, 2), `${base}_${current}.json`, 'application/json'));
  ctx.action('XLSX', () => ({ blob: new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: `${base}.xlsx` }));
  ctx.action('HTML', () => textBlob(htmlDoc(base, XLSX.utils.sheet_to_html(wb.Sheets[current], { header: '', footer: '' })), `${base}.html`, 'text/html'));
  ctx.action('PDF', async () => {
    await loadLib('html2pdf');
    await ctx.progress('Верстаю PDF…');
    const node = el('div', { class: 'doc-render sheet-pdf' }, el('h2', {}, current), sheetTable(wb.Sheets[current], '', 3000).table);
    return { blob: await htmlToPdf(node, file.name, { orientation: 'landscape' }), name: `${base}_${current}.pdf` };
  });
}

/* ---------- Документы ---------- */

/** Текст из старого Word (.doc, 97–2003) по таблице фрагментов. */
function legacyDocText(buf) {
  const cfb = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
  const find = n => XLSX.CFB.find(cfb, n);
  const wd = find('WordDocument');
  if (!wd) throw new Error('Это не документ Word 97–2003.');
  const u8 = c => c instanceof Uint8Array ? c : Uint8Array.from(c);
  const w = u8(wd.content), dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  if (dv.getUint16(0, true) !== 0xa5ec) throw new Error('Это не документ Word 97–2003.');
  const table = find(dv.getUint16(0x0a, true) & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('Не удалось прочитать структуру документа.');
  const fcClx = dv.getUint32(0x01a2, true), lcbClx = dv.getUint32(0x01a6, true);
  const t = u8(table.content), tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  let p = fcClx;
  while (p < fcClx + lcbClx && t[p] === 0x01) p += 3 + tv.getUint16(p + 1, true);
  if (t[p] !== 0x02) throw new Error('Не удалось прочитать текст документа.');
  const lcb = tv.getUint32(p + 1, true), plc = p + 5, n = (lcb - 4) / 12;
  const dec1251 = new TextDecoder('windows-1252'), dec16 = new TextDecoder('utf-16le');
  let text = '';
  for (let i = 0; i < n; i++) {
    const cp0 = tv.getUint32(plc + i * 4, true), cp1 = tv.getUint32(plc + (i + 1) * 4, true);
    let fc = tv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true);
    const compressed = fc & 0x40000000;
    if (compressed) { fc = (fc & ~0x40000000) / 2; text += dec1251.decode(w.subarray(fc, fc + (cp1 - cp0))); }
    else text += dec16.decode(w.subarray(fc, fc + (cp1 - cp0) * 2));
  }
  return text.replace(/\x13[^\x14\x15]*\x14?([^\x15]*)\x15/g, '$1').replace(/\x07/g, '\t').replace(/[\r\x0b\x0c]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** ODT → HTML: абзацы, заголовки, списки, таблицы, жирный и курсив, картинки. */
async function odtNode(zip) {
  const xml = new DOMParser().parseFromString(await zip.file('content.xml').async('text'), 'application/xml');
  const styles = {};
  for (const st of xml.getElementsByTagName('style:style')) {
    const tp = st.getElementsByTagName('style:text-properties')[0];
    if (tp) styles[st.getAttribute('style:name')] = { b: tp.getAttribute('fo:font-weight') === 'bold', i: tp.getAttribute('fo:font-style') === 'italic', u: (tp.getAttribute('style:text-underline-style') || 'none') !== 'none' };
  }
  const conv = async node => {
    let h = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { h += xmlEsc(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      const inner = () => conv(n), name = n.nodeName;
      if (name === 'text:h') h += `<h${Math.min(6, Number(n.getAttribute('text:outline-level')) || 2)}>${await inner()}</h${Math.min(6, Number(n.getAttribute('text:outline-level')) || 2)}>`;
      else if (name === 'text:p') h += `<p>${await inner() || '&nbsp;'}</p>`;
      else if (name === 'text:span') {
        const s = styles[n.getAttribute('text:style-name')] || {};
        let x = await inner();
        if (s.b) x = `<b>${x}</b>`; if (s.i) x = `<i>${x}</i>`; if (s.u) x = `<u>${x}</u>`;
        h += x;
      } else if (name === 'text:list') h += `<ul>${await inner()}</ul>`;
      else if (name === 'text:list-item') h += `<li>${await inner()}</li>`;
      else if (name === 'table:table') h += `<table>${await inner()}</table>`;
      else if (name === 'table:table-row') h += `<tr>${await inner()}</tr>`;
      else if (name === 'table:table-cell') h += `<td>${await inner()}</td>`;
      else if (name === 'text:line-break') h += '<br>';
      else if (name === 'text:tab') h += '&emsp;';
      else if (name === 'text:s') h += '&nbsp;'.repeat(Number(n.getAttribute('text:c')) || 1);
      else if (name === 'text:a') h += `<a href="${xmlEsc(n.getAttribute('xlink:href') || '#')}">${await inner()}</a>`;
      else if (name === 'draw:image') { const d = await zipDataUrl(zip, n.getAttribute('xlink:href')); if (d) h += `<img src="${d}" alt="">`; }
      else if (name === 'office:annotation' || name === 'text:sequence-decls' || name === 'office:forms') continue;
      else h += await inner();
    }
    return h;
  };
  const bodyEl = xml.getElementsByTagName('office:text')[0] || xml.getElementsByTagName('office:body')[0];
  return el('div', { class: 'doc-page', html: await conv(bodyEl) });
}

async function viewWord(file, box, ctx) {
  const ext = extOf(file.name), base = baseName(file.name);
  let page;
  if (ext === 'doc') {
    await loadLib('xlsx');
    const text = legacyDocText(await file.arrayBuffer());
    page = el('div', { class: 'doc-page' }, text.split(/\n/).map(p => el('p', {}, p || ' ')));
    box.append(el('p', { class: 'hint' }, 'Старый формат .doc показан как текст, без форматирования и картинок.'), page);
  } else if (ext === 'odt') {
    page = await odtNode(await JSZip.loadAsync(file));
    box.append(page);
  } else if (ext === 'rtf') {
    await loadLib('rtf');
    RTFJS.loggingEnabled(false); WMFJS.loggingEnabled(false); EMFJS.loggingEnabled(false);
    const els = await new RTFJS.Document(await file.arrayBuffer()).render();
    page = el('div', { class: 'doc-page' }, els);
    box.append(page);
  } else {
    await loadLib('docx');
    const host = el('div', { class: 'docx-host' });
    box.append(host);
    await docx.renderAsync(file, host, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true, useBase64URL: true });
    page = host;
  }
  ctx.action('TXT', () => textBlob(page.innerText, `${base}.txt`));
  ctx.action('HTML', () => textBlob(htmlDoc(base, page.querySelector('.docx-wrapper')?.innerHTML || page.innerHTML), `${base}.html`, 'text/html'));
  ctx.action('PDF', async () => {
    await loadLib('html2pdf');
    await ctx.progress('Верстаю PDF…');
    let node;
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx') {
      await loadLib('mammoth');
      node = el('div', { class: 'doc-render', html: (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value });
    } else node = el('div', { class: 'doc-render', html: page.innerHTML });
    return { blob: await htmlToPdf(node, file.name), name: `${base}.pdf` };
  });
}

/* ---------- Презентации ---------- */

async function pptxText(zip) {
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const out = [];
  for (const [i, n] of slides.entries()) {
    const x = new DOMParser().parseFromString(await zip.file(n).async('text'), 'application/xml');
    const paras = [...x.getElementsByTagName('a:p')].map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')).filter(Boolean);
    out.push(`— Слайд ${i + 1} —\n${paras.join('\n')}`);
  }
  return out.join('\n\n');
}

async function viewSlides(file, box, ctx) {
  const zip = await JSZip.loadAsync(file), base = baseName(file.name);
  if (extOf(file.name) === 'odp') {
    const xml = new DOMParser().parseFromString(await zip.file('content.xml').async('text'), 'application/xml');
    const pages = [...xml.getElementsByTagName('draw:page')];
    for (const [i, pg] of pages.entries()) {
      const card = el('section', { class: 'slide-card' }, el('div', { class: 'muted' }, `Слайд ${i + 1}`));
      for (const fr of pg.getElementsByTagName('draw:frame')) {
        const img = fr.getElementsByTagName('draw:image')[0];
        if (img && !fr.getElementsByTagName('text:p').length) { const d = await zipDataUrl(zip, img.getAttribute('xlink:href')); if (d) card.append(el('img', { src: d, alt: '' })); continue; }
        const ps = [...fr.getElementsByTagName('text:p')].map(p => p.textContent).filter(Boolean);
        if (ps.length) card.append(el('div', { class: 'slide-text' }, ps.map(t => el('p', {}, t))));
      }
      box.append(card);
    }
    ctx.action('Текст презентации', () => textBlob(pages.map((p, i) => `— Слайд ${i + 1} —\n${[...p.getElementsByTagName('text:p')].map(x => x.textContent).filter(Boolean).join('\n')}`).join('\n\n'), `${base}.txt`));
  } else {
    await loadLib('pptx');
    const host = el('div', { class: 'pptx-host' });
    box.append(host);
    const w = Math.min(960, Math.max(320, box.clientWidth || 960));
    const previewer = pptxPreview.init(host, { width: w, height: Math.round(w * 9 / 16) });
    await previewer.preview(await file.arrayBuffer());
    ctx.action('Текст презентации', async () => textBlob(await pptxText(zip), `${base}.txt`));
  }
  const media = Object.keys(zip.files).filter(n => /^(ppt\/media|Pictures)\/.+\.(png|jpe?g|gif|bmp|svg|webp|emf|wmf|tiff?)$/i.test(n));
  if (media.length) ctx.action(`Картинки (${media.length})`, async () => {
    const out = new JSZip();
    for (const n of media) out.file(n.split('/').pop(), await zip.file(n).async('uint8array'));
    return { blob: await out.generateAsync({ type: 'blob' }), name: `${base}_картинки.zip` };
  });
}

/* ---------- PDF ---------- */

function lazyPages(box, count, renderPage, ratioOf) {
  const zoomSel = el('select', { 'aria-label': 'Масштаб' }, [['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']].map(([v, l]) => el('option', { value: v }, l)));
  zoomSel.value = '1';
  const list = el('div', { class: 'page-stack' });
  const done = new Map();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) draw(Number(e.target.dataset.n));
  }, { rootMargin: '600px 0px' });
  let queue = Promise.resolve();
  const draw = n => {
    const key = `${n}@${zoomSel.value}`;
    if (done.has(key)) return;
    done.set(key, true);
    queue = queue.then(async () => {
      const slot = list.children[n - 1];
      if (!slot) return;
      try { const c = await renderPage(n, Number(zoomSel.value)); slot.replaceChildren(c, el('span', { class: 'page-num' }, n)); }
      catch (e) { slot.replaceChildren(el('p', { class: 'hint' }, `Страница ${n} не открылась`)); }
    });
  };
  const build = async () => {
    io.disconnect(); done.clear();
    list.style.setProperty('--zoom', zoomSel.value);
    list.replaceChildren();
    for (let n = 1; n <= count; n++) {
      const slot = el('div', { class: 'page-slot', 'data-n': n, style: `aspect-ratio: ${await ratioOf(n)}` });
      list.append(slot);
      io.observe(slot);
    }
  };
  zoomSel.addEventListener('change', build);
  box.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, `${count} ${plural(count, ['страница', 'страницы', 'страниц'])}`), zoomSel), list);
  return build();
}

async function viewPdf(file, box, ctx) {
  const doc = await openPdfJs(file), base = baseName(file.name);
  const ratios = {};
  await lazyPages(box, doc.numPages, async (n, z) => {
    const page = await doc.getPage(n);
    const w = Math.min(900, box.clientWidth || 900) * z * Math.min(2, devicePixelRatio || 1);
    return renderPdfPage(page, w / page.getViewport({ scale: 1 }).width);
  }, async n => { if (!ratios[n]) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); ratios[n] = `${v.width} / ${v.height}`; } return ratios[n]; });
  ctx.action('Текст из PDF', async () => textBlob((await pdfText(file, ctx.progress)).join('\n\n'), `${base}.txt`));
}

/* ---------- Книги ---------- */

async function viewBook(file, box, ctx) {
  const isEpub = extOf(file.name) === 'epub';
  const { node, title } = await (isEpub ? epubNode(file, ctx.progress) : fb2Node(file, ctx.progress));
  node.className = 'book-body';
  const key = `book:${file.name}:${file.size}`;
  let prefs = { size: 19, theme: 'paper' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('book-prefs')) }; } catch { /* по умолчанию */ }
  const reader = el('article', { class: 'book-reader' }, node);
  const apply = () => {
    reader.style.setProperty('--book-size', prefs.size + 'px');
    reader.dataset.theme = prefs.theme;
    try { localStorage.setItem('book-prefs', JSON.stringify(prefs)); } catch { /* */ }
  };
  const heads = [...node.querySelectorAll('h1, h2, h3')].filter(h => h.textContent.trim());
  const toc = el('select', { 'aria-label': 'Оглавление' }, el('option', { value: '' }, 'Оглавление'), heads.map((h, i) => el('option', { value: i }, h.textContent.trim().slice(0, 80))));
  toc.addEventListener('change', () => { heads[toc.value]?.scrollIntoView({ block: 'start' }); toc.value = ''; });
  const bar = el('div', { class: 'row book-bar' },
    heads.length > 1 && toc,
    el('button', { class: 'btn small', type: 'button', onclick: () => { prefs.size = Math.max(13, prefs.size - 1); apply(); } }, 'A−'),
    el('button', { class: 'btn small', type: 'button', onclick: () => { prefs.size = Math.min(32, prefs.size + 1); apply(); } }, 'A+'),
    ...[['paper', 'Светлая'], ['sepia', 'Сепия'], ['night', 'Ночь']].map(([k, l]) => el('button', { class: 'chip', type: 'button', onclick: () => { prefs.theme = k; apply(); } }, l)));
  box.append(el('h2', { class: 'h3' }, title), bar, reader);
  apply();
  let saved = 0;
  try { saved = Number(localStorage.getItem(key)) || 0; } catch { /* */ }
  if (saved) requestAnimationFrame(() => window.scrollTo(0, reader.offsetTop + saved * reader.offsetHeight));
  const onScroll = () => {
    if (!reader.isConnected) return removeEventListener('scroll', onScroll);
    clearTimeout(onScroll.t);
    onScroll.t = setTimeout(() => { try { localStorage.setItem(key, String(Math.max(0, (scrollY - reader.offsetTop) / reader.offsetHeight))); } catch { /* */ } }, 300);
  };
  addEventListener('scroll', onScroll, { passive: true });
  ctx.action('TXT', () => textBlob(node.innerText, `${baseName(file.name.replace(/\.zip$/i, ''))}.txt`));
  ctx.action('PDF', async () => {
    await loadLib('html2pdf');
    const n = node.cloneNode(true); n.className = 'doc-render book';
    await ctx.progress('Верстаю PDF…');
    return { blob: await htmlToPdf(n, file.name), name: `${baseName(file.name.replace(/\.zip$/i, ''))}.pdf` };
  });
}

/* ---------- DjVu ---------- */

async function openDjvu(file) {
  try { return new (DjVuLib.default || DjVuLib).Document(await file.arrayBuffer()); }
  catch { throw new Error(`Не удалось открыть «${file.name}»: файл повреждён или это не DjVu.`); }
}
async function djvuCanvas(doc, n, maxW = Infinity) {
  const page = await doc.getPage(n);
  const id = page.getImageData();
  const c = makeCanvas(id.width, id.height);
  c.getContext('2d').putImageData(id, 0, 0);
  if (c.width <= maxW) return { canvas: c, dpi: page.getDpi() || 300, page };
  const s = makeCanvas(maxW, c.height * maxW / c.width);
  s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
  return { canvas: s, dpi: (page.getDpi() || 300) * maxW / c.width, page };
}

async function djvuToPdf(doc, progress, quality = 0.8) {
  await loadLib('pdflib');
  const out = await PDFLib.PDFDocument.create();
  const n = doc.getPagesQuantity();
  for (let i = 1; i <= n; i++) {
    await progress(`Страница ${i} из ${n}`);
    const { canvas, dpi } = await djvuCanvas(doc, i, 2600);
    const jpg = await out.embedJpg(await (await canvasBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
    const w = canvas.width / dpi * 72, h = canvas.height / dpi * 72;
    out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    doc.releaseMemoryIfRequired?.();
  }
  return pdfBlob(await out.save());
}

async function viewDjvu(file, box, ctx) {
  const doc = await openDjvu(file), base = baseName(file.name);
  const n = doc.getPagesQuantity();
  const sizes = doc.getPagesSizes?.() || [];
  await lazyPages(box, n, async (i, z) => (await djvuCanvas(doc, i, Math.min(900, box.clientWidth || 900) * z * Math.min(2, devicePixelRatio || 1))).canvas,
    async i => sizes[i - 1] ? `${sizes[i - 1].width} / ${sizes[i - 1].height}` : '0.707');
  ctx.action('Сохранить в PDF', async () => ({ blob: await djvuToPdf(doc, ctx.progress), name: `${base}.pdf` }), true);
  ctx.action('Текст', async () => {
    const parts = [];
    for (let i = 1; i <= n; i++) { await ctx.progress(`Текст: страница ${i} из ${n}`); parts.push((await doc.getPage(i)).getText() || ''); }
    const t = parts.join('\n\n').trim();
    if (!t) throw new Error('В этом DjVu нет текстового слоя. Сохраните его в PDF и воспользуйтесь распознаванием текста (OCR).');
    return textBlob(t, `${base}.txt`);
  });
}

/* ---------- Архивы ---------- */

let archiveLib = null;
async function loadArchiveLib() {
  if (!archiveLib) {
    archiveLib = import(new URL(ROOT + 'vendor/view/archive/libarchive.js', location.href).href).then(m => {
      m.Archive.init({ workerUrl: new URL(ROOT + 'vendor/view/archive/worker-bundle.js', location.href).href });
      return m.Archive;
    });
    archiveLib.catch(() => (archiveLib = null));
  }
  return archiveLib;
}

async function viewArchive(file, box, ctx) {
  let Archive;
  try { Archive = await loadArchiveLib(); } catch { throw new Error('Не удалось загрузить модуль архивов. Откройте сайт через веб-сервер, а не как файл с диска.'); }
  const arc = await Archive.open(file);
  if (await arc.hasEncryptedData()) {
    const pw = el('input', { type: 'password', id: 'arc-pw', placeholder: 'Пароль архива' });
    await new Promise(res => {
      box.append(el('div', { class: 'row' }, el('label', { for: 'arc-pw' }, 'Архив защищён паролем:'), pw, el('button', { class: 'btn primary small', type: 'button', onclick: res }, 'Открыть')));
      pw.addEventListener('keydown', e => e.key === 'Enter' && res());
      pw.focus();
    });
    await arc.usePassword(pw.value);
    box.replaceChildren();
  }
  const entries = (await arc.getFilesArray()).map(e => ({ path: e.path + e.file.name, file: e.file }));
  const total = entries.reduce((s, e) => s + (e.file.size || 0), 0);
  const search = el('input', { type: 'search', placeholder: 'Найти в архиве…', 'aria-label': 'Поиск в архиве' });
  const list = el('div', { class: 'table-scroll' });
  const extract = async e => {
    await ctx.progress(`Распаковываю ${e.file.name}…`);
    const f = await e.file.extract();
    ctx.status.replaceChildren();
    return f;
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = entries.filter(e => !q || e.path.toLowerCase().includes(q)).slice(0, 3000);
    list.replaceChildren(el('table', { class: 'data-table archive-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Файл'), el('th', {}, 'Размер'), el('th', {}, ''))),
      el('tbody', {}, rows.map(e => el('tr', {},
        el('td', { class: 'notranslate' }, e.path),
        el('td', { class: 'num' }, e.file.size != null ? fmtSize(e.file.size) : ''),
        el('td', { class: 'row-actions' },
          viewTypeFor(e.file) && el('button', { class: 'btn small', type: 'button', onclick: async () => { try { ctx.open(await extract(e)); } catch (err) { setStatus(ctx.status, 'error', err.message); } } }, 'Открыть'),
          el('button', { class: 'btn small', type: 'button', onclick: async () => { try { const f = await extract(e); download(f, e.file.name); } catch (err) { setStatus(ctx.status, 'error', err.message); } } }, 'Скачать')))))));
  };
  search.addEventListener('input', draw);
  box.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, `${entries.length} ${plural(entries.length, ['файл', 'файла', 'файлов'])} · ${fmtSize(total)} в распакованном виде`), search), list);
  draw();
  ctx.action('Распаковать всё в ZIP', async () => {
    await loadLib('jszip');
    const zip = new JSZip();
    let k = 0;
    for (const e of entries) {
      if (++k % 20 === 0) await ctx.progress(`Распаковываю ${k} из ${entries.length}`);
      zip.file(e.path, await e.file.extract());
    }
    await ctx.progress('Собираю ZIP…');
    return { blob: await zip.generateAsync({ type: 'blob' }), name: `${baseName(file.name.replace(/\.tar$/i, ''))}.zip` };
  }, true);
}

/* ---------- PSD ---------- */

async function viewPsd(file, box, ctx) {
  let psd;
  try { psd = agPsd.readPsd(await file.arrayBuffer(), { useImageData: false }); }
  catch (e) { throw new Error(`Не удалось открыть «${file.name}»: ${e.message}`); }
  const flat = [];
  const walk = (layers, depth) => (layers || []).forEach(l => { flat.push({ l, depth }); walk(l.children, depth + 1); });
  walk(psd.children, 0);
  let comp = psd.canvas;
  if (!comp) {
    comp = makeCanvas(psd.width, psd.height);
    const ctx2 = comp.getContext('2d');
    for (const { l } of flat) if (l.canvas && !l.hidden) { ctx2.globalAlpha = l.opacity ?? 1; ctx2.drawImage(l.canvas, l.left || 0, l.top || 0); }
  }
  const view = copyCanvasEl(comp);
  view.className = 'preview-canvas';
  box.append(el('div', { class: 'muted' }, `${psd.width} × ${psd.height} px · ${flat.length} ${plural(flat.length, ['слой', 'слоя', 'слоёв'])}`), view,
    flat.length ? el('details', { class: 'table-details' }, el('summary', {}, 'Слои'), el('ul', { class: 'layer-list' }, flat.map(({ l, depth }) => el('li', { style: `padding-left:${depth * 18}px` }, l.canvas && el('img', { src: l.canvas.toDataURL(), alt: '', class: 'thumb' }), el('span', { class: 'notranslate' }, l.name || '—'), l.hidden && el('span', { class: 'muted' }, ' (скрыт)'))))) : '');
  const base = baseName(file.name);
  ctx.action('PNG', () => exportCanvas(comp, 'image/png', 1, base), true);
  ctx.action('JPG', () => { const c = drawImageCanvas(comp, comp.width, comp.height, { fill: '#fff' }); return exportCanvas(c, 'image/jpeg', 0.92, base); });
  if (flat.some(x => x.l.canvas)) ctx.action('Слои в PNG (ZIP)', async () => {
    await loadLib('jszip');
    const zip = new JSZip();
    let i = 0;
    for (const { l } of flat) if (l.canvas) zip.file(`${String(++i).padStart(3, '0')}_${(l.name || 'layer').replace(/[\\/:*?"<>|]/g, '_')}.png`, await canvasBlob(l.canvas));
    return { blob: await zip.generateAsync({ type: 'blob' }), name: `${base}_слои.zip` };
  });
}
const copyCanvasEl = c => { const n = makeCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };

/* ---------- Письма ---------- */

async function viewMail(file, box, ctx) {
  const ext = extOf(file.name), buf = await file.arrayBuffer();
  let mail;
  if (ext === 'msg') {
    await loadLib('msg');
    const MR = msgReader.MsgReader.default || msgReader.MsgReader;
    const r = new MR(buf), d = r.getFileData();
    if (d.error) throw new Error(`Не удалось открыть «${file.name}»: ${d.error}`);
    mail = {
      from: [d.senderName, d.senderEmail && `<${d.senderEmail}>`].filter(Boolean).join(' '),
      to: (d.recipients || []).map(x => [x.name, x.email && `<${x.email}>`].filter(Boolean).join(' ')).join(', '),
      subject: d.subject, date: d.messageDeliveryTime || d.clientSubmitTime || '', html: d.bodyHtml || (d.html ? new TextDecoder().decode(d.html) : ''), text: d.body,
      attachments: (d.attachments || []).map(a => { const x = r.getAttachment(a); return { filename: x.fileName, mimeType: a.attachMimeTag || 'application/octet-stream', content: x.content, contentId: a.pidContentId }; }),
    };
  } else {
    await loadLib('eml');
    const m = await postalMime.PostalMime.parse(buf);
    const addr = a => a ? [a.name, a.address && `<${a.address}>`].filter(Boolean).join(' ') : '';
    mail = { from: addr(m.from), to: (m.to || []).map(addr).join(', '), cc: (m.cc || []).map(addr).join(', '), subject: m.subject, date: m.date, html: m.html, text: m.text, attachments: m.attachments || [] };
  }
  const atts = mail.attachments.map(a => ({ ...a, blob: new Blob([a.content], { type: a.mimeType || 'application/octet-stream' }) }));
  let html = mail.html || '';
  if (html) {
    for (const a of atts) if (a.contentId) {
      const url = URL.createObjectURL(a.blob), cid = String(a.contentId).replace(/[<>]/g, '');
      html = html.split(`cid:${cid}`).join(url);
    }
    await loadLib('purify');
    html = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'] });
  }
  const dateStr = mail.date ? new Date(mail.date).toLocaleString('ru-RU') : '';
  box.append(el('dl', { class: 'mail-head' },
    [['От', mail.from], ['Кому', mail.to], ['Копия', mail.cc], ['Тема', mail.subject], ['Дата', dateStr]].filter(([, v]) => v).map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', { class: 'notranslate' }, v)))));
  if (html) {
    const frame = el('iframe', { class: 'mail-frame', sandbox: 'allow-same-origin allow-popups', title: 'Текст письма' });
    frame.srcdoc = html.includes('<base') ? html : html.replace(/<head[^>]*>/i, m => `${m}<base target="_blank">`);
    frame.addEventListener('load', () => { try { frame.style.height = Math.min(4000, frame.contentDocument.documentElement.scrollHeight + 20) + 'px'; } catch { /* */ } });
    box.append(frame);
  } else box.append(el('pre', { class: 'mail-text notranslate' }, mail.text || '(пустое письмо)'));
  if (atts.length) box.append(el('h2', { class: 'h3' }, `Вложения (${atts.length})`), el('ul', { class: 'file-list' }, atts.map(a => el('li', { class: 'file' },
    el('span', { class: 'thumb badge-ext' }, extOf(a.filename || '').slice(0, 4) || 'файл'),
    el('div', { class: 'file-meta' }, el('span', { class: 'file-name notranslate' }, a.filename || 'без имени'), el('span', { class: 'file-size' }, fmtSize(a.blob.size))),
    el('div', { class: 'file-actions' },
      a.filename && viewTypeFor({ name: a.filename, type: a.mimeType || '' }) && el('button', { class: 'btn small', type: 'button', onclick: () => ctx.open(new File([a.blob], a.filename, { type: a.blob.type })) }, 'Открыть'),
      el('button', { class: 'btn small', type: 'button', onclick: () => download(a.blob, a.filename || 'attachment') }, 'Скачать'))))));
  const base = baseName(file.name);
  if (atts.length > 1) ctx.action('Все вложения (ZIP)', async () => {
    await loadLib('jszip');
    const zip = new JSZip();
    atts.forEach((a, i) => zip.file(a.filename || `attachment-${i + 1}`, a.blob));
    return { blob: await zip.generateAsync({ type: 'blob' }), name: `${base}_вложения.zip` };
  });
  ctx.action('Письмо в PDF', async () => {
    await loadLib('html2pdf');
    const head = `<p><b>${xmlEsc(mail.subject || '')}</b><br>От: ${xmlEsc(mail.from || '')}<br>Кому: ${xmlEsc(mail.to || '')}<br>${xmlEsc(dateStr)}</p><hr>`;
    const bodyHtml = html ? new DOMParser().parseFromString(html, 'text/html').body.innerHTML : `<pre style="white-space:pre-wrap">${xmlEsc(mail.text || '')}</pre>`;
    return { blob: await htmlToPdf(el('div', { class: 'doc-render', html: head + bodyHtml }), file.name), name: `${base}.pdf` };
  });
  ctx.action('Текст письма', () => textBlob(`${mail.subject || ''}\nОт: ${mail.from}\nКому: ${mail.to}\n${dateStr}\n\n${mail.text || new DOMParser().parseFromString(html, 'text/html').body.innerText}`, `${base}.txt`));
}

/* ---------- Markdown, код, текст ---------- */

async function viewMarkdown(file, box, ctx) {
  const src = decodeText(await file.arrayBuffer());
  const html = DOMPurify.sanitize(marked.parse(src));
  const out = el('article', { class: 'prose md-body', html });
  const raw = el('pre', { class: 'code-view', hidden: true }, src);
  box.append(el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', onclick: () => { out.hidden = !out.hidden; raw.hidden = !raw.hidden; } }, 'Исходник / просмотр')), out, raw);
  const base = baseName(file.name);
  ctx.action('HTML', () => textBlob(htmlDoc(base, html, 'pre,code{background:#f4f4f4;padding:2px 4px;border-radius:4px}pre{padding:12px;overflow:auto}'), `${base}.html`, 'text/html'));
  ctx.action('PDF', async () => { await loadLib('html2pdf'); return { blob: await htmlToPdf(el('div', { class: 'doc-render', html }), file.name), name: `${base}.pdf` }; });
}

async function viewCode(file, box, ctx) {
  const ext = extOf(file.name) || file.name.toLowerCase();
  let src = decodeText(await file.arrayBuffer());
  const lang = CODE_LANGS[ext];
  const wrap = el('input', { type: 'checkbox', id: 'code-wrap' });
  const pre = el('pre', { class: 'code-view numbered' });
  const big = src.length > 1.5e6;
  const paint = () => {
    const shown = big ? src.slice(0, 1.5e6) : src;
    let html = xmlEsc(shown);
    if (!big && lang && window.hljs?.getLanguage(lang)) html = hljs.highlight(shown, { language: lang, ignoreIllegals: true }).value;
    else if (!big && window.hljs && !lang && shown.length < 2e5 && !['txt', 'log', 'srt', 'vtt', 'nfo'].includes(ext)) html = hljs.highlightAuto(shown).value;
    pre.innerHTML = html.split('\n').map(l => `<span class="ln">${l || ' '}</span>`).join('\n');
  };
  wrap.addEventListener('change', () => pre.classList.toggle('wrap', wrap.checked));
  const lines = src.split('\n').length;
  box.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, `${lines.toLocaleString('ru-RU')} ${plural(lines, ['строка', 'строки', 'строк'])}${lang ? ` · ${lang}` : ''}${big ? ' · показаны первые 1,5 млн символов' : ''}`),
    el('label', { class: 'field check inline' }, wrap, el('span', {}, 'Переносить строки'))), pre);
  paint();
  if (ext === 'json') ctx.action('Форматировать JSON', () => { try { src = JSON.stringify(JSON.parse(src), null, 2); paint(); } catch (e) { throw new Error(jsonError(e, src)); } });
  ctx.action('Копировать всё', async () => { await copyText(src); setStatus(ctx.status, 'ok', 'Скопировано'); });
  ctx.action('Сохранить в UTF-8', () => textBlob(src, file.name));
}

/* ---------- Картинки и EXIF ---------- */

const EXIF_LABELS = [['Make', 'Производитель'], ['Model', 'Камера'], ['LensModel', 'Объектив'], ['DateTimeOriginal', 'Дата съёмки'], ['ExposureTime', 'Выдержка'], ['FNumber', 'Диафрагма'], ['ISO', 'ISO'], ['FocalLength', 'Фокусное расстояние'], ['Flash', 'Вспышка'], ['Orientation', 'Ориентация'], ['Software', 'Программа'], ['Artist', 'Автор'], ['Copyright', 'Права']];

async function viewImage(file, box, ctx) {
  const img = await loadImage(file);
  img.className = 'image-view';
  const fit = el('input', { type: 'checkbox', id: 'img-fit', checked: true });
  fit.addEventListener('change', () => img.classList.toggle('actual', !fit.checked));
  box.append(el('div', { class: 'row' }, el('span', { class: 'muted' }, `${img.naturalWidth} × ${img.naturalHeight} px · ${(file.type || extOf(file.name)).replace('image/', '').toUpperCase()}`),
    el('label', { class: 'field check inline' }, fit, el('span', {}, 'Вписать в экран'))), el('div', { class: 'image-stage' }, img));
  let exif = null;
  try { exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, iptc: true, xmp: false, icc: false, mergeOutput: true }); } catch { /* метаданных нет */ }
  if (exif && Object.keys(exif).length) {
    const fmt = (k, v) => k === 'ExposureTime' && v < 1 ? `1/${Math.round(1 / v)} с` : k === 'FNumber' ? `f/${v}` : k === 'FocalLength' ? `${v} мм` : v instanceof Date ? v.toLocaleString('ru-RU') : String(v);
    const rows = EXIF_LABELS.filter(([k]) => exif[k] != null).map(([k, l]) => [l, fmt(k, exif[k])]);
    const gps = exif.latitude != null && exif.longitude != null;
    box.append(el('section', { class: 'exif' },
      el('h2', { class: 'h3' }, 'Данные EXIF'),
      gps && el('p', { class: 'status-msg error' }, 'В фото записано место съёмки. Перед публикацией его лучше удалить — кнопка «Удалить EXIF» выше.'),
      el('dl', { class: 'mail-head' }, rows.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v))),
        gps && el('div', {}, el('dt', {}, 'Координаты'), el('dd', {}, `${exif.latitude.toFixed(6)}, ${exif.longitude.toFixed(6)} `,
          el('a', { href: `https://yandex.ru/maps/?pt=${exif.longitude},${exif.latitude}&z=16&l=map`, target: '_blank', rel: 'noopener' }, 'Яндекс Карты'), ' · ',
          el('a', { href: `https://www.google.com/maps?q=${exif.latitude},${exif.longitude}`, target: '_blank', rel: 'noopener' }, 'Google Maps')))),
      el('details', { class: 'table-details' }, el('summary', {}, `Все теги (${Object.keys(exif).length})`),
        el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, el('tbody', {}, Object.entries(exif).filter(([, v]) => typeof v !== 'object' || v instanceof Date).map(([k, v]) => el('tr', {}, el('td', { class: 'notranslate' }, k), el('td', { class: 'notranslate' }, fmt(k, v))))))))));
  } else box.append(el('p', { class: 'hint' }, 'Метаданных EXIF в этом файле нет.'));
  ctx.action('Удалить EXIF', async () => {
    const c = drawImageCanvas(img, img.naturalWidth, img.naturalHeight, { fill: fillFor(sameMime(file)) });
    return exportCanvas(c, sameMime(file), 0.95, file.name, '_без-exif');
  });
}

/* ---------- Шрифты ---------- */

let fontSeq = 0;
async function viewFont(file, box, ctx) {
  const buf = await file.arrayBuffer();
  let meta = {};
  try {
    const f = fontkit.create(new Uint8Array(buf));
    meta = { 'Семейство': f.familyName, 'Начертание': f.subfamilyName, 'Полное имя': f.fullName, 'Версия': f.version, 'Глифов': f.numGlyphs, 'Символов': f.characterSet?.length, 'Права': f.copyright };
    meta.chars = (f.characterSet || []).filter(c => c > 32).slice(0, 800);
  } catch { /* покажем без метаданных */ }
  const family = `viewfont${++fontSeq}`;
  const face = new FontFace(family, buf);
  try { await face.load(); document.fonts.add(face); } catch { throw new Error(`Браузер не смог загрузить шрифт «${file.name}».`); }
  const sample = el('input', { type: 'text', id: 'font-sample', value: 'Съешь же ещё этих мягких французских булок, да выпей чаю. The quick brown fox jumps over the lazy dog 0123456789', 'aria-label': 'Пример текста' });
  const rows = el('div', { class: 'font-rows' });
  const draw = () => rows.replaceChildren(...[14, 18, 24, 32, 48, 72].map(s => el('div', { class: 'font-row' }, el('span', { class: 'muted' }, `${s}px`), el('div', { class: 'notranslate', style: `font-family:${family};font-size:${s}px` }, sample.value))));
  sample.addEventListener('input', draw);
  draw();
  box.append(el('dl', { class: 'mail-head' }, Object.entries(meta).filter(([k, v]) => k !== 'chars' && v != null && v !== '').map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', { class: 'notranslate' }, String(v))))),
    el('label', { for: 'font-sample', class: 'block-label' }, 'Пример текста'), sample, rows,
    meta.chars?.length ? el('details', { class: 'table-details', open: true }, el('summary', {}, 'Символы шрифта'), el('div', { class: 'glyph-grid notranslate', style: `font-family:${family}` }, meta.chars.map(c => el('span', { title: `U+${c.toString(16).toUpperCase().padStart(4, '0')}` }, String.fromCodePoint(c))))) : '');
}

/* ---------- Видео и аудио ---------- */

async function viewMedia(file, box, ctx) {
  const url = URL.createObjectURL(file);
  const isVideo = /^video\//.test(file.type) || ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'].includes(extOf(file.name));
  const m = el(isVideo ? 'video' : 'audio', { src: url, controls: true, preload: 'metadata', class: 'media-view', playsinline: true });
  const info = el('span', { class: 'muted' });
  m.addEventListener('loadedmetadata', () => {
    const d = m.duration, t = isFinite(d) ? `${Math.floor(d / 3600) ? Math.floor(d / 3600) + ':' : ''}${String(Math.floor(d / 60) % 60).padStart(2, '0')}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '';
    info.textContent = [t && `Длительность ${t}`, isVideo && m.videoWidth && `${m.videoWidth} × ${m.videoHeight} px`].filter(Boolean).join(' · ');
  });
  m.addEventListener('error', () => setStatus(ctx.status, 'error', 'Браузер не может воспроизвести этот формат. Попробуйте Chrome или Edge, либо файл MP4/WebM.'));
  const rate = el('select', { 'aria-label': 'Скорость' }, ['0.5', '0.75', '1', '1.25', '1.5', '2'].map(v => el('option', { value: v }, `${v}×`)));
  rate.value = '1';
  rate.addEventListener('change', () => (m.playbackRate = Number(rate.value)));
  box.append(m, el('div', { class: 'row' }, info, el('label', { class: 'muted' }, 'Скорость'), rate));
  if (isVideo) ctx.action('Кадр в PNG', async () => {
    if (!m.videoWidth) throw new Error('Видео ещё не загрузилось.');
    const c = makeCanvas(m.videoWidth, m.videoHeight);
    c.getContext('2d').drawImage(m, 0, 0);
    return exportCanvas(c, 'image/png', 1, file.name, `_кадр-${Math.floor(m.currentTime)}с`);
  }, true);
}

/* ===================== Инструменты ===================== */

viewerTool({ id: 'file-viewer', badge: 'ВСЁ', title: 'Открыть любой файл', label: 'Выберите файл любого формата',
  hint: 'Excel, Word, PowerPoint, PDF, DjVu, EPUB, FB2, ZIP, RAR, 7z, EML, MSG, PSD, шрифты, видео, код',
  desc: 'Просмотр Excel, Word, PowerPoint, PDF, DjVu, архивов, писем, книг, PSD, шрифтов, видео и кода без установки программ.' });
viewerTool({ id: 'excel-viewer', badge: 'XLS', title: 'Открыть Excel онлайн', only: ['excel'], hint: 'XLSX, XLS, ODS, CSV, TSV, Numbers',
  desc: 'Просмотр таблиц XLSX, XLS, ODS и CSV с листами и поиском, экспорт в CSV, JSON, PDF.' });
viewerTool({ id: 'word-viewer', badge: 'DOCX', title: 'Открыть Word онлайн', only: ['word'], hint: 'DOCX, DOC, ODT, RTF',
  desc: 'Просмотр документов DOCX, DOC, ODT и RTF с форматированием, сохранение в PDF и TXT.' });
viewerTool({ id: 'pptx-viewer', badge: 'PPT', title: 'Открыть PowerPoint онлайн', only: ['slides'], hint: 'PPTX, PPSX, ODP',
  desc: 'Просмотр презентаций PPTX и ODP по слайдам, текст и картинки из презентации.' });
viewerTool({ id: 'pdf-viewer', badge: 'PDF', title: 'Просмотр PDF', only: ['pdf'],
  desc: 'Откройте PDF в браузере с масштабом и быстрой прокруткой, даже очень большой.' });
viewerTool({ id: 'ebook-reader', badge: 'BOOK', title: 'Читалка EPUB и FB2', only: ['book'], hint: 'EPUB, FB2, FB2.ZIP',
  desc: 'Читайте электронные книги в браузере: оглавление, размер шрифта, ночной режим, место чтения запоминается.' });
viewerTool({ id: 'djvu-viewer', badge: 'DJVU', title: 'Открыть DjVu', only: ['djvu'],
  desc: 'Просмотр книг и сканов DjVu без программ и сохранение в PDF.' });
viewerTool({ id: 'archive-viewer', badge: 'RAR', title: 'Открыть архив ZIP, RAR, 7z', only: ['archive'], hint: 'ZIP, RAR, 7Z, TAR, GZ, BZ2, XZ, ISO, CAB',
  desc: 'Посмотрите содержимое архива, достаньте нужные файлы или перепакуйте всё в ZIP. Поддерживаются архивы с паролем.' });
viewerTool({ id: 'email-viewer', badge: 'EML', title: 'Открыть письмо EML и MSG', only: ['mail'], hint: 'EML, MSG (Outlook), MHT',
  desc: 'Просмотр писем Outlook и почтовых файлов с вложениями, сохранение письма в PDF.' });
viewerTool({ id: 'psd-viewer', badge: 'PSD', title: 'Открыть PSD без Photoshop', only: ['psd'],
  desc: 'Просмотр PSD со списком слоёв, сохранение в PNG и JPG, выгрузка слоёв.' });
viewerTool({ id: 'exif-viewer', badge: 'EXIF', title: 'Просмотр фото и EXIF', only: ['image'], hint: 'JPG, PNG, HEIC, TIFF, WEBP, AVIF, SVG',
  desc: 'Откройте любое фото, посмотрите камеру, дату и место съёмки, удалите метаданные.' });
viewerTool({ id: 'code-viewer', badge: '</>', title: 'Просмотр кода и текста', only: ['code', 'markdown'], hint: 'TXT, JSON, XML, JS, PY, HTML, CSS, SQL, LOG, MD и др.',
  desc: 'Откройте текстовый файл или исходный код с подсветкой синтаксиса и номерами строк.' });
viewerTool({ id: 'font-viewer', badge: 'Aa', title: 'Просмотр шрифтов', only: ['font'], hint: 'TTF, OTF, WOFF, WOFF2',
  desc: 'Посмотрите, как выглядит шрифт, его название, версию и все символы.' });
viewerTool({ id: 'media-player', badge: '▶', title: 'Видео и аудиоплеер', only: ['media'], hint: 'MP4, WEBM, MOV, MKV, MP3, WAV, OGG, M4A, FLAC',
  desc: 'Воспроизведите видео или аудио без установки программ, меняйте скорость, сохраняйте кадры.' });

/* Конвертеры на тех же библиотеках */

const SHEET_FORMATS = [['csv', 'CSV — для Excel (разделитель ;)'], ['csv-comma', 'CSV — с запятой'], ['xlsx', 'Excel XLSX'], ['ods', 'OpenDocument ODS'], ['json', 'JSON'], ['html', 'HTML-таблица']];

function sheetConverter(id, badge, title, desc, format, accept) {
  fileTool({
    id, cat: 'docs', badge, title, desc, accept, libs: ['xlsx'], action: 'Конвертировать', zipName: 'tables.zip',
    options: [
      { id: 'format', label: 'В формат', type: 'select', value: format, choices: SHEET_FORMATS },
      { id: 'sheets', label: 'Листы', type: 'select', choices: [['all', 'Все листы'], ['first', 'Только первый']], showIf: v => !['xlsx', 'ods'].includes(v.format) },
    ],
    async perFile(file, o) {
      const wb = await readWorkbook(file), base = baseName(file.name);
      if (o.format === 'xlsx' || o.format === 'ods') {
        const mime = o.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet';
        return [{ blob: new Blob([XLSX.write(wb, { bookType: o.format, type: 'array' })], { type: mime }), name: `${base}.${o.format}` }];
      }
      const names = o.sheets === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
      return names.map(n => {
        const ws = wb.Sheets[n], suffix = names.length > 1 ? `_${n}` : '';
        if (o.format === 'json') return textBlob(JSON.stringify(XLSX.utils.sheet_to_json(ws, { defval: '' }), null, 2), `${base}${suffix}.json`, 'application/json');
        if (o.format === 'html') return textBlob(htmlDoc(n, XLSX.utils.sheet_to_html(ws, { header: '', footer: '' })), `${base}${suffix}.html`, 'text/html');
        const FS = o.format === 'csv' ? ';' : ',';
        return textBlob((FS === ';' ? '﻿' : '') + XLSX.utils.sheet_to_csv(ws, { FS }), `${base}${suffix}.csv`, 'text/csv;charset=utf-8');
      });
    },
  });
}
const SHEET_ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.csv,.tsv,.numbers';
sheetConverter('spreadsheet-converter', 'X⇄C', 'Конвертер таблиц', 'Переведите таблицу между XLSX, XLS, ODS, CSV, JSON и HTML.', 'csv', SHEET_ACCEPT);
sheetConverter('excel-to-csv', 'X→C', 'Excel в CSV', 'Сохраните листы Excel в CSV, который правильно откроется в русском Excel.', 'csv', SHEET_ACCEPT);
sheetConverter('csv-to-excel', 'C→X', 'CSV в Excel', 'Превратите CSV в настоящий файл Excel XLSX — с правильной кодировкой кириллицы.', 'xlsx', '.csv,.tsv,.txt');

fileTool({
  id: 'excel-to-pdf', cat: 'pdf', badge: 'X→P', title: 'Excel в PDF', desc: 'Сохраните таблицу Excel, ODS или CSV как PDF для печати и отправки.',
  accept: SHEET_ACCEPT, libs: ['xlsx', 'html2pdf'], action: 'Создать PDF', zipName: 'excel-pdf.zip',
  note: 'Таблица переносится значениями, без диаграмм и условного форматирования. Текст в PDF вставляется картинкой.',
  options: [
    { id: 'sheets', label: 'Листы', type: 'select', choices: [['all', 'Все листы'], ['first', 'Только первый']] },
    { id: 'orient', label: 'Ориентация', type: 'select', value: 'landscape', choices: [['landscape', 'Альбомная'], ['portrait', 'Книжная']] },
  ],
  async perFile(file, o, { progress }) {
    const wb = await readWorkbook(file);
    const names = o.sheets === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
    const node = el('div', { class: 'doc-render sheet-pdf' }, names.map((n, i) => el('div', { class: i ? 'chapter' : '' }, names.length > 1 && el('h2', {}, n), sheetTable(wb.Sheets[n], '', 5000).table)));
    await progress('Верстаю PDF…');
    return [{ blob: await htmlToPdf(node, file.name, { orientation: o.orient }), name: `${baseName(file.name)}.pdf` }];
  },
});

fileTool({
  id: 'djvu-to-pdf', cat: 'pdf', badge: 'D→P', title: 'DjVu в PDF', desc: 'Переведите книги и сканы DjVu в PDF, который открывается на любом устройстве.',
  accept: '.djvu,.djv', libs: ['djvu', 'pdflib'], action: 'Конвертировать', zipName: 'djvu-pdf.zip',
  options: [{ id: 'q', label: 'Качество', type: 'select', value: '0.8', choices: [['0.6', 'Меньше размер'], ['0.8', 'Стандарт'], ['0.92', 'Высокое']] }],
  async perFile(file, o, { progress }) {
    return [{ blob: await djvuToPdf(await openDjvu(file), progress, Number(o.q)), name: `${baseName(file.name)}.pdf` }];
  },
});

fileTool({
  id: 'create-zip', cat: 'docs', badge: 'ZIP', title: 'Создать ZIP-архив', desc: 'Упакуйте несколько файлов в один ZIP, чтобы отправить их одним вложением.',
  multiple: true, libs: ['jszip'], action: 'Создать архив',
  options: [
    { id: 'name', label: 'Имя архива', value: 'архив' },
    { id: 'level', label: 'Сжатие', type: 'select', value: '6', choices: [['0', 'Без сжатия — быстрее'], ['6', 'Обычное'], ['9', 'Максимальное — меньше размер']] },
  ],
  async run(files, o, { progress }) {
    const zip = new JSZip();
    uniqueNames(files.map(f => ({ name: f.name, blob: f }))).forEach(f => zip.file(f.name, f.blob));
    const total = files.reduce((s, f) => s + f.size, 0);
    const blob = await zip.generateAsync({ type: 'blob', compression: o.level === '0' ? 'STORE' : 'DEFLATE', compressionOptions: { level: Number(o.level) || 6 } }, m => progress(`Упаковываю: ${Math.round(m.percent)}%`));
    return { files: [{ blob, name: `${(o.name || 'архив').replace(/[\\/:*?"<>|]/g, '_')}.zip` }], message: `${files.length} ${plural(files.length, ['файл', 'файла', 'файлов'])}: ${fmtSize(total)} → ${fmtSize(blob.size)}.` };
  },
});

fileTool({
  id: 'remove-exif', cat: 'image', badge: '⌫GPS', title: 'Удалить EXIF и геометку', desc: 'Уберите из фото данные о камере, дате и месте съёмки перед публикацией.',
  accept: IMG_ACCEPT, hint: IMG_HINT, action: 'Удалить метаданные', zipName: 'no-exif.zip',
  async perFile(f) {
    const img = await loadImage(f);
    const mime = sameMime(f);
    return [await exportCanvas(drawImageCanvas(img, img.naturalWidth, img.naturalHeight, { fill: fillFor(mime) }), mime, 0.95, f.name, '_без-exif')];
  },
});
