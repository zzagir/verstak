'use strict';

/* ---------- Библиотеки: грузятся по требованию из папки vendor ---------- */

/** Путь от текущей страницы до корня сайта: «» на главной, «../» на страницах инструментов. */
const ROOT = (typeof document !== 'undefined' && document.body && document.body.dataset.root) || '';

const LIBS = {
  pdflib: ['vendor/pdf-lib.min.js'],
  pdfjs: ['vendor/pdf.min.js'],
  jszip: ['vendor/jszip.min.js'],
  cropper: ['vendor/cropper.min.css', 'vendor/cropper.min.js'],
  mammoth: ['vendor/mammoth.browser.min.js'],
  html2pdf: ['vendor/html2pdf.bundle.min.js'],
  fontkit: ['vendor/fontkit.umd.min.js'],
  utif: ['vendor/UTIF.js'],
  heic: ['vendor/heic2any.min.js'],
  gifenc: ['vendor/gifenc.min.js'],
  tesseract: ['vendor/tess/tesseract.min.js'],
  faceapi: ['vendor/face/face-api.js'],
  qrcode: ['vendor/qrcode.js'],
  jsqr: ['vendor/jsQR.js'],
  bg: ['vendor/bg/background-removal.min.js'],
};
const libCache = {};

function loadLib(name) {
  if (!libCache[name]) {
    libCache[name] = Promise.all(LIBS[name].map(src => new Promise((resolve, reject) => {
      const node = src.endsWith('.css')
        ? el('link', { rel: 'stylesheet', href: ROOT + src })
        : el('script', { src: ROOT + src });
      node.onload = resolve;
      node.onerror = () => reject(new Error('Не удалось загрузить компонент сайта. Обновите страницу и попробуйте снова.'));
      document.head.append(node);
    }))).then(() => {
      if (name === 'pdfjs') pdfjsLib.GlobalWorkerOptions.workerSrc = ROOT + 'vendor/pdf.worker.min.js';
    });
    libCache[name].catch(() => delete libCache[name]);
  }
  return libCache[name];
}

/* ---------- DOM ---------- */

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'value' || k === 'checked') node[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : String(kid));
  }
  return node;
}

const tick = () => new Promise(r => setTimeout(r, 0));

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' КБ';
  return (bytes / 1024 / 1024).toFixed(2).replace('.', ',') + ' МБ';
}

const baseName = name => name.replace(/\.[^.]+$/, '');
const extOf = name => (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      fallbackEl.focus();
      fallbackEl.select();
      try { return document.execCommand('copy'); } catch { return false; }
    }
    return false;
  }
}

function copyButton(getText, fallbackEl, label = 'Копировать') {
  const btn = el('button', { class: 'btn', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    const ok = await copyText(getText(), fallbackEl);
    btn.textContent = ok ? 'Скопировано' : 'Выделено — нажмите Ctrl+C';
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}

function setStatus(box, kind, msg) {
  box.replaceChildren(el('div', { class: `status-msg ${kind}` }, kind === 'busy' && el('span', { class: 'spinner' }), el('span', {}, msg)));
}

/* ---------- Номера страниц: «1-3, 5, 8-» ---------- */

function parseRanges(str, total) {
  const parts = String(str).split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Укажите номера страниц, например: 1-3, 5');
  return parts.map(p => {
    let a, b;
    const m = p.match(/^(\d*)\s*[-–—]\s*(\d*)$/);
    if (m && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(p)) a = b = +p;
    else throw new Error(`Не удалось разобрать «${p}». Пишите номера через запятую, диапазоны через дефис: 1-3, 5`);
    if (a < 1 || b > total || a > b) throw new Error(`«${p}» выходит за пределы документа: в нём ${total} ${plural(total, ['страница', 'страницы', 'страниц'])}.`);
    return [a, b];
  });
}

const expandRanges = ranges => ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));

/* ---------- Изображения ---------- */

const IMG_ACCEPT = 'image/*,.heic,.heif,.tif,.tiff';
const isHeic = f => /\.(heic|heif)$/i.test(f.name) || /heic|heif/.test(f.type);
const isTiff = f => /\.tiff?$/i.test(f.name) || f.type === 'image/tiff';

