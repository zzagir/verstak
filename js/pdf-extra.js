'use strict';

/* ===================== Распознавание текста (OCR) ===================== */

const ocrWorkers = {};
function ocrWorker(langs, onLog) {
  if (!ocrWorkers[langs]) {
    ocrWorkers[langs] = (async () => {
      await loadLib('tesseract');
      const base = new URL(ROOT + 'vendor/tess/', location.href).href;
      return Tesseract.createWorker(langs.split('+'), 1, {
        workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: true, workerBlobURL: false,
        logger: m => ocrWorkers.log && ocrWorkers.log(m),
      });
    })();
    ocrWorkers[langs].catch(() => delete ocrWorkers[langs]);
  }
  ocrWorkers.log = onLog;
  return ocrWorkers[langs];
}

fileTool({
  id: 'ocr', cat: 'pdf', badge: 'OCR', title: 'Распознать текст (OCR)',
  desc: 'Достаньте текст из скана, фото документа или PDF без текстового слоя.',
  accept: PDF_ACCEPT + ',' + IMG_ACCEPT, libs: ['pdfjs', 'pdflib'], action: 'Распознать', zipName: 'ocr.zip',
  hint: 'PDF-сканы, JPG, PNG, TIFF, HEIC',
  note: 'Распознавание идёт на вашем компьютере: первая страница — около минуты (загружаются словари, ~6 МБ), дальше быстрее.',
  options: [
    { id: 'langs', label: 'Языки документа', type: 'select', choices: [['rus+eng', 'Русский и английский'], ['rus', 'Только русский'], ['eng', 'Только английский']] },
    { id: 'out', label: 'Результат', type: 'select', choices: [['text', 'Текст'], ['pdf', 'PDF с текстовым слоем (можно искать и копировать)'], ['both', 'Текст и PDF']] },
    { id: 'dpi', label: 'Качество для PDF-сканов', type: 'select', value: '200', choices: [['150', 'Быстро — 150 dpi'], ['200', 'Стандарт — 200 dpi'], ['300', 'Мелкий текст — 300 dpi']] },
  ],
  async perFile(file, o, { progress }) {
    let stage = 'Загружаю словари…';
    await progress(stage);
    const worker = await ocrWorker(o.langs, m => {
      if (m.status === 'recognizing text') progress(`${stage} ${Math.round(m.progress * 100)}%`);
    });
    const images = [];
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const doc = await openPdfJs(file);
      for (let i = 1; i <= doc.numPages; i++) images.push(async () => renderPdfPage(await doc.getPage(i), Number(o.dpi) / 72));
    } else if (isTiff(file)) (await decodeTiff(file)).forEach(c => images.push(async () => c));
    else images.push(async () => { const img = await loadImage(file); return drawImageCanvas(img, img.naturalWidth, img.naturalHeight, { fill: '#fff' }); });

    const texts = [];
    const merged = o.out !== 'text' ? await PDFLib.PDFDocument.create() : null;
    for (const [i, get] of images.entries()) {
      stage = images.length > 1 ? `Страница ${i + 1} из ${images.length}:` : 'Распознаю:';
      await progress(stage);
      const { data } = await worker.recognize(await get(), {}, { text: true, pdf: !!merged });
      texts.push(data.text.trim());
      if (merged) {
        const part = await PDFLib.PDFDocument.load(new Uint8Array(data.pdf));
        (await merged.copyPages(part, part.getPageIndices())).forEach(p => merged.addPage(p));
      }
    }
    const text = texts.join('\n\n');
    const files = [];
    if (o.out !== 'pdf') files.push({ blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: `${baseName(file.name)}_ocr.txt` });
    if (merged) files.push({ blob: pdfBlob(await merged.save()), name: `${baseName(file.name)}_ocr.pdf` });
    return { text: o.out !== 'pdf' ? text : undefined, files, message: text ? '' : 'Текст не найден. Попробуйте качество 300 dpi или другой язык.' };
  },
});

