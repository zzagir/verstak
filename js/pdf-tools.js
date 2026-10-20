'use strict';

const PDF_ACCEPT = '.pdf,application/pdf';
const PAGE_SIZES = { a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [419.53, 595.28], letter: [612, 792], legal: [612, 1008] };
const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });

async function openPdf(file) {
  const bytes = await file.arrayBuffer();
  try {
    return await PDFLib.PDFDocument.load(bytes);
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error(`«${file.name}» защищён паролем. Снимите защиту и попробуйте снова.`);
    throw new Error(`Не удалось открыть «${file.name}»: файл повреждён или это не PDF.`);
  }
}

/** pdf.js забирает буфер в воркер, поэтому передаём копию. */
async function openPdfJs(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(`«${file.name}» защищён паролем.`);
    throw new Error(`Не удалось прочитать «${file.name}»: файл повреждён или это не PDF.`);
  }
}

async function renderPdfPage(page, scale) {
  const vp = page.getViewport({ scale });
  const canvas = makeCanvas(vp.width, vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

async function newPdfWith(src, indices) {
  const out = await PDFLib.PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach(p => out.addPage(p));
  return out;
}

/** Текст любой письменности рисуем на canvas и вставляем картинкой — стандартные шрифты PDF не знают кириллицы. */
async function textPng(text, px, color) {
  const family = '"Golos Text", "Segoe UI", Arial, sans-serif';
  await ensureFont(`700 ${px}px "Golos Text"`);
  const probe = makeCanvas(1, 1).getContext('2d');
  probe.font = `700 ${px}px ${family}`;
  const c = makeCanvas(probe.measureText(text).width + px * 0.4, px * 1.4);
  const ctx = c.getContext('2d');
  ctx.font = `700 ${px}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px * 0.2, c.height / 2);
  const blob = await canvasBlob(c, 'image/png');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
}

/** Размер страницы так, как её видит читатель (с учётом /Rotate). */
function visualSize(page) {
  const { width, height } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { W: height, H: width, rot } : { W: width, H: height, rot };
}

/** Рисует картинку с центром в точке (vx, vy) видимой страницы под углом deg. */
function drawCentered(page, image, { vx, vy, w, h, deg = 0, opacity = 1 }) {
  const { width: W, height: H } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  let cx = vx, cy = vy;
  if (rot === 90) { cx = W - vy; cy = vx; }
  else if (rot === 180) { cx = W - vx; cy = H - vy; }
  else if (rot === 270) { cx = vy; cy = H - vx; }
  const angle = deg + rot;
  const t = angle * Math.PI / 180;
  const x = cx - (w / 2 * Math.cos(t) - h / 2 * Math.sin(t));
  const y = cy - (w / 2 * Math.sin(t) + h / 2 * Math.cos(t));
  page.drawImage(image, { x, y, width: w, height: h, rotate: PDFLib.degrees(angle), opacity });
}

const pagesField = { id: 'pages', label: 'Страницы', placeholder: 'все', hint: 'Пусто — все страницы. Например: 1-3, 5, 8-' };
const pickPages = (str, total) => str.trim() ? expandRanges(parseRanges(str, total)) : [...Array(total).keys()];

/* ===================== Инструменты ===================== */

fileTool({
  id: 'merge-pdf', cat: 'pdf', badge: '1+2', title: 'Объединить PDF',
  desc: 'Соедините несколько PDF в один файл в нужном порядке.',
  accept: PDF_ACCEPT, multiple: true, sortable: true, minFiles: 2, libs: ['pdflib'],
  action: 'Объединить',
  async run(files, o, { progress }) {
    const out = await PDFLib.PDFDocument.create();
    for (const [i, f] of files.entries()) {
      await progress(`Добавляю файл ${i + 1} из ${files.length}`);
      const src = await openPdf(f);
      (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
    }
    await progress('Сохраняю…');
    return { files: [{ blob: pdfBlob(await out.save()), name: 'merged.pdf' }], message: `Страниц в итоговом файле: ${out.getPageCount()}.` };
  },
});

fileTool({
  id: 'split-pdf', cat: 'pdf', badge: '1|2', title: 'Разделить PDF',
  desc: 'Разбейте документ на отдельные страницы или диапазоны.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Разделить',
  options: [
    { id: 'mode', label: 'Как разделить', type: 'select', choices: [['each', 'Каждая страница — отдельный файл'], ['ranges', 'По диапазонам'], ['every', 'Каждые N страниц']] },
    { id: 'ranges', label: 'Диапазоны', value: '1-2, 3-', hint: 'Каждый диапазон станет отдельным файлом', showIf: v => v.mode === 'ranges' },
    { id: 'n', label: 'Страниц в файле', type: 'number', min: 1, value: 2, showIf: v => v.mode === 'every' },
  ],
  async perFile(file, o, { progress }) {
    const src = await openPdf(file);
    const total = src.getPageCount();
    let groups;
    if (o.mode === 'each') groups = [...Array(total).keys()].map(i => [i]);
    else if (o.mode === 'ranges') groups = parseRanges(o.ranges, total).map(r => expandRanges([r]));
    else {
      const n = Math.max(1, Math.floor(o.n) || 1);
      groups = [];
      for (let i = 0; i < total; i += n) groups.push([...Array(Math.min(n, total - i)).keys()].map(k => i + k));
    }
    const base = baseName(file.name), out = [];
    for (const [i, g] of groups.entries()) {
      await progress(`Файл ${i + 1} из ${groups.length}`);
      const doc = await newPdfWith(src, g);
      const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
      out.push({ blob: pdfBlob(await doc.save()), name: `${base}_стр-${label}.pdf` });
    }
    return { files: out, zipName: `${base}_split.zip` };
  },
});

tool({
  id: 'organize-pdf', cat: 'pdf', badge: '3⇄1', title: 'Упорядочить страницы',
  desc: 'Перетаскивайте, поворачивайте и удаляйте страницы на миниатюрах.',
  render(root) {
    let file = null, pages = [], dragFrom = -1;
    const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const results = el('div', { class: 'results' });
    const grid = el('div', { class: 'page-grid' });
    const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Сохранить PDF');
    const bar = el('div', { class: 'toolbar', hidden: true },
      el('span', { class: 'muted' }, 'Перетащите миниатюру, чтобы изменить порядок.'),
      el('div', { class: 'row' }, el('button', { class: 'btn ghost', type: 'button', onclick: () => dz.pick() }, 'Другой файл'), saveBtn));
    const dz = dropzone({ accept: PDF_ACCEPT, onFiles: f => open(f[0]) });
    root.append(dz, bar, status, grid, results);

    async function open(f) {
      file = f;
      results.replaceChildren();
      grid.replaceChildren();
      try {
        setStatus(status, 'busy', 'Читаю PDF…');
        await Promise.all([loadLib('pdfjs'), loadLib('pdflib')]);
        const doc = await openPdfJs(f);
        pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          setStatus(status, 'busy', `Миниатюры: ${i} из ${doc.numPages}`);
          const page = await doc.getPage(i);
          const canvas = await renderPdfPage(page, 220 / page.getViewport({ scale: 1 }).width);
          pages.push({ index: i - 1, rot: 0, url: canvas.toDataURL('image/jpeg', 0.75) });
        }
        status.replaceChildren();
        dz.hidden = true;
        bar.hidden = false;
        draw();
      } catch (e) {
        setStatus(status, 'error', e.message);
      }
    }

    function move(from, to) {
      if (to < 0 || to >= pages.length || from === to) return;
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      draw();
    }

    function draw() {
      grid.replaceChildren(...pages.map((p, i) => {
        const card = el('figure', { class: 'page-card', draggable: 'true' },
          el('div', { class: 'page-img' }, el('img', { src: p.url, alt: `Страница ${p.index + 1}`, style: `transform: rotate(${p.rot}deg)` })),
          el('figcaption', {}, el('span', { class: 'page-no' }, String(i + 1)), el('span', { class: 'muted' }, `исх. ${p.index + 1}`)),
          el('div', { class: 'page-actions' },
            el('button', { class: 'icon-btn', type: 'button', title: 'Левее', 'aria-label': 'Переместить левее', onclick: () => move(i, i - 1) }, '←'),
            el('button', { class: 'icon-btn', type: 'button', title: 'Повернуть влево', 'aria-label': 'Повернуть влево', onclick: () => { p.rot = (p.rot + 270) % 360; draw(); } }, '↺'),
            el('button', { class: 'icon-btn', type: 'button', title: 'Повернуть вправо', 'aria-label': 'Повернуть вправо', onclick: () => { p.rot = (p.rot + 90) % 360; draw(); } }, '↻'),
            el('button', { class: 'icon-btn danger', type: 'button', title: 'Удалить', 'aria-label': 'Удалить страницу', onclick: () => { pages.splice(i, 1); draw(); } }, '×'),
            el('button', { class: 'icon-btn', type: 'button', title: 'Правее', 'aria-label': 'Переместить правее', onclick: () => move(i, i + 1) }, '→')));
        card.addEventListener('dragstart', e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drop-target'); });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', e => { e.preventDefault(); move(dragFrom, i); });
        return card;
      }));
      saveBtn.disabled = !pages.length;
    }

    saveBtn.addEventListener('click', async () => {
      try {
        setStatus(status, 'busy', 'Собираю документ…');
        const src = await openPdf(file);
        const out = await newPdfWith(src, pages.map(p => p.index));
        out.getPages().forEach((pg, i) => pg.setRotation(PDFLib.degrees((pg.getRotation().angle + pages[i].rot) % 360)));
        status.replaceChildren();
        renderResults(results, { files: [{ blob: pdfBlob(await out.save()), name: `${baseName(file.name)}_упорядочен.pdf` }] });
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        setStatus(status, 'error', e.message);
      }
    });
  },
});

fileTool({
  id: 'extract-pages', cat: 'pdf', badge: '1→', title: 'Извлечь страницы',
  desc: 'Сохраните выбранные страницы в новый PDF.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Извлечь',
  options: [{ id: 'ranges', label: 'Какие страницы', value: '1-2', hint: 'Например: 1, 3-5. Порядок сохранится как вы написали' }],
  async perFile(file, o) {
    const src = await openPdf(file);
    const doc = await newPdfWith(src, expandRanges(parseRanges(o.ranges, src.getPageCount())));
    return [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_извлечено.pdf` }];
  },
});