/** Все страницы TIFF как canvas. */
async function decodeTiff(file) {
  await loadLib('utif');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf).filter(i => i.t256);
  if (!ifds.length) throw new Error(`Не удалось прочитать TIFF «${file.name}».`);
  return ifds.map(ifd => {
    UTIF.decodeImage(buf, ifd);
    const c = makeCanvas(ifd.width, ifd.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd)), ifd.width, ifd.height), 0, 0);
    return c;
  });
}

/** HEIC и TIFF браузеры не открывают сами — переводим в PNG. */
async function toBrowserImage(file) {
  if (isHeic(file)) {
    await loadLib('heic');
    try {
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return Array.isArray(out) ? out[0] : out;
    } catch { throw new Error(`Не удалось прочитать HEIC «${file.name}».`); }
  }
  if (isTiff(file)) return canvasBlob((await decodeTiff(file))[0], 'image/png');
  return file;
}

async function loadImage(file) {
  const blob = await toBrowserImage(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Не удалось открыть изображение «${file.name}». Поддерживаются JPG, PNG, WEBP, GIF, BMP, SVG, HEIC, TIFF.`)); };
    img.src = url;
  });
}

const fontCache = {};
/** Шрифты с кириллицей для вставки настоящего текста в PDF. */
function fontBytes(name = 'DejaVuSans.ttf') {
  if (!fontCache[name]) {
    fontCache[name] = fetch(ROOT + 'vendor/fonts/' + name).then(r => {
      if (!r.ok) throw new Error('Не удалось загрузить шрифт. Откройте сайт через веб-сервер, а не как файл с диска.');
      return r.arrayBuffer();
    });
    fontCache[name].catch(() => delete fontCache[name]);
  }
  return fontCache[name];
}

/** Документ pdf-lib с подключённым fontkit и встроенным шрифтом с кириллицей. */
async function embedCyrFont(doc, name) {
  await loadLib('fontkit');
  doc.registerFontkit(fontkit);
  return doc.embedFont(await fontBytes(name), { subset: true });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function canvasBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    b => b ? resolve(b) : reject(new Error('Не удалось сохранить изображение: оно слишком большое для браузера.')),
    mime, quality));
}

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tif' };
const sameMime = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png';

function encodeBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const row = (w * 3 + 3) & ~3, size = 54 + row * h;
  const buf = new ArrayBuffer(size), v = new DataView(buf), u = new Uint8Array(buf);
  v.setUint16(0, 0x424d); v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u[o++] = d[i + 2]; u[o++] = d[i + 1]; u[o++] = d[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/** GIF из одного или нескольких кадров одинакового размера. */
async function encodeGIF(frames, { delay = 500, loop = 0 } = {}) {
  await loadLib('gifenc');
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const enc = GIFEncoder();
  for (const c of frames) {
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex(p => p[3] === 0);
    enc.writeFrame(index, c.width, c.height, { palette, delay, repeat: loop, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
  }
  enc.finish();
  return new Blob([enc.bytes()], { type: 'image/gif' });
}

async function encodeCanvas(canvas, mime, quality) {
  if (mime === 'image/bmp') return encodeBMP(canvas);
  if (mime === 'image/gif') return encodeGIF([canvas]);
  if (mime === 'image/tiff') {
    await loadLib('utif');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([UTIF.encodeImage(new Uint8Array(data.buffer), canvas.width, canvas.height)], { type: 'image/tiff' });
  }
  return canvasBlob(canvas, mime, quality);
}

/** Сохраняет canvas в нужном формате; имя файла получает расширение того формата, который реально выдал браузер. */
async function exportCanvas(canvas, mime, quality, srcName, suffix = '') {
  const blob = await encodeCanvas(canvas, mime, quality);
  return { blob, name: `${baseName(srcName)}${suffix}.${IMG_EXT[blob.type] || 'png'}` };
}

async function ensureFont(spec) {
  try { await document.fonts.load(spec); } catch { /* шрифт не обязателен */ }
}

/* ---------- Реестр инструментов ---------- */

const CATS = {
  pdf: { title: 'PDF', lead: 'Объединение, разделение, сжатие и конвертация PDF-файлов.' },
  image: { title: 'Изображения', lead: 'Сжатие, размер, обрезка, форматы и простые правки фото.' },
  text: { title: 'Текст', lead: 'Транслит, регистр, типограф, SEO-анализ и оформление текста.' },
  dev: { title: 'Кодирование и генераторы', short: 'Утилиты', lead: 'Base64, хеши, JSON, QR-коды, пароли и другие утилиты.' },
};
const TOOLS = [];
const tool = def => TOOLS.push(def);
/** Тот же инструмент под другим названием — отдельная страница для поиска. */
const aliasTool = (srcId, over) => tool({ ...TOOLS.find(t => t.id === srcId), ...over });

/** Ссылка на страницу инструмента: отдельная страница на сервере, «#id» — при открытии файла с диска. */
const USE_PAGES = typeof location !== 'undefined' && location.protocol !== 'file:' && !!(document.body && document.body.dataset.page);
const toolHref = id => USE_PAGES ? `${ROOT}${id}/` : `${ROOT}index.html#${id}`;
const catHref = cat => USE_PAGES ? `${ROOT}${cat}/` : `${ROOT}index.html#${cat}`;

/* ---------- Зона загрузки ---------- */

function acceptMatches(file, accept) {
  if (!accept) return true;
  return accept.split(',').map(s => s.trim().toLowerCase()).some(rule => {
    if (rule.startsWith('.')) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith('/*')) return file.type.startsWith(rule.slice(0, -1));
    return file.type === rule;
  });
}

function dropzone({ accept, multiple, hint, onFiles, label }) {
  const input = el('input', { type: 'file', accept, multiple, hidden: true, tabindex: -1 });
  const dz = el('div', { class: 'dropzone', tabindex: 0, role: 'button' },
    input,
    el('span', { class: 'dz-arrow', 'aria-hidden': 'true' }),
    el('strong', {}, label || (multiple ? 'Выберите файлы' : 'Выберите файл')),
    el('span', { class: 'dz-sub' }, multiple ? 'или перетащите их сюда' : 'или перетащите его сюда'),
    hint && el('small', {}, hint));
  const take = list => {
    const files = [...list];
    const ok = files.filter(f => acceptMatches(f, accept));
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
    else if (files.length) {
      dz.classList.add('bad');
      setTimeout(() => dz.classList.remove('bad'), 900);
    }
  };
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  dz.addEventListener('click', e => { if (e.target !== input) input.click(); });
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); take(e.dataTransfer.files); });
  dz.pick = () => input.click();
  return dz;
}