/* ===================== Редактор PDF и подпись ===================== */

function drawImageVis(page, g, image, { x0, y0, x1, y1, opacity = 1 }) {
  const w = x1 - x0, h = y1 - y0;
  const c = visToBox(g, (x0 + x1) / 2, (y0 + y1) / 2);
  const t = g.rot * Math.PI / 180;
  page.drawImage(image, {
    x: c.x - (w / 2 * Math.cos(t) - h / 2 * Math.sin(t)),
    y: c.y - (w / 2 * Math.sin(t) + h / 2 * Math.cos(t)),
    width: w, height: h, rotate: PDFLib.degrees(g.rot), opacity,
  });
}

/** Обрезает прозрачные края у подписи. */
function trimCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const out = makeCanvas(x1 - x0 + 9, y1 - y0 + 9);
  out.getContext('2d').drawImage(c, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function signatureDialog(onDone) {
  const pad = makeCanvas(900, 300);
  pad.className = 'sig-pad';
  const pctx = pad.getContext('2d');
  let drawing = false, last = null;
  const color = el('input', { type: 'color', id: 'sig-color', value: '#1a2a8a' });
  const pos = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
  pad.addEventListener('pointerdown', e => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    pctx.strokeStyle = color.value; pctx.lineWidth = 5; pctx.lineCap = pctx.lineJoin = 'round';
    pctx.beginPath(); pctx.moveTo(last.x, last.y); pctx.lineTo(p.x, p.y); pctx.stroke();
    last = p;
  });
  pad.addEventListener('pointerup', () => (drawing = false));

  const typed = el('input', { type: 'text', id: 'sig-name', value: 'Иванов И. И.', placeholder: 'Ваше имя' });
  const fontSel = el('select', { id: 'sig-font' }, [['Caveat', 'Рукописный'], ['Marck Script', 'Каллиграфия'], ['Golos Text', 'Печатный']].map(([v, l]) => el('option', { value: v }, l)));
  const upload = el('input', { type: 'file', id: 'sig-file', accept: 'image/*' });
  const knock = el('input', { type: 'checkbox', id: 'sig-knock', checked: true });

  const tabs = { draw: 'Нарисовать', type: 'Напечатать', upload: 'Загрузить фото' };
  let tab = 'draw';
  const panes = {
    draw: el('div', { class: 'sig-pane' }, pad, el('div', { class: 'row' }, el('label', { for: 'sig-color' }, 'Цвет'), color, el('button', { class: 'btn ghost', type: 'button', onclick: () => pctx.clearRect(0, 0, pad.width, pad.height) }, 'Стереть'))),
    type: el('div', { class: 'sig-pane' }, el('div', { class: 'field' }, el('label', { for: 'sig-name' }, 'Текст подписи'), typed), el('div', { class: 'field' }, el('label', { for: 'sig-font' }, 'Стиль'), fontSel)),
    upload: el('div', { class: 'sig-pane' }, el('div', { class: 'field' }, el('label', { for: 'sig-file' }, 'Фото подписи на белой бумаге'), upload), el('label', { class: 'field check' }, knock, el('span', {}, 'Убрать белый фон'))),
  };
  const tabBar = el('div', { class: 'chips' }, Object.entries(tabs).map(([k, l]) => el('button', { class: 'chip', type: 'button', 'data-tab': k, onclick: () => show(k) }, l)));
  const show = k => {
    tab = k;
    Object.entries(panes).forEach(([n, p]) => (p.hidden = n !== k));
    tabBar.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
  };
  const err = el('div', { class: 'status' });
  const ok = el('button', { class: 'btn primary', type: 'button' }, 'Готово');
  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Подпись' },
    el('div', { class: 'modal-box' }, el('h2', {}, 'Ваша подпись'), tabBar, ...Object.values(panes), err,
      el('div', { class: 'row' }, ok, el('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.remove() }, 'Отмена'))));
  ok.addEventListener('click', async () => {
    let c;
    if (tab === 'draw') c = trimCanvas(pad);
    else if (tab === 'type') {
      if (!typed.value.trim()) return setStatus(err, 'error', 'Введите текст подписи.');
      await ensureFont(`64px "${fontSel.value}"`);
      const t = makeCanvas(1200, 220), ctx = t.getContext('2d');
      ctx.font = `${fontSel.value === 'Golos Text' ? 600 : 400} 110px "${fontSel.value}", cursive`;
      ctx.fillStyle = color.value; ctx.textBaseline = 'middle';
      ctx.fillText(typed.value.trim(), 10, 115);
      c = trimCanvas(t);
    } else {
      if (!upload.files[0]) return setStatus(err, 'error', 'Выберите фото подписи.');
      const img = await loadImage(upload.files[0]);
      const k = Math.min(1, 1200 / img.naturalWidth);
      const t = drawImageCanvas(img, img.naturalWidth * k, img.naturalHeight * k);
      if (knock.checked) {
        const ctx = t.getContext('2d'), id = ctx.getImageData(0, 0, t.width, t.height), d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          d[i + 3] = l > 200 ? 0 : l > 140 ? Math.round((200 - l) / 60 * 255) : 255;
        }
        ctx.putImageData(id, 0, 0);
      }
      c = trimCanvas(t);
    }
    if (!c) return setStatus(err, 'error', 'Подпись пустая — нарисуйте её мышкой или пальцем.');
    dlg.remove();
    onDone(c.toDataURL('image/png'), c.width / c.height);
  });
  show('draw');
  document.body.append(dlg);
}

const ED_TOOLS = [
  ['select', 'Выбрать'], ['text', 'Текст'], ['image', 'Картинка'], ['sign', 'Подпись'],
  ['rect', 'Рамка'], ['highlight', 'Маркер'], ['whiteout', 'Замазать'], ['check', 'Галочка ✓'],
];

function pdfEditorTool(root, startTool) {
  let file = null, items = [], pages = [], current = 'select', pending = null, selected = null, seq = 0;
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'results' });
  const color = el('input', { type: 'color', id: 'ed-color', value: '#1a1a1a', title: 'Цвет' });
  const size = el('input', { type: 'number', id: 'ed-size', min: 6, max: 72, value: 14, title: 'Размер шрифта, pt' });
  const imgInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const hint = el('span', { class: 'muted ed-hint' });
  const toolBtns = ED_TOOLS.map(([k, l]) => el('button', { class: 'chip', type: 'button', 'data-tool': k, onclick: () => setTool(k) }, l));
  const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Сохранить PDF');
  const bar = el('div', { class: 'ed-bar', hidden: true },
    el('div', { class: 'chips' }, toolBtns),
    el('div', { class: 'row' },
      el('label', { for: 'ed-color', class: 'muted' }, 'Цвет'), color,
      el('label', { for: 'ed-size', class: 'muted' }, 'Шрифт, pt'), size,
      el('button', { class: 'btn ghost', type: 'button', onclick: () => dz.pick() }, 'Другой файл'), saveBtn),
    hint);
  const pagesBox = el('div', { class: 'ed-pages' });
  const dz = dropzone({ accept: PDF_ACCEPT, onFiles: f => open(f[0]) });
  root.append(dz, bar, status, pagesBox, results, imgInput);

  const HINTS = {
    select: 'Перетаскивайте элементы, тяните за правый нижний угол, чтобы изменить размер. Delete — удалить выделенное.',
    text: 'Кликните на странице, где нужен текст, и печатайте.',
    image: 'Выберите картинку, затем кликните на странице, куда её поставить.',
    sign: 'Создайте подпись, затем кликните на странице, куда её поставить.',
    rect: 'Кликните на странице — появится рамка, её можно растянуть.',
    highlight: 'Кликните на строку — появится жёлтый маркер, растяните его по тексту.',
    whiteout: 'Кликните на то, что нужно скрыть, — появится белый прямоугольник.',
    check: 'Кликните, куда поставить галочку.',
  };
  function setTool(k) {
    current = k;
    toolBtns.forEach(b => b.classList.toggle('on', b.dataset.tool === k));
    hint.textContent = HINTS[k];
    pagesBox.dataset.tool = k;
    if (k === 'image') { pending = null; imgInput.click(); }
    if (k === 'sign') { pending = null; signatureDialog((src, ratio) => { pending = { src, ratio }; hint.textContent = 'Кликните на странице, куда поставить подпись.'; }); }
  }
  imgInput.addEventListener('change', async () => {
    const f = imgInput.files[0];
    imgInput.value = '';
    if (!f) return setTool('select');
    const img = await loadImage(f);
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = drawImageCanvas(img, img.naturalWidth * k, img.naturalHeight * k);
    pending = { src: c.toDataURL(f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92), ratio: c.width / c.height };
    hint.textContent = 'Кликните на странице, куда поставить картинку.';
  });

  async function open(f) {
    file = f; items = []; selected = null;
    results.replaceChildren(); pagesBox.replaceChildren();
    try {
      setStatus(status, 'busy', 'Открываю PDF…');
      await Promise.all([loadLib('pdfjs'), loadLib('pdflib')]);
      const doc = await openPdfJs(f);
      pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        setStatus(status, 'busy', `Страница ${i} из ${doc.numPages}`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPdfPage(page, 1.6);
        const overlay = el('div', { class: 'ed-overlay' });
        const wrap = el('div', { class: 'ed-page', style: `aspect-ratio: ${vp.width} / ${vp.height}` }, canvas, overlay);
        const p = { index: i - 1, W: vp.width, H: vp.height, overlay };
        overlay.addEventListener('pointerdown', e => { if (e.target === overlay) { e.preventDefault(); placeAt(p, e); } });
        new ResizeObserver(() => overlay.style.setProperty('--k', overlay.clientWidth / p.W)).observe(overlay);
        pages.push(p);
        pagesBox.append(el('div', { class: 'ed-page-wrap' }, el('div', { class: 'muted ed-page-no' }, `Страница ${i}`), wrap));
      }
      status.replaceChildren();
      dz.hidden = true; bar.hidden = false;
      setTool(startTool);
    } catch (e) { setStatus(status, 'error', e.message); }
  }

  function placeAt(p, e) {
    const r = p.overlay.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * p.W, y = (e.clientY - r.top) / r.height * p.H;
    if (current === 'select') { select(null); return; }
    const fs = Number(size.value) || 14;
    let it;
    if (current === 'text') it = { type: 'text', x, y: y - fs * 0.6, w: Math.min(p.W - x, fs * 14), h: fs * 1.3, text: '', size: fs, color: color.value };
    else if (current === 'image' || current === 'sign') {
      if (!pending) return;
      const w = current === 'sign' ? Math.min(160, p.W / 3) : Math.min(220, p.W / 2.5);
      it = { type: 'image', x: x - w / 2, y: y - w / pending.ratio / 2, w, h: w / pending.ratio, src: pending.src };
    }
    else if (current === 'rect') it = { type: 'rect', x: x - 60, y: y - 25, w: 120, h: 50, color: color.value };
    else if (current === 'highlight') it = { type: 'highlight', x: x - 4, y: y - 8, w: 140, h: 16, color: '#ffe14d' };
    else if (current === 'whiteout') it = { type: 'whiteout', x: x - 50, y: y - 10, w: 100, h: 20 };
    else if (current === 'check') it = { type: 'text', x: x - 7, y: y - 11, w: 22, h: 22, text: '✓', size: 18, color: color.value };
    it.page = p.index; it.id = ++seq;
    items.push(it);
    mount(p, it);
    if (current !== 'check' && current !== 'highlight') setTool('select');
  }

  function mount(p, it) {
    const node = el('div', { class: `ed-item ed-type-${it.type}`, tabindex: 0 });
    const place = () => {
      node.style.left = `${it.x / p.W * 100}%`; node.style.top = `${it.y / p.H * 100}%`;
      node.style.width = `${it.w / p.W * 100}%`; node.style.height = `${it.h / p.H * 100}%`;
    };
    if (it.type === 'text') {
      const t = el('div', { class: 'ed-text', contenteditable: 'true', spellcheck: 'false', style: `--fs:${it.size}; color:${it.color}` }, it.text);
      t.addEventListener('input', () => {
        it.text = t.innerText.replace(/\n$/, '');
        it.h = Math.max(it.h, t.scrollHeight / (p.overlay.clientWidth / p.W));
        place();
      });
      node.append(t, el('span', { class: 'ed-move', title: 'Перетащить', 'aria-hidden': 'true' }, '⠿'));
    } else if (it.type === 'image') node.append(el('img', { src: it.src, alt: '', draggable: 'false' }));
    else if (it.type === 'rect') node.style.borderColor = it.color;
    const handle = el('span', { class: 'ed-resize', 'aria-hidden': 'true' });
    const del = el('button', { class: 'ed-del', type: 'button', 'aria-label': 'Удалить', onclick: () => remove(it, node) }, '×');
    node.append(handle, del);
    place();
    p.overlay.append(node);
    it.node = node;
    if (it.type === 'text' && !it.text) node.querySelector('.ed-text').focus();

    const drag = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      select(it);
      const r = p.overlay.getBoundingClientRect(), k = p.W / r.width;
      const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y, ow = it.w, oh = it.h;
      const move = ev => {
        const dx = (ev.clientX - sx) * k, dy = (ev.clientY - sy) * k;
        if (mode === 'move') { it.x = Math.max(-it.w / 2, Math.min(p.W - it.w / 2, ox + dx)); it.y = Math.max(-it.h / 2, Math.min(p.H - it.h / 2, oy + dy)); }
        else {
          it.w = Math.max(8, ow + dx);
          it.h = it.type === 'image' ? it.w * oh / ow : Math.max(8, oh + dy);
        }
        place();
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    handle.addEventListener('pointerdown', e => drag(e, 'resize'));
    node.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('ed-text') && document.activeElement === e.target) { select(it); return; }
      if (e.target === del) return;
      drag(e, 'move');
    });
    node.addEventListener('dblclick', () => node.querySelector('.ed-text')?.focus());
    node.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.isContentEditable) { e.preventDefault(); remove(it, node); }
    });
    select(it);
  }
  function select(it) {
    selected = it;
    pagesBox.querySelectorAll('.ed-item').forEach(n => n.classList.toggle('sel', !!it && n === it.node));
  }
  function remove(it, node) { items = items.filter(x => x !== it); node.remove(); }

  saveBtn.addEventListener('click', async () => {
    try {
      setStatus(status, 'busy', 'Сохраняю…');
      const doc = await openPdf(file);
      const live = items.filter(it => it.type !== 'text' || it.text.trim());
      const font = live.some(it => it.type === 'text') ? await embedCyrFont(doc) : null;
      const docPages = doc.getPages();
      const imgCache = {};
      for (const it of live) {
        const page = docPages[it.page], g = pageGeom(page);
        const x0 = it.x, x1 = it.x + it.w, y0 = g.H - (it.y + it.h), y1 = g.H - it.y;
        if (it.type === 'text') {
          it.text.split('\n').forEach((line, i) => {
            if (line) drawTextVis(page, g, line, { vx: it.x, vy: g.H - it.y - it.size * (0.946 + i * 1.2), font, size: it.size, color: hexRgb(it.color) });
          });
        } else if (it.type === 'image') {
          if (!imgCache[it.src]) {
            const bytes = await (await fetch(it.src)).arrayBuffer();
            imgCache[it.src] = it.src.startsWith('data:image/jpeg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          }
          drawImageVis(page, g, imgCache[it.src], { x0, y0, x1, y1 });
        } else {
          const r = visRectToBox(g, x0, y0, x1, y1);
          if (it.type === 'rect') page.drawRectangle({ ...r, borderColor: hexRgb(it.color), borderWidth: 1.5 });
          else if (it.type === 'highlight') page.drawRectangle({ ...r, color: hexRgb(it.color), opacity: 0.45, blendMode: PDFLib.BlendMode.Multiply });
          else page.drawRectangle({ ...r, color: PDFLib.rgb(1, 1, 1) });
        }
      }
      status.replaceChildren();
      renderResults(results, { files: [{ blob: pdfBlob(await doc.save()), name: `${baseName(file.name)}_изменён.pdf` }], message: live.length ? `Добавлено элементов: ${live.length}.` : 'Вы ничего не добавили — файл сохранён без изменений.' });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
  });
}

tool({
  id: 'edit-pdf', cat: 'pdf', badge: 'Ред', title: 'Редактор PDF',
  desc: 'Добавьте текст, картинки, подпись, рамки, маркер или закрасьте лишнее.',
  render: root => pdfEditorTool(root, 'text'),
});
tool({
  id: 'sign-pdf', cat: 'pdf', badge: 'Подп', title: 'Подписать PDF',
  desc: 'Нарисуйте, напечатайте или загрузите подпись и поставьте её в документ.',
  render: root => pdfEditorTool(root, 'sign'),
});

/* ===================== Заполнить форму ===================== */

tool({
  id: 'fill-pdf-form', cat: 'pdf', badge: 'Форм', title: 'Заполнить PDF-форму',
  desc: 'Заполните поля анкеты или бланка PDF и сохраните результат.',
  render(root) {
    let file = null, doc = null, rows = [];
    const status = el('div', { class: 'status', role: 'status' });
    const results = el('div', { class: 'results' });
    const list = el('div', { class: 'form form-fields' });
    const flat = el('input', { type: 'checkbox', id: 'ff-flat' });
    const save = el('button', { class: 'btn primary big', type: 'button' }, 'Сохранить заполненный PDF');
    const work = el('div', { class: 'workspace', hidden: true },
      el('div', { class: 'ws-files' }, list),
      el('div', { class: 'ws-side' }, el('label', { class: 'field check' }, flat, el('span', {}, 'Запретить дальнейшее редактирование полей')), save,
        el('button', { class: 'btn ghost', type: 'button', onclick: () => dz.pick() }, 'Другой файл'), status));
    const dz = dropzone({ accept: PDF_ACCEPT, onFiles: f => open(f[0]) });
    root.append(dz, work, results);

    async function open(f) {
      file = f; results.replaceChildren(); status.replaceChildren();
      try {
        await loadLib('pdflib');
        doc = await openPdf(f);
        const P = PDFLib;
        const fields = doc.getForm().getFields();
        rows = [];
        list.replaceChildren();
        for (const [i, fld] of fields.entries()) {
          const name = fld.getName(), id = `ff-${i}`;
          let input, get;
          if (fld instanceof P.PDFTextField) {
            input = fld.isMultiline() ? el('textarea', { id, rows: 3 }) : el('input', { type: 'text', id });
            input.value = fld.getText() || '';
            get = () => fld.setText(input.value);
          } else if (fld instanceof P.PDFCheckBox) {
            input = el('input', { type: 'checkbox', id, checked: fld.isChecked() });
            get = () => (input.checked ? fld.check() : fld.uncheck());
          } else if (fld instanceof P.PDFDropdown || fld instanceof P.PDFOptionList || fld instanceof P.PDFRadioGroup) {
            input = el('select', { id }, el('option', { value: '' }, '—'), fld.getOptions().map(o => el('option', { value: o }, o)));
            input.value = [].concat(fld.getSelected() || [])[0] || '';
            get = () => { if (input.value) fld.select(input.value); else if (fld.clear) fld.clear(); };
          } else continue;
          rows.push(get);
          list.append(input.type === 'checkbox'
            ? el('label', { class: 'field check' }, input, el('span', {}, name))
            : el('div', { class: 'field' }, el('label', { for: id }, name), input));
        }
        if (!rows.length) throw new Error('В этом PDF нет полей для заполнения. Чтобы вписать текст поверх документа, используйте «Редактор PDF».');
        dz.hidden = true; work.hidden = false;
      } catch (e) {
        work.hidden = true;
        root.insertBefore(status, results);
        setStatus(status, 'error', e.message);
      }
    }
    save.addEventListener('click', async () => {
      try {
        setStatus(status, 'busy', 'Сохраняю…');
        rows.forEach(fn => fn());
        const form = doc.getForm();
        form.updateFieldAppearances(await embedCyrFont(doc));
        if (flat.checked) form.flatten();
        status.replaceChildren();
        renderResults(results, { files: [{ blob: pdfBlob(await doc.save({ updateFieldAppearances: false })), name: `${baseName(file.name)}_заполнен.pdf` }] });
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
    });
  },
});

/* ===================== Сравнить два PDF ===================== */

/** Алгоритм Майерса: минимальный список правок между массивами a и b. */
function myersDiff(a, b, maxD = 6000) {
  const n = a.length, m = b.length, max = n + m, off = max + 1;
  const v = new Int32Array(2 * max + 3), trace = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        const ops = [];
        let cx = n, cy = m;
        for (let dd = trace.length - 1; dd >= 0; dd--) {
          const vv = trace[dd], get = kk => vv[kk + dd + 1], kk = cx - cy;
          const prevK = (kk === -dd || (kk !== dd && get(kk - 1) < get(kk + 1))) ? kk + 1 : kk - 1;
          const px = get(prevK), py = px - prevK;
          while (cx > px && cy > py) { ops.push(['=', a[cx - 1]]); cx--; cy--; }
          if (dd > 0) ops.push(cx === px ? ['+', b[cy - 1]] : ['-', a[cx - 1]]);
          cx = px; cy = py;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}

tool({
  id: 'compare-pdf', cat: 'pdf', badge: 'A≠B', title: 'Сравнить два PDF',
  desc: 'Найдите, что изменилось между двумя версиями договора или документа.',
  render(root) {
    const slots = [null, null];
    const status = el('div', { class: 'status', role: 'status' });
    const out = el('div', { class: 'compare-out' });
    const zones = [0, 1].map(i => {
      const label = el('div', { class: 'muted' }, 'Файл не выбран');
      const dz = dropzone({ accept: PDF_ACCEPT, label: i ? 'Новая версия' : 'Исходная версия', onFiles: f => { slots[i] = f[0]; label.textContent = `${f[0].name} · ${fmtSize(f[0].size)}`; dz.classList.add('filled'); go.disabled = !(slots[0] && slots[1]); } });
      return el('div', { class: 'compare-slot' }, dz, label);
    });
    const go = el('button', { class: 'btn primary big', type: 'button', disabled: true }, 'Сравнить');
    root.append(el('div', { class: 'compare-grid' }, zones), go, status, out);

    go.addEventListener('click', async () => {
      out.replaceChildren();
      try {
        await loadLib('pdfjs');
        setStatus(status, 'busy', 'Читаю текст…');
        const noop = () => tick();
        const [ta, tb] = await Promise.all(slots.map(f => pdfText(f, noop).catch(() => [''])));
        const tok = pages => pages.join('\n').match(/\S+|\n/g) || [];
        const A = tok(ta), B = tok(tb);
        setStatus(status, 'busy', 'Сравниваю текст…');
        await tick();
        const ops = myersDiff(A, B);
        const textBox = el('div', { class: 'diff-text' });
        let added = 0, removed = 0;
        if (!ops) textBox.append(el('p', { class: 'hint' }, 'Документы отличаются слишком сильно для пословного сравнения. Смотрите визуальное сравнение ниже.'));
        else {
          let run = null;
          const flush = () => {
            if (!run) return;
            const tag = run.t === '+' ? 'ins' : run.t === '-' ? 'del' : 'span';
            textBox.append(el(tag, {}, run.w.join(' ').replace(/ ?\n ?/g, '\n')), ' ');
            run = null;
          };
          for (const [t, w] of ops) {
            if (t === '+') added += w !== '\n'; else if (t === '-') removed += w !== '\n';
            if (!run || run.t !== t) { flush(); run = { t, w: [] }; }
            run.w.push(w);
          }
          flush();
        }
        out.append(el('section', { class: 'results compare-block' },
          el('div', { class: 'results-head' }, el('h2', {}, added || removed ? `Найдено изменений: добавлено слов — ${added}, удалено — ${removed}` : 'Текст документов совпадает'),
            el('p', {}, el('ins', {}, 'Зелёным'), ' — добавлено в новой версии, ', el('del', {}, 'красным'), ' — удалено.')),
          textBox));

        const [da, db] = await Promise.all(slots.map(openPdfJs));
        const n = Math.min(da.numPages, db.numPages, 40);
        const grid = el('div', { class: 'diff-pages' });
        out.append(el('section', { class: 'compare-block' },
          el('h2', {}, 'Визуальное сравнение'),
          el('p', { class: 'hint' }, `Отличия на страницах подсвечены красным.${da.numPages !== db.numPages ? ` Количество страниц разное: ${da.numPages} и ${db.numPages}.` : ''}${Math.max(da.numPages, db.numPages) > 40 ? ' Показаны первые 40 страниц.' : ''}`),
          grid));
        for (let i = 1; i <= n; i++) {
          setStatus(status, 'busy', `Сравниваю страницу ${i} из ${n}`);
          const ca = await renderPdfPage(await da.getPage(i), 1), cb = await renderPdfPage(await db.getPage(i), 1);
          const w = Math.max(ca.width, cb.width), h = Math.max(ca.height, cb.height);
          const pa = drawImageCanvas(ca, ca.width, ca.height), res = makeCanvas(w, h), ctx = res.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(cb, 0, 0);
          const ia = makeCanvas(w, h).getContext('2d');
          ia.fillStyle = '#fff'; ia.fillRect(0, 0, w, h); ia.drawImage(pa, 0, 0);
          const A1 = ia.getImageData(0, 0, w, h).data, img = ctx.getImageData(0, 0, w, h), B1 = img.data;
          let diff = 0;
          for (let k = 0; k < B1.length; k += 4) {
            const dlt = Math.abs(A1[k] - B1[k]) + Math.abs(A1[k + 1] - B1[k + 1]) + Math.abs(A1[k + 2] - B1[k + 2]);
            if (dlt > 60) { B1[k] = 230; B1[k + 1] = 30; B1[k + 2] = 30; diff++; }
            else { B1[k] = 255 - (255 - B1[k]) * 0.35; B1[k + 1] = 255 - (255 - B1[k + 1]) * 0.35; B1[k + 2] = 255 - (255 - B1[k + 2]) * 0.35; }
          }
          ctx.putImageData(img, 0, 0);
          const pct = diff / (w * h) * 100;
          grid.append(el('figure', { class: 'diff-page' + (diff ? ' changed' : '') }, res,
            el('figcaption', {}, `Страница ${i}`, el('span', { class: 'chip' }, diff ? `${pct < 0.1 ? '<0,1' : pct.toFixed(1).replace('.', ',')}% отличий` : 'без изменений'))));
          await tick();
        }
        status.replaceChildren();
      } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
    });
  },
});