fileTool({
  id: 'delete-pages', cat: 'pdf', badge: '−1', title: 'Удалить страницы',
  desc: 'Уберите лишние страницы из документа.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Удалить страницы',
  options: [{ id: 'ranges', label: 'Какие страницы удалить', value: '1', hint: 'Например: 2, 5-7' }],
  async perFile(file, o) {
    const src = await openPdf(file);
    const total = src.getPageCount();
    const drop = new Set(expandRanges(parseRanges(o.ranges, total)));
    const keep = [...Array(total).keys()].filter(i => !drop.has(i));
    if (!keep.length) throw new Error('Нельзя удалить все страницы: в документе должна остаться хотя бы одна.');
    const doc = await newPdfWith(src, keep);
    return { files: [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_без-стр.pdf` }], message: `Удалено: ${drop.size}, осталось: ${keep.length}.` };
  },
});

fileTool({
  id: 'rotate-pdf', cat: 'pdf', badge: '90°', title: 'Повернуть PDF',
  desc: 'Поверните все или отдельные страницы на 90° или 180°.',
  accept: PDF_ACCEPT, multiple: true, libs: ['pdflib'], action: 'Повернуть',
  options: [
    { id: 'angle', label: 'Поворот', type: 'select', value: '90', choices: [['90', 'На 90° по часовой'], ['270', 'На 90° против часовой'], ['180', 'На 180°']] },
    pagesField,
  ],
  async run(files, o, { progress }) {
    const out = [];
    for (const f of files) {
      await progress(`Обрабатываю ${f.name}`);
      const doc = await openPdf(f);
      const all = doc.getPages();
      for (const i of pickPages(o.pages, all.length)) all[i].setRotation(PDFLib.degrees((all[i].getRotation().angle + Number(o.angle)) % 360));
      out.push({ blob: pdfBlob(await doc.save()), name: `${baseName(f.name)}_повёрнут.pdf` });
    }
    return out;
  },
});

fileTool({
  id: 'compress-pdf', cat: 'pdf', badge: 'МБ↓', title: 'Сжать PDF',
  desc: 'Уменьшите размер PDF для отправки по почте и загрузки на сайты.',
  accept: PDF_ACCEPT, libs: ['pdfjs', 'pdflib'], action: 'Сжать',
  note: 'Страницы пересобираются как изображения: размер падает сильно, но текст перестаёт выделяться. Подходит для сканов и документов на отправку.',
  options: [
    { id: 'level', label: 'Степень сжатия', type: 'select', value: 'medium', choices: [['high', 'Сильная — 72 dpi'], ['medium', 'Средняя — 110 dpi'], ['low', 'Слабая — 150 dpi, лучше качество'], ['target', 'До нужного размера файла']] },
    { id: 'target', label: 'Файл не больше', type: 'select', value: '1024', choices: SIZE_TARGETS, showIf: v => v.level === 'target',
      hint: 'Удобно для Госуслуг, вузов и анкет с ограничением размера. Точное требование смотрите на нужном сайте.' },
    { id: 'custom', label: 'Свой размер, КБ', type: 'number', min: 20, value: 1500, showIf: v => v.level === 'target' && v.target === 'custom' },
    { id: 'gray', label: 'Сделать чёрно-белым', type: 'checkbox' },
  ],
  async perFile(file, o, { progress }) {
    const src = await openPdfJs(file);
    const build = async (dpi, q, label) => {
      const out = await PDFLib.PDFDocument.create();
      for (let i = 1; i <= src.numPages; i++) {
        await progress(`${label}страница ${i} из ${src.numPages}`);
        const page = await src.getPage(i);
        const size = page.getViewport({ scale: 1 });
        let canvas = await renderPdfPage(page, dpi / 72);
        if (o.gray) {
          const g = makeCanvas(canvas.width, canvas.height), ctx = g.getContext('2d');
          ctx.filter = 'grayscale(1)';
          ctx.drawImage(canvas, 0, 0);
          canvas = g;
        }
        const jpg = await out.embedJpg(await (await canvasBlob(canvas, 'image/jpeg', q)).arrayBuffer());
        out.addPage([size.width, size.height]).drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height });
        page.cleanup();
      }
      return pdfBlob(await out.save());
    };
    let blob;
    if (o.level === 'target') {
      const limit = (o.target === 'custom' ? Math.max(20, o.custom) : Number(o.target)) * 1024;
      if (file.size <= limit) return { files: [], message: `«${file.name}» уже меньше ${fmtSize(limit)} — сжимать не нужно.` };
      const steps = [[150, 0.75], [130, 0.66], [110, 0.6], [96, 0.52], [84, 0.46], [72, 0.4], [60, 0.34], [50, 0.3], [40, 0.25]];
      let lo = 0, hi = steps.length - 1, fit = null, smallest = null, attempt = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const b = await build(...steps[mid], `Попытка ${++attempt}: `);
        if (!smallest || b.size < smallest.size) smallest = b;
        if (b.size <= limit) { fit = b; hi = mid - 1; } else lo = mid + 1;
      }
      blob = fit || smallest;
      if (!fit) {
        return { files: [{ blob, name: `${baseName(file.name)}_сжат.pdf` }], message: `Уложиться в ${fmtSize(limit)} не получилось: минимум для этого документа — ${fmtSize(blob.size)}. Попробуйте чёрно-белый режим или разделите PDF на части.` };
      }
    } else {
      const { dpi, q } = { high: { dpi: 72, q: 0.5 }, medium: { dpi: 110, q: 0.62 }, low: { dpi: 150, q: 0.78 } }[o.level];
      blob = await build(dpi, q, '');
    }
    const saved = Math.round((1 - blob.size / file.size) * 100);
    if (blob.size >= file.size) {
      return { files: [], message: `Этот файл уже хорошо сжат: после обработки он стал бы ${fmtSize(blob.size)} вместо ${fmtSize(file.size)}. Попробуйте сильную степень или оставьте исходный.` };
    }
    return { files: [{ blob, name: `${baseName(file.name)}_сжат.pdf`, note: `−${saved}%` }], message: `${fmtSize(file.size)} → ${fmtSize(blob.size)}, меньше на ${saved}%.` };
  },
});

fileTool({
  id: 'jpg-to-pdf', cat: 'pdf', badge: 'JPG', title: 'Изображения в PDF',
  desc: 'Соберите JPG, PNG и другие картинки в один PDF.',
  accept: IMG_ACCEPT, multiple: true, sortable: true, libs: ['pdflib'], action: 'Создать PDF', hint: 'JPG, PNG, WEBP, HEIC, многостраничные TIFF',
  options: [
    { id: 'size', label: 'Размер страницы', type: 'select', choices: [['fit', 'По размеру изображения'], ['a4', 'A4 (210 × 297 мм)'], ['letter', 'Letter (216 × 279 мм)']] },
    { id: 'orient', label: 'Ориентация', type: 'select', choices: [['auto', 'Автоматически'], ['portrait', 'Книжная'], ['landscape', 'Альбомная']], showIf: v => v.size !== 'fit' },
    { id: 'margin', label: 'Поля', type: 'select', value: '20', choices: [['0', 'Без полей'], ['20', 'Узкие — 7 мм'], ['40', 'Обычные — 14 мм']] },
  ],
  async run(files, o, { progress }) {
    const doc = await PDFLib.PDFDocument.create();
    const m = Number(o.margin);
    const sources = [];
    for (const f of files) {
      if (isTiff(f)) for (const c of await decodeTiff(f)) sources.push({ f, c });
      else sources.push({ f });
    }
    for (const [i, { f, c: tiffCanvas }] of sources.entries()) {
      await progress(`Изображение ${i + 1} из ${sources.length}`);
      const img = tiffCanvas || await loadImage(f);
      const iwPx = img.naturalWidth || img.width, ihPx = img.naturalHeight || img.height;
      const c = makeCanvas(iwPx, ihPx);
      const ctx = c.getContext('2d');
      const keepAlpha = f.type !== 'image/jpeg' && !tiffCanvas;
      if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      const bytes = await (await canvasBlob(c, keepAlpha ? 'image/png' : 'image/jpeg', 0.92)).arrayBuffer();
      const emb = keepAlpha ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const iw = iwPx * 0.75, ih = ihPx * 0.75;
      let pw, ph;
      if (o.size === 'fit') { pw = iw + 2 * m; ph = ih + 2 * m; }
      else {
        [pw, ph] = PAGE_SIZES[o.size];
        const land = o.orient === 'landscape' || (o.orient === 'auto' && iw > ih);
        if (land) [pw, ph] = [ph, pw];
      }
      const k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih, o.size === 'fit' ? 1 : Infinity);
      const w = iw * k, h = ih * k;
      doc.addPage([pw, ph]).drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      if (img.src) URL.revokeObjectURL(img.src);
    }
    return [{ blob: pdfBlob(await doc.save()), name: files.length === 1 ? `${baseName(files[0].name)}.pdf` : 'images.pdf' }];
  },
});

fileTool({
  id: 'pdf-to-jpg', cat: 'pdf', badge: '→JPG', title: 'PDF в JPG / PNG / TIFF',
  desc: 'Превратите каждую страницу PDF в картинку.',
  accept: PDF_ACCEPT, libs: ['pdfjs'], action: 'Конвертировать',
  options: [
    { id: 'format', label: 'Формат', type: 'select', choices: [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WEBP'], ['image/bmp', 'BMP'], ['image/tiff', 'TIFF']] },
    { id: 'dpi', label: 'Качество', type: 'select', value: '150', choices: [['72', 'Экран — 72 dpi'], ['150', 'Стандарт — 150 dpi'], ['300', 'Печать — 300 dpi']] },
    pagesField,
  ],
  async perFile(file, o, { progress }) {
    const doc = await openPdfJs(file);
    const idx = pickPages(o.pages, doc.numPages);
    const out = [];
    for (const [k, i] of idx.entries()) {
      await progress(`Страница ${k + 1} из ${idx.length}`);
      const page = await doc.getPage(i + 1);
      const canvas = await renderPdfPage(page, Number(o.dpi) / 72);
      out.push(await exportCanvas(canvas, o.format, 0.9, file.name, `_стр-${i + 1}`));
      page.cleanup();
    }
    return { files: out, zipName: `${baseName(file.name)}_images.zip` };
  },
});

async function pdfText(file, progress) {
  const doc = await openPdfJs(file);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    await progress(`Читаю страницу ${i} из ${doc.numPages}`);
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim());
  }
  if (!pages.some(Boolean)) throw new Error('В этом PDF нет текстового слоя — скорее всего, это скан. Текст из картинок здесь не распознаётся.');
  return pages;
}

fileTool({
  id: 'pdf-to-text', cat: 'pdf', badge: 'TXT', title: 'PDF в текст',
  desc: 'Достаньте весь текст из PDF, чтобы скопировать или сохранить.',
  accept: PDF_ACCEPT, libs: ['pdfjs'], action: 'Извлечь текст',
  async perFile(file, o, { progress }) {
    const text = (await pdfText(file, progress)).join('\n\n');
    return { text, files: [{ blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: `${baseName(file.name)}.txt` }] };
  },
});

const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

fileTool({
  id: 'pdf-to-word', cat: 'pdf', badge: 'DOC', title: 'PDF в Word',
  desc: 'Получите редактируемый документ Word с текстом из PDF.',
  accept: PDF_ACCEPT, libs: ['pdfjs'], action: 'Конвертировать в Word',
  note: 'Переносится текст с разбивкой на страницы. Картинки и сложная вёрстка не сохраняются.',
  async perFile(file, o, { progress }) {
    const pages = await pdfText(file, progress);
    const body = pages.map((p, i) =>
      (i ? '<br clear="all" style="page-break-before:always">' : '') +
      paragraphs(p).map(par => `<p>${escHtml(par)}</p>`).join('')).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escHtml(baseName(file.name))}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}p{margin:0 0 8pt}</style></head><body>${body}</body></html>`;
    return [{ blob: new Blob(['﻿', html], { type: 'application/msword' }), name: `${baseName(file.name)}.doc` }];
  },
});

async function htmlToPdf(node, name, { orientation = 'portrait' } = {}) {
  const holder = el('div', { class: 'render-holder' }, node);
  document.body.append(holder);
  try {
    return await html2pdf().set({
      margin: [15, 15, 15, 15],
      filename: name,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(node).outputPdf('blob');
  } finally {
    holder.remove();
  }
}

fileTool({
  id: 'word-to-pdf', cat: 'pdf', badge: '→PDF', title: 'Word в PDF',
  desc: 'Конвертируйте документ .docx в PDF формата A4.',
  accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  libs: ['mammoth', 'html2pdf'], action: 'Конвертировать в PDF',
  note: 'Поддерживается .docx. Текст, заголовки, списки, таблицы и картинки переносятся; точные шрифты и колонтитулы — нет.',
  async perFile(file, o, { progress }) {
    await progress('Читаю документ…');
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    await progress('Верстаю страницы…');
    const blob = await htmlToPdf(el('div', { class: 'doc-render', html: value }), file.name);
    return [{ blob, name: `${baseName(file.name)}.pdf` }];
  },
});

function decodeText(buf) {
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  return new TextDecoder('windows-1251').decode(buf);
}

fileTool({
  id: 'txt-to-pdf', cat: 'pdf', badge: 'T→P', title: 'Текст в PDF',
  desc: 'Сохраните .txt файл как аккуратный PDF.',
  accept: '.txt,text/plain', libs: ['html2pdf'], action: 'Создать PDF',
  options: [{ id: 'font', label: 'Шрифт', type: 'select', choices: [['sans', 'Без засечек'], ['serif', 'С засечками'], ['mono', 'Моноширинный']] }],
  async perFile(file, o, { progress }) {
    await progress('Верстаю страницы…');
    const node = el('div', { class: `doc-render txt ${o.font}` }, decodeText(await file.arrayBuffer()));
    return [{ blob: await htmlToPdf(node, file.name), name: `${baseName(file.name)}.pdf` }];
  },
});

fileTool({
  id: 'watermark-pdf', cat: 'pdf', badge: 'WM', title: 'Водяной знак в PDF',
  desc: 'Нанесите текстовый водяной знак на все страницы.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Добавить водяной знак',
  options: [
    { id: 'text', label: 'Текст', value: 'КОНФИДЕНЦИАЛЬНО' },
    { id: 'layout', label: 'Расположение', type: 'select', choices: [['center', 'Один раз по центру'], ['tile', 'Плиткой по всей странице']] },
    { id: 'size', label: 'Размер шрифта', type: 'range', min: 12, max: 120, value: 54, unit: ' pt' },
    { id: 'angle', label: 'Наклон', type: 'range', min: -90, max: 90, value: 45, unit: '°' },
    { id: 'opacity', label: 'Прозрачность', type: 'range', min: 5, max: 100, value: 25, unit: '%' },
    { id: 'color', label: 'Цвет', type: 'color', value: '#c62828' },
    pagesField,
  ],
  async perFile(file, o) {
    if (!o.text.trim()) throw new Error('Введите текст водяного знака.');
    const doc = await openPdf(file);
    const png = await textPng(o.text.trim(), o.size * 4, o.color);
    const img = await doc.embedPng(png.bytes);
    const w = png.w / 4, h = png.h / 4, opacity = o.opacity / 100;
    const all = doc.getPages();
    for (const i of pickPages(o.pages, all.length)) {
      const page = all[i];
      const { W, H } = visualSize(page);
      if (o.layout === 'center') drawCentered(page, img, { vx: W / 2, vy: H / 2, w, h, deg: o.angle, opacity });
      else {
        const stepX = w + o.size * 2, stepY = h + o.size * 2.5;
        for (let y = stepY / 2; y < H + stepY; y += stepY) {
          for (let x = (Math.round(y / stepY) % 2) * stepX / 2; x < W + stepX; x += stepX) {
            drawCentered(page, img, { vx: x, vy: y, w, h, deg: o.angle, opacity });
          }
        }
      }
    }
    return [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_водяной-знак.pdf` }];
  },
});

fileTool({
  id: 'page-numbers', cat: 'pdf', badge: '#', title: 'Нумерация страниц',
  desc: 'Проставьте номера страниц в нужном месте и формате.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Пронумеровать',
  options: [
    { id: 'pos', label: 'Положение', type: 'select', value: 'bc', choices: [['bc', 'Снизу по центру'], ['br', 'Снизу справа'], ['bl', 'Снизу слева'], ['tc', 'Сверху по центру'], ['tr', 'Сверху справа'], ['tl', 'Сверху слева']] },
    { id: 'format', label: 'Формат', type: 'select', choices: [['{n}', '1'], ['{n} / {t}', '1 / 10'], ['Страница {n}', 'Страница 1'], ['Страница {n} из {t}', 'Страница 1 из 10'], ['— {n} —', '— 1 —']] },
    { id: 'start', label: 'Начать с номера', type: 'number', min: 0, value: 1 },
    { id: 'skip', label: 'Не нумеровать первую страницу', type: 'checkbox' },
    { id: 'size', label: 'Размер', type: 'range', min: 6, max: 24, value: 10, unit: ' pt' },
    { id: 'color', label: 'Цвет', type: 'color', value: '#333333' },
  ],
  async perFile(file, o, { progress }) {
    const doc = await openPdf(file);
    const all = doc.getPages();
    const total = all.length;
    const margin = 28;
    for (const [i, page] of all.entries()) {
      if (o.skip && i === 0) continue;
      if (i % 10 === 0) await progress(`Страница ${i + 1} из ${total}`);
      const n = (o.skip ? i : i + 1) + (Number(o.start) - 1);
      const t = (o.skip ? total - 1 : total) + (Number(o.start) - 1);
      const png = await textPng(o.format.replace('{n}', n).replace('{t}', t), o.size * 4, o.color);
      const img = await doc.embedPng(png.bytes);
      const w = png.w / 4, h = png.h / 4;
      const { W, H } = visualSize(page);
      const vx = o.pos[1] === 'c' ? W / 2 : o.pos[1] === 'l' ? margin + w / 2 : W - margin - w / 2;
      const vy = o.pos[0] === 'b' ? margin * 0.8 + h / 2 : H - margin * 0.8 - h / 2;
      drawCentered(page, img, { vx, vy, w, h });
    }
    return [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_нумерация.pdf` }];
  },
});

fileTool({
  id: 'pdf-metadata', cat: 'pdf', badge: 'i', title: 'Свойства PDF',
  desc: 'Измените название, автора, тему и ключевые слова документа.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Сохранить свойства',
  options: [
    { id: 'title', label: 'Название' },
    { id: 'author', label: 'Автор' },
    { id: 'subject', label: 'Тема' },
    { id: 'keywords', label: 'Ключевые слова', hint: 'Через запятую' },
    { id: 'creator', label: 'Программа-создатель' },
  ],
  async onLoad(file, form) {
    const doc = await openPdf(file);
    form.set('title', doc.getTitle() || '');
    form.set('author', doc.getAuthor() || '');
    form.set('subject', doc.getSubject() || '');
    form.set('keywords', doc.getKeywords() || '');
    form.set('creator', doc.getCreator() || '');
  },
  async run([file], o) {
    const doc = await openPdf(file);
    doc.setTitle(o.title);
    doc.setAuthor(o.author);
    doc.setSubject(o.subject);
    doc.setKeywords(o.keywords.split(',').map(s => s.trim()).filter(Boolean));
    doc.setCreator(o.creator);
    doc.setModificationDate(new Date());
    return [{ blob: pdfBlob(await doc.save({ updateMetadata: false })), name: file.name }];
  },
});

/* ===================== Геометрия страниц ===================== */

const mm2pt = mm => mm * 72 / 25.4;

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

/** Видимая область страницы (CropBox) и её поворот. */
function pageGeom(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return { box, rot, W: rot % 180 ? box.height : box.width, H: rot % 180 ? box.width : box.height };
}

/** Точка видимой страницы (начало — левый нижний угол, как видит читатель) → координаты PDF. */
function visToBox({ box, rot }, vx, vy) {
  const W = box.width, H = box.height;
  let x = vx, y = vy;
  if (rot === 90) { x = W - vy; y = vx; }
  else if (rot === 180) { x = W - vx; y = H - vy; }
  else if (rot === 270) { x = vy; y = H - vx; }
  return { x: x + box.x, y: y + box.y };
}

function visRectToBox(g, x0, y0, x1, y1) {
  const a = visToBox(g, x0, y0), b = visToBox(g, x1, y1);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function drawTextVis(page, g, text, { vx, vy, font, size, color, opacity = 1 }) {
  const p = visToBox(g, vx, vy);
  page.drawText(text, { x: p.x, y: p.y, font, size, color, opacity, rotate: PDFLib.degrees(g.rot) });
}

/* ===================== Обрезка, размер, колонтитулы ===================== */

fileTool({
  id: 'crop-pdf', cat: 'pdf', badge: '⌗PDF', title: 'Обрезать PDF',
  desc: 'Уберите белые поля автоматически или задайте отступы в миллиметрах.',
  accept: PDF_ACCEPT, libs: ['pdflib', 'pdfjs'], action: 'Обрезать', zipName: 'cropped.zip',
  options: [
    { id: 'mode', label: 'Способ', type: 'select', choices: [['auto', 'Автоматически — по содержимому'], ['manual', 'Вручную — отступы в мм']] },
    { id: 'pad', label: 'Оставить поле вокруг содержимого, мм', type: 'number', min: 0, value: 5, showIf: v => v.mode === 'auto' },
    { id: 'top', label: 'Сверху, мм', type: 'number', min: 0, value: 15, showIf: v => v.mode === 'manual' },
    { id: 'bottom', label: 'Снизу, мм', type: 'number', min: 0, value: 15, showIf: v => v.mode === 'manual' },
    { id: 'left', label: 'Слева, мм', type: 'number', min: 0, value: 15, showIf: v => v.mode === 'manual' },
    { id: 'right', label: 'Справа, мм', type: 'number', min: 0, value: 15, showIf: v => v.mode === 'manual' },
    pagesField,
  ],
  async perFile(file, o, { progress }) {
    const doc = await openPdf(file);
    const all = doc.getPages();
    const view = o.mode === 'auto' ? await openPdfJs(file) : null;
    for (const i of pickPages(o.pages, all.length)) {
      const page = all[i], g = pageGeom(page);
      let x0, y0, x1, y1;
      if (o.mode === 'manual') {
        x0 = mm2pt(o.left); y0 = mm2pt(o.bottom); x1 = g.W - mm2pt(o.right); y1 = g.H - mm2pt(o.top);
      } else {
        await progress(`Ищу поля: страница ${i + 1}`);
        const pg = await view.getPage(i + 1);
        const c = await renderPdfPage(pg, 1);
        const sx = c.width / g.W, sy = c.height / g.H;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            const k = (y * c.width + x) * 4;
            if (d[k] < 235 || d[k + 1] < 235 || d[k + 2] < 235) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) continue; // пустая страница
        const pad = mm2pt(o.pad);
        x0 = Math.max(0, minX / sx - pad); x1 = Math.min(g.W, (maxX + 1) / sx + pad);
        y0 = Math.max(0, g.H - (maxY + 1) / sy - pad); y1 = Math.min(g.H, g.H - minY / sy + pad);
      }
      if (x1 - x0 < 10 || y1 - y0 < 10) throw new Error(`Слишком большие отступы для страницы ${i + 1}: от неё ничего не останется.`);
      const r = visRectToBox(g, x0, y0, x1, y1);
      page.setCropBox(r.x, r.y, r.width, r.height);
      page.setMediaBox(r.x, r.y, r.width, r.height);
    }
    return [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_обрезан.pdf` }];
  },
});

fileTool({
  id: 'resize-pdf', cat: 'pdf', badge: 'A4', title: 'Изменить размер страниц',
  desc: 'Приведите все страницы к A4, A3, A5, Letter или Legal.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Изменить размер', zipName: 'resized.zip',
  note: 'Содержимое масштабируется без искажений и выравнивается по центру. Ссылки и комментарии внутри PDF не переносятся.',
  options: [
    { id: 'size', label: 'Новый размер', type: 'select', value: 'a4', choices: [['a4', 'A4 — 210 × 297 мм'], ['a3', 'A3 — 297 × 420 мм'], ['a5', 'A5 — 148 × 210 мм'], ['letter', 'Letter — 216 × 279 мм'], ['legal', 'Legal — 216 × 356 мм']] },
    { id: 'orient', label: 'Ориентация', type: 'select', choices: [['auto', 'Как у исходной страницы'], ['portrait', 'Книжная'], ['landscape', 'Альбомная']] },
    { id: 'margin', label: 'Поля, мм', type: 'number', min: 0, value: 0 },
  ],
  async perFile(file, o, { progress }) {
    const src = await openPdf(file);
    const out = await PDFLib.PDFDocument.create();
    const pages = src.getPages();
    const embedded = await out.embedPages(pages, pages.map(p => {
      const b = p.getCropBox();
      return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height };
    }));
    const m = mm2pt(o.margin);
    for (const [i, p] of pages.entries()) {
      if (i % 10 === 0) await progress(`Страница ${i + 1} из ${pages.length}`);
      const g = pageGeom(p);
      let [VW, VH] = PAGE_SIZES[o.size];
      const land = o.orient === 'landscape' || (o.orient === 'auto' && g.W > g.H);
      if (land) [VW, VH] = [VH, VW];
      const [PW, PH] = g.rot % 180 ? [VH, VW] : [VW, VH];
      const page = out.addPage([PW, PH]);
      page.setRotation(PDFLib.degrees(g.rot));
      const k = Math.min((PW - 2 * m) / g.box.width, (PH - 2 * m) / g.box.height);
      page.drawPage(embedded[i], { x: (PW - g.box.width * k) / 2, y: (PH - g.box.height * k) / 2, xScale: k, yScale: k });
    }
    return [{ blob: pdfBlob(await out.save()), name: `${baseName(file.name)}_${o.size.toUpperCase()}.pdf` }];
  },
});

fileTool({
  id: 'header-footer', cat: 'pdf', badge: '▔▁', title: 'Колонтитулы PDF',
  desc: 'Добавьте верхний и нижний колонтитул: название, дату, номер страницы.',
  accept: PDF_ACCEPT, libs: ['pdflib'], action: 'Добавить колонтитулы', zipName: 'headers.zip',
  note: 'Подстановки: {n} — номер страницы, {t} — всего страниц, {date} — сегодняшняя дата, {file} — имя файла.',
  options: [
    { id: 'tl', label: 'Сверху слева', value: '{file}' },
    { id: 'tc', label: 'Сверху по центру', value: '' },
    { id: 'tr', label: 'Сверху справа', value: '{date}' },
    { id: 'bl', label: 'Снизу слева', value: '' },
    { id: 'bc', label: 'Снизу по центру', value: 'Страница {n} из {t}' },
    { id: 'br', label: 'Снизу справа', value: '' },
    { id: 'size', label: 'Размер шрифта', type: 'range', min: 6, max: 20, value: 9, unit: ' pt' },
    { id: 'margin', label: 'Отступ от края, мм', type: 'number', min: 2, value: 10 },
    { id: 'color', label: 'Цвет', type: 'color', value: '#444444' },
    { id: 'line', label: 'Тонкая линия под верхним и над нижним колонтитулом', type: 'checkbox' },
    { id: 'skip', label: 'Пропустить первую страницу', type: 'checkbox' },
  ],
  async perFile(file, o) {
    const doc = await openPdf(file);
    const font = await embedCyrFont(doc);
    const color = hexRgb(o.color);
    const pages = doc.getPages(), total = pages.length;
    const date = new Date().toLocaleDateString('ru-RU');
    const m = mm2pt(o.margin);
    pages.forEach((page, i) => {
      if (o.skip && i === 0) return;
      const g = pageGeom(page);
      for (const slot of ['tl', 'tc', 'tr', 'bl', 'bc', 'br']) {
        const text = o[slot].replace(/\{n\}/g, i + 1).replace(/\{t\}/g, total).replace(/\{date\}/g, date).replace(/\{file\}/g, baseName(file.name)).trim();
        if (!text) continue;
        const w = font.widthOfTextAtSize(text, o.size);
        const vx = slot[1] === 'l' ? m : slot[1] === 'c' ? (g.W - w) / 2 : g.W - m - w;
        const vy = slot[0] === 't' ? g.H - m - o.size * 0.75 : m;
        drawTextVis(page, g, text, { vx, vy, font, size: o.size, color });
      }
      if (o.line) {
        for (const vy of [g.H - m - o.size * 1.1, m + o.size * 1.25]) {
          const a = visToBox(g, m, vy), b = visToBox(g, g.W - m, vy);
          page.drawLine({ start: a, end: b, thickness: 0.5, color });
        }
      }
    });
    return [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_колонтитулы.pdf` }];
  },
});

/* ===================== Извлечь картинки ===================== */

function pdfImageToCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  const id = ctx.createImageData(img.width, img.height), out = id.data, src = img.data;
  const n = img.width * img.height;
  if (img.kind === 3) out.set(src.subarray(0, n * 4));
  else if (img.kind === 2) for (let i = 0, j = 0; i < n; i++, j += 3) { out[i * 4] = src[j]; out[i * 4 + 1] = src[j + 1]; out[i * 4 + 2] = src[j + 2]; out[i * 4 + 3] = 255; }
  else {
    const rowBytes = (img.width + 7) >> 3;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const v = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, k = (y * img.width + x) * 4;
      out[k] = out[k + 1] = out[k + 2] = v; out[k + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

fileTool({
  id: 'extract-images', cat: 'pdf', badge: 'IMG', title: 'Извлечь картинки из PDF',
  desc: 'Сохраните все фотографии и иллюстрации из документа отдельными файлами.',
  accept: PDF_ACCEPT, libs: ['pdfjs'], action: 'Извлечь картинки', zipName: 'images.zip',
  options: [
    { id: 'format', label: 'Сохранить как', type: 'select', choices: [['image/png', 'PNG — без потерь'], ['image/jpeg', 'JPG — меньше размер']] },
    { id: 'min', label: 'Пропускать картинки меньше, px', type: 'number', min: 0, value: 40, hint: 'Чтобы не сохранять мелкие значки и линии' },
  ],
  async perFile(file, o, { progress }) {
    const doc = await openPdfJs(file);
    const OPS = pdfjsLib.OPS;
    const kinds = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat];
    const out = [], seen = new Set();
    for (let p = 1; p <= doc.numPages; p++) {
      await progress(`Страница ${p} из ${doc.numPages}, найдено ${out.length}`);
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();
      for (let k = 0; k < ops.fnArray.length; k++) {
        if (!kinds.includes(ops.fnArray[k])) continue;
        let img = ops.argsArray[k][0];
        if (typeof img === 'string') {
          if (seen.has(img)) continue;
          seen.add(img);
          const store = img.startsWith('g_') ? page.commonObjs : page.objs;
          img = await new Promise(res => store.get(img, res));
        }
        if (!img || img.width < o.min || img.height < o.min) continue;
        const c = pdfImageToCanvas(img);
        if (o.format === 'image/jpeg') {
          const w = makeCanvas(c.width, c.height), ctx = w.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w.width, w.height); ctx.drawImage(c, 0, 0);
          out.push(await exportCanvas(w, o.format, 0.92, file.name, `_стр${p}_${out.length + 1}`));
        } else out.push(await exportCanvas(c, o.format, 1, file.name, `_стр${p}_${out.length + 1}`));
      }
    }
    if (!out.length) return { files: [], message: `В «${file.name}» не нашлось картинок крупнее ${o.min} px.` };
    return { files: out, message: `Найдено картинок: ${out.length}.` };
  },
});

/* ===================== Экспорт текста PDF в другие форматы ===================== */

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Склеивает строки PDF в абзацы: перенос строки внутри предложения убирается. */
function paragraphs(pageText) {
  const out = [];
  for (const raw of pageText.split('\n')) {
    const line = raw.trim();
    if (!line) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    const prev = out[out.length - 1];
    if (prev && !/[.!?:;»")\]…]$/.test(prev) && /^[\p{Ll}\d(«"]/u.test(line)) {
      out[out.length - 1] = prev.endsWith('-') ? prev.slice(0, -1) + line : `${prev} ${line}`;
    } else out.push(line);
  }
  return out.filter(Boolean);
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | (c === 'x' ? 0 : 8) & (c === 'x' ? 15 : 3)).toString(16)));