/* ---------- Поля настроек ---------- */

function buildForm(prefix, spec) {
  const wrap = el('div', { class: 'form' });
  const fields = {};
  for (const o of spec) {
    const id = `${prefix}-${o.id}`;
    let input, row;
    if (o.type === 'select') {
      input = el('select', { id }, o.choices.map(([v, l]) => el('option', { value: v }, l)));
      input.value = o.value ?? o.choices[0][0];
    } else if (o.type === 'checkbox') {
      input = el('input', { type: 'checkbox', id, checked: !!o.value });
    } else if (o.type === 'file') {
      input = el('input', { type: 'file', id, accept: o.accept });
    } else if (o.type === 'textarea') {
      input = el('textarea', { id, rows: o.rows || 3, placeholder: o.placeholder, value: o.value ?? '' });
    } else {
      input = el('input', { type: o.type || 'text', id, min: o.min, max: o.max, step: o.step, placeholder: o.placeholder, value: o.value ?? '' });
    }
    if (o.type === 'checkbox') {
      row = el('label', { class: 'field check' }, input, el('span', {}, o.label));
    } else if (o.type === 'range') {
      const out = el('output', { for: id });
      const sync = () => (out.textContent = input.value + (o.unit || ''));
      input.addEventListener('input', sync);
      sync();
      input.sync = sync;
      row = el('div', { class: 'field' }, el('label', { for: id }, el('span', {}, o.label), out), input);
    } else {
      row = el('div', { class: 'field' }, el('label', { for: id }, o.label), input);
    }
    if (o.hint) row.append(el('small', { class: 'hint' }, o.hint));
    fields[o.id] = { o, input, row };
    wrap.append(row);
  }
  const values = () => {
    const v = {};
    for (const [k, { o, input }] of Object.entries(fields)) {
      v[k] = o.type === 'checkbox' ? input.checked
        : o.type === 'file' ? (input.files[0] || null)
        : (o.type === 'number' || o.type === 'range') ? Number(input.value)
        : input.value;
    }
    return v;
  };
  const refresh = () => {
    const v = values();
    for (const { o, row } of Object.values(fields)) if (o.showIf) row.hidden = !o.showIf(v);
  };
  const set = (k, value) => {
    const f = fields[k];
    if (!f) return;
    if (f.o.type === 'checkbox') f.input.checked = !!value; else if (f.o.type !== 'file') f.input.value = value;
    if (f.input.sync) f.input.sync();
    refresh();
  };
  wrap.addEventListener('input', refresh);
  wrap.addEventListener('change', refresh);
  refresh();
  return { el: wrap, values, set, fields };
}