const TEXT_EXPORTS = {
  rtf(pages) {
    const esc = s => s.replace(/[\\{}]/g, '\\$&').replace(/[^\x00-\x7f]/g, c => { const n = c.charCodeAt(0); return `\\u${n > 32767 ? n - 65536 : n}?`; });
    const body = pages.map(p => paragraphs(p).map(x => `{\\pard\\sa160 ${esc(x)}\\par}`).join('\n')).join('\n\\page\n');
    return new Blob([`{\\rtf1\\ansi\\ansicpg1251\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Arial;}}\\f0\\fs22\n${body}\n}`], { type: 'application/rtf' });
  },
  async odt(pages) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    zip.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
    const body = pages.map((p, i) => paragraphs(p).map((x, j) => `<text:p${i && !j ? ' text:style-name="PB"' : ''}>${xmlEsc(x)}</text:p>`).join('') || (i ? '<text:p text:style-name="PB"/>' : '')).join('');
    zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles><style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style></office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text' });
  },
  async epub(pages, title) {
    const zip = new JSZip();
    const id = uuid();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    const chapters = pages.map((p, i) => ({ file: `p${i + 1}.xhtml`, title: `Страница ${i + 1}`, html: paragraphs(p).map(x => `<p>${xmlEsc(x)}</p>`).join('\n') }));
    for (const c of chapters) {
      zip.file(`OEBPS/${c.file}`, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru"><head><title>${xmlEsc(c.title)}</title></head><body><h2>${xmlEsc(c.title)}</h2>${c.html}</body></html>`);
    }
    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><ol>${chapters.map(c => `<li><a href="${c.file}">${xmlEsc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`);
    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${id}"/></head><docTitle><text>${xmlEsc(title)}</text></docTitle><navMap>${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${xmlEsc(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('')}</navMap></ncx>`);
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${id}</dc:identifier><dc:title>${xmlEsc(title)}</dc:title><dc:language>ru</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx">${chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  },
  fb2(pages, title) {
    const sections = pages.map((p, i) => `<section><title><p>Страница ${i + 1}</p></title>${paragraphs(p).map(x => `<p>${xmlEsc(x)}</p>`).join('') || '<empty-line/>'}</section>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>nonfiction</genre><author><nickname>Неизвестный автор</nickname></author><book-title>${xmlEsc(title)}</book-title><lang>ru</lang></title-info><document-info><author><nickname>Верстак</nickname></author><program-used>Верстак</program-used><date>${new Date().toISOString().slice(0, 10)}</date><id>${uuid()}</id><version>1.0</version></document-info></description><body>${sections}</body></FictionBook>`;
    return new Blob([xml], { type: 'application/x-fictionbook+xml' });
  },
  html(pages, title) {
    const body = pages.map((p, i) => `<section id="page-${i + 1}"><h2>Страница ${i + 1}</h2>${paragraphs(p).map(x => `<p>${xmlEsc(x)}</p>`).join('\n')}</section>`).join('\n');
    return new Blob([`<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xmlEsc(title)}</title><style>body{font:17px/1.6 Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem}section{border-bottom:1px solid #ddd;padding-bottom:1rem}h2{font:600 .9rem system-ui;color:#888}</style></head><body><h1>${xmlEsc(title)}</h1>\n${body}\n</body></html>`], { type: 'text/html' });
  },
};

for (const [id, badge, title, ext, desc] of [
  ['pdf-to-rtf', 'RTF', 'PDF в RTF', 'rtf', 'Текст из PDF в формате RTF — откроется в Word, WordPad, LibreOffice.'],
  ['pdf-to-odt', 'ODT', 'PDF в ODT', 'odt', 'Документ OpenDocument для LibreOffice и OpenOffice.'],
  ['pdf-to-epub', 'EPUB', 'PDF в EPUB', 'epub', 'Электронная книга для читалок, iPhone и Android.'],
  ['pdf-to-fb2', 'FB2', 'PDF в FB2', 'fb2', 'Книга FictionBook для популярных читалок.'],
]) {
  fileTool({
    id, cat: 'pdf', badge, title, desc, accept: PDF_ACCEPT, libs: ['pdfjs', 'jszip'], action: 'Конвертировать', zipName: `${ext}.zip`,
    note: 'Переносится текст с разбивкой на абзацы и страницы. Картинки и вёрстка не сохраняются.',
    async perFile(file, o, { progress }) {
      const pages = await pdfText(file, progress);
      return [{ blob: await TEXT_EXPORTS[ext](pages, baseName(file.name)), name: `${baseName(file.name)}.${ext}` }];
    },
  });
}

fileTool({
  id: 'pdf-to-html', cat: 'pdf', badge: 'HTML', title: 'PDF в HTML',
  desc: 'Веб-страница с текстом документа или с изображениями его страниц.',
  accept: PDF_ACCEPT, libs: ['pdfjs'], action: 'Конвертировать', zipName: 'html.zip',
  options: [{ id: 'mode', label: 'Что сохранить', type: 'select', choices: [['text', 'Текст — его можно копировать и индексировать'], ['images', 'Страницы картинками — точная копия вида']] }],
  async perFile(file, o, { progress }) {
    const title = baseName(file.name);
    if (o.mode === 'text') return [{ blob: TEXT_EXPORTS.html(await pdfText(file, progress), title), name: `${title}.html` }];
    const doc = await openPdfJs(file), imgs = [];
    for (let i = 1; i <= doc.numPages; i++) {
      await progress(`Страница ${i} из ${doc.numPages}`);
      imgs.push(`<img src="${(await renderPdfPage(await doc.getPage(i), 1.5)).toDataURL('image/jpeg', 0.8)}" alt="Страница ${i}">`);
    }
    const html = `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xmlEsc(title)}</title><style>body{background:#eee;margin:0;padding:1rem;display:grid;gap:1rem;justify-items:center}img{max-width:100%;box-shadow:0 1px 4px #0003;background:#fff}</style></head><body>${imgs.join('\n')}</body></html>`;
    return [{ blob: new Blob([html], { type: 'text/html' }), name: `${title}.html` }];
  },
});

/* ===================== HTML, EPUB, FB2 → PDF ===================== */

const BOOK_NOTE = 'Книга верстается в A4. Очень большие книги (сотни страниц) могут обрабатываться несколько минут и потребовать много памяти.';

fileTool({
  id: 'html-to-pdf', cat: 'pdf', badge: 'H→P', title: 'HTML в PDF',
  desc: 'Сохраните HTML-файл как PDF формата A4.',
  accept: '.html,.htm,text/html', libs: ['html2pdf'], action: 'Создать PDF', zipName: 'html-pdf.zip',
  note: 'Загрузите сохранённую страницу .html. Внешние стили и картинки по ссылкам могут не подтянуться — встроенные (inline) сохраняются.',
  async perFile(file, o, { progress }) {
    await progress('Верстаю страницы…');
    const d = new DOMParser().parseFromString(decodeText(await file.arrayBuffer()), 'text/html');
    d.querySelectorAll('script, iframe, object, embed, link').forEach(n => n.remove());
    const styles = [...d.querySelectorAll('style')].map(s => s.textContent.replace(/(^|[},])\s*(html|body)\b/g, '$1 .html-render')).join('\n');
    d.querySelectorAll('style').forEach(n => n.remove());
    const node = el('div', { class: 'doc-render html-render', html: `<style>${styles}</style>${d.body.innerHTML}` });
    return [{ blob: await htmlToPdf(node, file.name), name: `${baseName(file.name)}.pdf` }];
  },
});

async function zipDataUrl(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  const ext = extOf(path);
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext] || 'application/octet-stream';
  return `data:${mime};base64,${await f.async('base64')}`;
}
const zipResolve = (base, rel) => decodeURIComponent(new URL(rel, 'http://x/' + base).pathname.slice(1));

/** EPUB → { node, title }: главы книги одним HTML-блоком с картинками. */
async function epubNode(file, progress = () => tick()) {
    await progress('Распаковываю книгу…');
    const zip = await JSZip.loadAsync(file);
    const container = await zip.file('META-INF/container.xml')?.async('text');
    const opfPath = container && container.match(/full-path="([^"]+)"/)?.[1];
    if (!opfPath) throw new Error(`«${file.name}» не похож на книгу EPUB.`);
    const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('text'), 'application/xml');
    const manifest = {};
    opf.querySelectorAll('manifest > item').forEach(i => (manifest[i.getAttribute('id')] = i.getAttribute('href')));
    const spine = [...opf.querySelectorAll('spine > itemref')].map(r => manifest[r.getAttribute('idref')]).filter(Boolean);
    const node = el('div', { class: 'doc-render book' });
    const title = opf.querySelector('metadata title')?.textContent || baseName(file.name);
    node.append(el('h1', { class: 'book-title' }, title));
    for (const [i, href] of spine.entries()) {
      await progress(`Глава ${i + 1} из ${spine.length}`);
      const path = zipResolve(opfPath, href);
      const src = await zip.file(path)?.async('text');
      if (!src) continue;
      let d = new DOMParser().parseFromString(src, 'application/xhtml+xml');
      if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(src, 'text/html');
      const body = d.getElementsByTagName('body')[0];
      if (!body) continue;
      for (const img of body.querySelectorAll('img, image')) {
        const attr = img.hasAttribute('src') ? 'src' : img.hasAttribute('href') ? 'href' : 'xlink:href';
        const ref = img.getAttribute(attr) || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (!ref || ref.startsWith('data:')) continue;
        const data = await zipDataUrl(zip, zipResolve(path, ref));
        if (data) { img.setAttribute(attr, data); if (attr !== 'src' && img.localName === 'image') img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', data); }
      }
      body.querySelectorAll('script, style, link').forEach(n => n.remove());
      const chapter = el('div', { class: 'chapter' });
      chapter.innerHTML = [...body.childNodes].map(n => n.outerHTML ?? (n.nodeType === 3 ? xmlEsc(n.textContent) : '')).join('');
      node.append(chapter);
    }
    return { node, title };
}

fileTool({
  id: 'epub-to-pdf', cat: 'pdf', badge: 'E→P', title: 'EPUB в PDF',
  desc: 'Превратите электронную книгу EPUB в PDF для печати и чтения на компьютере.',
  accept: '.epub,application/epub+zip', libs: ['jszip', 'html2pdf'], action: 'Создать PDF', note: BOOK_NOTE, zipName: 'books.zip',
  async perFile(file, o, { progress }) {
    const { node } = await epubNode(file, progress);
    await progress('Верстаю страницы…');
    return [{ blob: await htmlToPdf(node, file.name), name: `${baseName(file.name)}.pdf` }];
  },
});

function fb2Html(node, bin) {
  let html = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { html += xmlEsc(n.textContent); continue; }
    if (n.nodeType !== 1) continue;
    const inner = () => fb2Html(n, bin);
    switch (n.localName) {
      case 'section': html += `<div class="chapter">${inner()}</div>`; break;
      case 'title': html += `<h2>${[...n.children].map(p => fb2Html(p, bin)).join('<br>')}</h2>`; break;
      case 'subtitle': html += `<h3>${inner()}</h3>`; break;
      case 'p': case 'v': html += `<p>${inner()}</p>`; break;
      case 'emphasis': html += `<em>${inner()}</em>`; break;
      case 'strong': html += `<strong>${inner()}</strong>`; break;
      case 'strikethrough': html += `<s>${inner()}</s>`; break;
      case 'sup': case 'sub': html += `<${n.localName}>${inner()}</${n.localName}>`; break;
      case 'empty-line': html += '<br>'; break;
      case 'epigraph': case 'cite': html += `<blockquote>${inner()}</blockquote>`; break;
      case 'poem': case 'stanza': html += `<div class="poem">${inner()}</div>`; break;
      case 'text-author': html += `<p class="author">${inner()}</p>`; break;
      case 'image': {
        const ref = (n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || n.getAttribute('l:href') || n.getAttribute('href') || '').replace(/^#/, '');
        if (bin[ref]) html += `<p class="img"><img src="${bin[ref]}" alt=""></p>`;
        break;
      }
      case 'table': case 'tr': case 'td': case 'th': html += `<${n.localName}>${inner()}</${n.localName}>`; break;
      case 'binary': break;
      default: html += inner();
    }
  }
  return html;
}