/* ---------- Результаты ---------- */

function uniqueNames(files) {
  const seen = {};
  return files.map(f => {
    let name = f.name;
    if (seen[name]) name = `${baseName(f.name)} (${seen[f.name]}).${extOf(f.name)}`;
    seen[f.name] = (seen[f.name] || 0) + 1;
    return { ...f, name };
  });
}

function renderResults(box, res) {
  box.replaceChildren();
  const files = uniqueNames(res.files || []);
  box.append(el('div', { class: 'results-head' },
    el('h2', {}, 'Готово'),
    res.message && el('p', {}, res.message)));

  if (res.text != null) {
    const ta = el('textarea', { class: 'out-text', readonly: true, rows: 12, 'aria-label': 'Результат' });
    ta.value = res.text;
    box.append(ta, el('div', { class: 'row' }, copyButton(() => ta.value, ta)));
  }

  if (!files.length) return;
  if (files.length > 1) {
    const zipBtn = el('button', { class: 'btn primary big', type: 'button' },
      `Скачать всё одним ZIP — ${files.length} ${plural(files.length, ['файл', 'файла', 'файлов'])}`);
    zipBtn.addEventListener('click', async () => {
      zipBtn.disabled = true;
      const label = zipBtn.textContent;
      zipBtn.textContent = 'Собираю архив…';
      try {
        await loadLib('jszip');
        const zip = new JSZip();
        files.forEach(f => zip.file(f.name, f.blob));
        download(await zip.generateAsync({ type: 'blob' }), res.zipName || 'verstak.zip');
      } finally {
        zipBtn.disabled = false;
        zipBtn.textContent = label;
      }
    });
    box.append(zipBtn);
  } else {
    box.append(el('button', { class: 'btn primary big', type: 'button', onclick: () => download(files[0].blob, files[0].name) },
      `Скачать ${files[0].name}`));
  }

  const list = el('ul', { class: 'file-list result-list' });
  for (const f of files) {
    list.append(el('li', { class: 'file' },
      thumbFor(f.blob, f.name),
      el('div', { class: 'file-meta' },
        el('span', { class: 'file-name' }, f.name),
        el('span', { class: 'file-size' }, fmtSize(f.blob.size), f.note && el('span', { class: 'file-note' }, ' · ' + f.note))),
      el('button', { class: 'btn small', type: 'button', onclick: () => download(f.blob, f.name) }, 'Скачать')));
  }
  box.append(list);
}

function thumbFor(blob, name) {
  if (blob.type && blob.type.startsWith('image/') && blob.size < 30 * 1024 * 1024) {
    const url = URL.createObjectURL(blob);
    const img = el('img', { class: 'thumb', src: url, alt: '', onload: () => URL.revokeObjectURL(url) });
    img.onerror = () => img.replaceWith(el('span', { class: 'thumb badge-ext' }, extOf(name || '').slice(0, 4) || 'img'));
    return img;
  }
  return el('span', { class: 'thumb badge-ext' }, (extOf(name || blob.name || '') || 'файл').slice(0, 4));
}

/* ---------- Типовой инструмент: файлы → настройки → результат ---------- */