/** FB2 или FB2.ZIP → { node, title }. */
async function fb2Node(file, progress = () => tick()) {
    await progress('Читаю книгу…');
    let buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const zip = await JSZip.loadAsync(buf);
      const inner = Object.values(zip.files).find(f => /\.fb2$/i.test(f.name));
      if (!inner) throw new Error(`В архиве «${file.name}» нет файла .fb2.`);
      buf = await inner.async('uint8array');
    }
    const head = new TextDecoder('ascii').decode(buf.slice(0, 200));
    const enc = (head.match(/encoding=["']([\w-]+)["']/i) || [, 'utf-8'])[1];
    let xml;
    try { xml = new TextDecoder(enc).decode(buf); } catch { xml = new TextDecoder('utf-8').decode(buf); }
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    if (d.querySelector('parsererror')) throw new Error(`«${file.name}» повреждён или это не FB2.`);
    const bin = {};
    for (const b of d.getElementsByTagName('binary')) bin[b.getAttribute('id')] = `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`;
    const ti = d.getElementsByTagName('title-info')[0];
    const title = ti?.getElementsByTagName('book-title')[0]?.textContent || baseName(file.name);
    const author = [...(ti?.getElementsByTagName('author')[0]?.children || [])].filter(c => /name/.test(c.localName)).map(c => c.textContent).join(' ');
    const node = el('div', { class: 'doc-render book' });
    node.innerHTML = `<h1 class="book-title">${xmlEsc(title)}</h1>${author ? `<p class="author">${xmlEsc(author)}</p>` : ''}` +
      [...d.getElementsByTagName('body')].map(b => fb2Html(b, bin)).join('');
    return { node, title };
}

fileTool({
  id: 'fb2-to-pdf', cat: 'pdf', badge: 'F→P', title: 'FB2 в PDF',
  desc: 'Сконвертируйте книгу FictionBook (.fb2 и .fb2.zip) в PDF.',
  accept: '.fb2,.zip', libs: ['jszip', 'html2pdf'], action: 'Создать PDF', note: BOOK_NOTE, zipName: 'books.zip',
  async perFile(file, o, { progress }) {
    const { node } = await fb2Node(file, progress);
    await progress('Верстаю страницы…');
    return [{ blob: await htmlToPdf(node, file.name), name: `${baseName(file.name.replace(/\.zip$/i, ''))}.pdf` }];
  },
});

aliasTool('jpg-to-pdf', { id: 'tiff-to-pdf', badge: 'TIFF', title: 'TIFF в PDF', desc: 'Соберите многостраничный TIFF или несколько сканов в PDF.' });