/** perFile — обработка одного файла; обёртка сама прогоняет все файлы и собирает результат. */
function fileTool(cfg) {
  if (cfg.perFile) {
    cfg.multiple = true;
    cfg.run = async (files, o, ctx) => {
      const out = { files: [], messages: [], texts: [] };
      for (const [i, f] of files.entries()) {
        const many = files.length > 1;
        const progress = msg => ctx.progress(many ? `${f.name} (${i + 1} из ${files.length}): ${msg}` : msg);
        let r = await cfg.perFile(f, o, { progress });
        if (Array.isArray(r)) r = { files: r };
        out.files.push(...(r.files || []));
        if (r.message) out.messages.push(many ? `${f.name}: ${r.message}` : r.message);
        if (r.text != null) out.texts.push(many ? `=== ${f.name} ===\n${r.text}` : r.text);
      }
      return { files: out.files, message: out.messages.join(' '), text: out.texts.length ? out.texts.join('\n\n') : undefined, zipName: cfg.zipName };
    };
  }
  tool({ ...cfg, render: root => fileToolUI(root, cfg) });
}

function fileToolUI(root, cfg) {
  let files = [];
  const form = cfg.options ? buildForm(cfg.id, cfg.options) : null;
  const list = el('ul', { class: 'file-list' });
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'results' });
  const runBtn = el('button', { class: 'btn primary big', type: 'button', disabled: true }, cfg.action || 'Обработать');
  const dz = dropzone({ accept: cfg.accept, multiple: cfg.multiple, hint: cfg.hint, onFiles: add });
  const more = el('button', { class: 'btn ghost', type: 'button', onclick: () => dz.pick() },
    cfg.multiple ? '+ Добавить файлы' : 'Выбрать другой файл');
  const preview = el('div', { class: 'preview-box', hidden: !cfg.preview });
  const work = el('div', { class: 'workspace', hidden: true },
    el('div', { class: 'ws-files' }, preview, list, el('div', { class: 'row' }, more, cfg.multiple && cfg.sortable && el('small', { class: 'muted' }, 'Порядок в списке — порядок в результате'))),
    el('div', { class: 'ws-side' }, form && form.el, cfg.note && el('p', { class: 'hint' }, cfg.note), runBtn, status));
  root.append(dz, work, results);

  function add(newFiles) {
    files = cfg.multiple ? files.concat(newFiles) : newFiles.slice(0, 1);
    results.replaceChildren();
    status.replaceChildren();
    draw();
    refreshPreview();
    if (cfg.onLoad && files[0]) {
      Promise.all((cfg.libs || []).map(loadLib))
        .then(() => cfg.onLoad(files[0], form))
        .catch(e => setStatus(status, 'error', e.message));
    }
  }

  let previewTimer = 0, previewSeq = 0;
  function refreshPreview() {
    if (!cfg.preview) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const seq = ++previewSeq;
      if (!files[0]) return preview.replaceChildren();
      try {
        await Promise.all((cfg.libs || []).map(loadLib));
        const node = await cfg.preview(files[0], form ? form.values() : {});
        if (seq === previewSeq) preview.replaceChildren(el('span', { class: 'block-label' }, 'Предпросмотр — первый файл'), node);
      } catch (e) {
        if (seq === previewSeq) preview.replaceChildren(el('p', { class: 'hint' }, e.message));
      }
    }, 200);
  }
  if (form && cfg.preview) { form.el.addEventListener('input', refreshPreview); form.el.addEventListener('change', refreshPreview); }

  function move(i, d) {
    [files[i], files[i + d]] = [files[i + d], files[i]];
    draw();
  }

  function draw() {
    dz.hidden = files.length > 0;
    work.hidden = !files.length;
    runBtn.disabled = !files.length;
    list.replaceChildren(...files.map((f, i) => el('li', { class: 'file' },
      thumbFor(f, f.name),
      el('div', { class: 'file-meta' }, el('span', { class: 'file-name' }, f.name), el('span', { class: 'file-size' }, fmtSize(f.size))),
      el('div', { class: 'file-actions' },
        cfg.sortable && files.length > 1 && [
          el('button', { class: 'icon-btn', type: 'button', title: 'Выше', 'aria-label': 'Переместить выше', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          el('button', { class: 'icon-btn', type: 'button', title: 'Ниже', 'aria-label': 'Переместить ниже', disabled: i === files.length - 1, onclick: () => move(i, 1) }, '↓'),
        ],
        el('button', { class: 'icon-btn', type: 'button', title: 'Убрать', 'aria-label': `Убрать ${f.name}`, onclick: () => { files.splice(i, 1); results.replaceChildren(); draw(); refreshPreview(); } }, '×')))));
  }

  runBtn.addEventListener('click', async () => {
    if (cfg.minFiles && files.length < cfg.minFiles) {
      setStatus(status, 'error', `Добавьте хотя бы ${cfg.minFiles} ${plural(cfg.minFiles, ['файл', 'файла', 'файлов'])}.`);
      return;
    }
    runBtn.disabled = true;
    results.replaceChildren();
    const progress = msg => { setStatus(status, 'busy', msg); return tick(); };
    try {
      await progress('Подготовка…');
      await Promise.all((cfg.libs || []).map(loadLib));
      let res = await cfg.run(files.slice(), form ? form.values() : {}, { progress });
      if (Array.isArray(res)) res = { files: res };
      status.replaceChildren();
      renderResults(results, res);
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      setStatus(status, 'error', e.message || 'Не получилось обработать файл.');
    } finally {
      runBtn.disabled = !files.length;
    }
  });
}

/* ---------- Редактор одного изображения (обрезка, мем, фильтры) ---------- */

function singleImageTool(root, { onImage, label }) {
  const dz = dropzone({ accept: IMG_ACCEPT, label: label || 'Выберите изображение', hint: 'JPG, PNG, WEBP, GIF, HEIC, TIFF', onFiles: async f => {
    try {
      const img = await loadImage(f[0]);
      dz.hidden = true;
      alertBox.hidden = true;
      onImage(img, f[0], () => { dz.hidden = false; dz.pick(); });
    } catch (e) {
      alertBox.hidden = false;
      setStatus(alertBox, 'error', e.message);
    }
  } });
  const alertBox = el('div', { class: 'status', hidden: true });
  root.append(dz, alertBox);
  return dz;
}

/* ---------- Текстовый инструмент: поле ввода → живой результат ---------- */

/** Ввод слева, результат справа (или ниже), пересчёт на каждое изменение. */
function liveTextTool(root, { id, input: sample, options, compute, outLabel = 'Результат', inLabel = 'Текст', rows = 8, mono, extra }) {
  const inp = el('textarea', { id: `${id}-in`, class: 'text-in', rows, spellcheck: 'false', value: sample || '' });
  const out = el('textarea', { id: `${id}-out`, class: `text-out${mono ? ' mono' : ''}`, rows, readonly: true });
  const err = el('div', { class: 'status' });
  const form = options ? buildForm(id, options) : null;
  const update = async () => {
    try {
      err.replaceChildren();
      out.value = await compute(inp.value, form ? form.values() : {});
    } catch (e) {
      out.value = '';
      setStatus(err, 'error', e.message);
    }
  };
  inp.addEventListener('input', update);
  if (form) { form.el.addEventListener('input', update); form.el.addEventListener('change', update); }
  root.append(el('div', { class: 'text-tool' + (form ? '' : ' single') },
    el('div', { class: 'text-main' },
      el('label', { for: inp.id, class: 'block-label' }, inLabel), inp,
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => { inp.value = ''; update(); inp.focus(); } }, 'Очистить'),
        el('button', { class: 'btn ghost', type: 'button', onclick: () => { inp.value = out.value; update(); } }, '↑ Результат в поле ввода')),
      el('label', { for: out.id, class: 'block-label' }, outLabel), out, err,
      el('div', { class: 'row' }, copyButton(() => out.value, out),
        el('button', { class: 'btn', type: 'button', onclick: () => download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), `${id}.txt`) }, 'Скачать .txt')),
      extra && extra(inp, out, update)),
    form && el('div', { class: 'ws-side' }, form.el)));
  update();
  return { inp, out, form, update };
}
