'use strict';

/* ===================== Редактор PDF: страницы, текст, фигуры, рисование, подпись ===================== */

const ED_FONTS = { sans: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'], serif: ['DejaVuSerif.ttf', 'DejaVuSerif.ttf'], mono: ['DejaVuSansMono.ttf', 'DejaVuSansMono.ttf'] };
const ED_CSS_FONT = { sans: '"DejaVu Sans", Arial, sans-serif', serif: '"DejaVu Serif", Georgia, serif', mono: '"DejaVu Sans Mono", Consolas, monospace' };

const ED_TOOLS = [
  ['select', 'Выбрать'], ['text', 'Текст'], ['pen', 'Карандаш'], ['line', 'Линия'], ['arrow', 'Стрелка'],
  ['rect', 'Прямоугольник'], ['ellipse', 'Овал'], ['highlight', 'Маркер'], ['whiteout', 'Замазать'],
  ['image', 'Картинка'], ['sign', 'Подпись'], ['check', '✓'], ['cross', '✗'], ['date', 'Дата'],
];
const ED_DRAG = new Set(['pen', 'line', 'arrow', 'rect', 'ellipse', 'highlight', 'whiteout']);
const ED_SHAPES = new Set(['pen', 'line', 'arrow', 'rect', 'ellipse', 'highlight', 'whiteout']);
const ED_HINTS = {
  select: 'Перетаскивайте элементы, тяните за угол, чтобы изменить размер. Delete — удалить, Ctrl+D — копия, стрелки — сдвиг, Ctrl+Z — отмена.',
  text: 'Кликните на странице, где нужен текст, и печатайте.',
  pen: 'Рисуйте мышкой, пальцем или стилусом.',
  line: 'Протяните линию мышкой.', arrow: 'Протяните стрелку от начала к концу.',
  rect: 'Протяните прямоугольник мышкой. Включите «Заливку», чтобы закрасить его.', ellipse: 'Протяните овал мышкой.',
  highlight: 'Проведите маркером по тексту.', whiteout: 'Выделите то, что нужно скрыть, — появится белый прямоугольник.',
  image: 'Выберите картинку, затем кликните на странице, куда её поставить.', sign: 'Создайте подпись, затем кликните на странице, куда её поставить.',
  check: 'Кликните, куда поставить галочку.', cross: 'Кликните, куда поставить крестик.', date: 'Кликните, куда вставить сегодняшнюю дату.',
};

/** Поворот элемента вместе со страницей на 90° по часовой. H — высота страницы до поворота. */
function rotateItemCW(it, H) {
  if (ED_SHAPES.has(it.type)) {
    [it.x, it.y, it.w, it.h] = [H - (it.y + it.h), it.x, it.h, it.w];
    if (it.pts) it.pts = it.pts.map(([u, v]) => [1 - v, u]);
  } else {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    it.x = H - cy - it.w / 2; it.y = cx - it.h / 2;
  }
}

function shapeSvg(it) {
  const { w, h } = it, sw = it.width || 2;
  const stroke = `stroke="${it.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  let body = '';
  if (it.type === 'rect') body = `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" ${stroke} fill="${it.fill || 'none'}"/>`;
  else if (it.type === 'ellipse') body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, (w - sw) / 2)}" ry="${Math.max(0, (h - sw) / 2)}" ${stroke} fill="${it.fill || 'none'}"/>`;
  else if (it.type === 'highlight') body = `<rect width="${w}" height="${h}" fill="${it.color}" opacity=".45"/>`;
  else if (it.type === 'whiteout') body = `<rect width="${w}" height="${h}" fill="#fff"/>`;
  else {
    const pts = it.pts.map(([u, v]) => [u * w, v * h]);
    body = `<polyline points="${pts.map(p => p.join(',')).join(' ')}" ${stroke} fill="none"/>`;
    if (it.type === 'arrow' && pts.length > 1) for (const seg of arrowHead(pts[pts.length - 2], pts[pts.length - 1], sw)) body += `<line x1="${seg[0][0]}" y1="${seg[0][1]}" x2="${seg[1][0]}" y2="${seg[1][1]}" ${stroke}/>`;
  }
  return `<svg viewBox="0 0 ${Math.max(w, 0.01)} ${Math.max(h, 0.01)}" preserveAspectRatio="none" style="opacity:${(it.opacity ?? 100) / 100}">${body}</svg>`;
}

function arrowHead([x1, y1], [x2, y2], sw) {
  const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(8, sw * 4), s = 0.45;
  return [[[x2, y2], [x2 - L * Math.cos(a - s), y2 - L * Math.sin(a - s)]], [[x2, y2], [x2 - L * Math.cos(a + s), y2 - L * Math.sin(a + s)]]];
}

function pdfEditorTool(root, startTool) {
  const docs = {};
  let pages = [], items = [], tool = 'select', pending = null, selected = null, zoom = 1, seq = 0, fileName = 'document.pdf';
  let history = [], hptr = -1;
  const nodes = new Map(), pageDom = new Map(), renders = new Map();
  const style = { color: '#1a1a1a', fill: '#ffe14d', filled: false, width: 2, opacity: 100, size: 14, font: 'sans', bold: false };

  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'results' });
  const pagesBox = el('div', { class: 'ed-pages' });
  const hint = el('span', { class: 'muted ed-hint' });
  const imgInput = el('input', { type: 'file', accept: IMG_ACCEPT, hidden: true });
  const pdfInput = el('input', { type: 'file', accept: PDF_ACCEPT, hidden: true, multiple: true });
  const pageImgInput = el('input', { type: 'file', accept: IMG_ACCEPT, hidden: true, multiple: true });

  const toolBtns = ED_TOOLS.map(([k, l]) => el('button', { class: 'chip', type: 'button', 'data-tool': k, onclick: () => setTool(k) }, l));
  const ctl = {
    color: el('input', { type: 'color', id: 'ed-color', value: style.color }),
    filled: el('input', { type: 'checkbox', id: 'ed-filled' }),
    fill: el('input', { type: 'color', id: 'ed-fill', value: style.fill }),
    width: el('input', { type: 'range', id: 'ed-width', min: 1, max: 16, value: style.width }),
    opacity: el('input', { type: 'range', id: 'ed-opacity', min: 10, max: 100, step: 5, value: style.opacity }),
    size: el('input', { type: 'number', id: 'ed-size', min: 6, max: 96, value: style.size }),
    font: el('select', { id: 'ed-font' }, [['sans', 'Без засечек'], ['serif', 'С засечками'], ['mono', 'Моноширинный']].map(([v, l]) => el('option', { value: v }, l))),
    bold: el('button', { class: 'chip ed-bold', type: 'button', title: 'Жирный', 'aria-pressed': 'false' }, 'Ж'),
  };
  const undoBtn = el('button', { class: 'btn small', type: 'button', title: 'Отменить (Ctrl+Z)', onclick: () => undo() }, '↶ Отменить');
  const redoBtn = el('button', { class: 'btn small', type: 'button', title: 'Повторить (Ctrl+Y)', onclick: () => redo() }, '↷ Повторить');
  const zoomSel = el('select', { id: 'ed-zoom', 'aria-label': 'Масштаб' }, [['0.6', '60%'], ['0.8', '80%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%']].map(([v, l]) => el('option', { value: v }, l)));
  zoomSel.value = '1';
  const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Сохранить PDF');
  const pageCount = el('span', { class: 'muted' });

  const bar = el('div', { class: 'ed-bar', hidden: true },
    el('div', { class: 'chips' }, toolBtns),
    el('div', { class: 'row ed-style' },
      el('label', { for: 'ed-color', class: 'muted' }, 'Цвет'), ctl.color,
      el('label', { class: 'field check inline' }, ctl.filled, el('span', {}, 'Заливка')), ctl.fill,
      el('label', { for: 'ed-width', class: 'muted' }, 'Толщина'), ctl.width,
      el('label', { for: 'ed-opacity', class: 'muted' }, 'Прозрачность'), ctl.opacity,
      el('label', { for: 'ed-font', class: 'muted' }, 'Шрифт'), ctl.font, ctl.bold,
      el('label', { for: 'ed-size', class: 'muted' }, 'pt'), ctl.size),
    el('div', { class: 'row' },
      undoBtn, redoBtn, zoomSel,
      el('button', { class: 'btn small', type: 'button', onclick: () => addBlank(pages.length - 1) }, '+ Пустая страница'),
      el('button', { class: 'btn small', type: 'button', onclick: () => pdfInput.click() }, '+ Страницы из PDF'),
      el('button', { class: 'btn small', type: 'button', onclick: () => pageImgInput.click() }, '+ Картинка страницей'),
      pageCount,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => dz.pick() }, 'Другой файл'), saveBtn),
    hint);
  const dz = dropzone({ accept: PDF_ACCEPT, onFiles: f => open(f[0]) });
  root.append(dz, bar, status, pagesBox, results, imgInput, pdfInput, pageImgInput);

  /* ---------- Состояние и отмена ---------- */

  const snap = () => JSON.stringify({ pages, items, seq });
  function record() {
    history = history.slice(0, hptr + 1);
    history.push(snap());
    if (history.length > 120) history.shift();
    hptr = history.length - 1;
    syncUndo();
  }
  function restore(s) {
    const d = JSON.parse(s);
    pages = d.pages; items = d.items; seq = d.seq; selected = null;
    renderAll();
    syncUndo();
  }
  const undo = () => { if (hptr > 0) restore(history[--hptr]); };
  const redo = () => { if (hptr < history.length - 1) restore(history[++hptr]); };
  const syncUndo = () => { undoBtn.disabled = hptr <= 0; redoBtn.disabled = hptr >= history.length - 1; };

  /* ---------- Загрузка ---------- */

  async function loadPdf(f) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let view;
    try { view = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? `«${f.name}» защищён паролем.` : `Не удалось открыть «${f.name}»: файл повреждён или это не PDF.`); }
    const id = `d${++seq}`;
    docs[id] = { bytes, view };
    const out = [];
    for (let i = 0; i < view.numPages; i++) {
      const pg = await view.getPage(i + 1), vp = pg.getViewport({ scale: 1 });
      out.push({ id: `p${++seq}`, kind: 'pdf', doc: id, index: i, baseRot: pg.rotate || 0, rot: 0, w: vp.width, h: vp.height });
    }
    return out;
  }

  async function open(f) {
    fileName = f.name;
    results.replaceChildren();
    try {
      setStatus(status, 'busy', 'Открываю PDF…');
      await Promise.all([loadLib('pdfjs'), loadLib('pdflib')]);
      for (const k of Object.keys(docs)) delete docs[k];
      renders.clear();
      pages = await loadPdf(f);
      items = [];
      history = []; hptr = -1;
      status.replaceChildren();
      dz.hidden = true; bar.hidden = false;
      renderAll();
      record();
      setTool(startTool);
    } catch (e) { setStatus(status, 'error', e.message); }
  }

  pdfInput.addEventListener('change', async () => {
    const files = [...pdfInput.files];
    pdfInput.value = '';
    try {
      for (const f of files) pages.push(...await loadPdf(f));
      renderAll(); record();
      pagesBox.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { setStatus(status, 'error', e.message); }
  });

  pageImgInput.addEventListener('change', async () => {
    const files = [...pageImgInput.files];
    pageImgInput.value = '';
    for (const f of files) {
      const img = await loadImage(f);
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = drawImageCanvas(img, img.naturalWidth * k, img.naturalHeight * k, { fill: '#fff' });
      const land = img.naturalWidth > img.naturalHeight;
      pages.push({ id: `p${++seq}`, kind: 'image', src: c.toDataURL('image/jpeg', 0.9), ratio: c.width / c.height, rot: 0, baseRot: 0, w: land ? 841.89 : 595.28, h: land ? 595.28 : 841.89 });
    }
    renderAll(); record();
    pagesBox.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- Страницы ---------- */

  const size = p => p.rot % 180 ? { W: p.h, H: p.w } : { W: p.w, H: p.h };
  const pageIndex = id => pages.findIndex(p => p.id === id);

  async function pageCanvas(p) {
    const scale = 1.6 * zoom;
    const key = `${p.kind}:${p.doc || ''}:${p.index ?? ''}:${p.kind === 'image' ? p.id : ''}:${p.kind === 'blank' ? `${p.w}x${p.h}` : ''}|${p.rot}|${scale}`;
    if (renders.has(key)) return renders.get(key);
    const job = (async () => {
      const { W, H } = size(p);
      if (p.kind === 'pdf') {
        const pg = await docs[p.doc].view.getPage(p.index + 1);
        const vp = pg.getViewport({ scale, rotation: (p.baseRot + p.rot) % 360 });
        const c = makeCanvas(vp.width, vp.height), ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        return c;
      }
      const c = makeCanvas(W * scale, H * scale), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      if (p.kind === 'image') {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = p.src; });
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(p.rot * Math.PI / 180);
        const [pw, ph] = [p.w * scale, p.h * scale], m = 20 * scale;
        const k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
        ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
      }
      return c;
    })();
    renders.set(key, job);
    return job;
  }

  function renderAll() {
    nodes.clear(); pageDom.clear();
    pagesBox.style.setProperty('--zoom', zoom);
    pagesBox.replaceChildren(...pages.map((p, i) => pageNode(p, i)));
    pageCount.textContent = `Страниц: ${pages.length}`;
    if (selected && !items.includes(selected)) selected = null;
  }

  function pageNode(p, i) {
    const { W, H } = size(p);
    const holder = el('div', { class: 'ed-canvas' });
    const overlay = el('div', { class: 'ed-overlay' });
    const pageEl = el('div', { class: 'ed-page', style: `aspect-ratio: ${W} / ${H}` }, holder, overlay);
    pageCanvas(p).then(c => holder.replaceChildren(copyCanvas(c)));
    const act = (label, title, fn, disabled) => el('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, disabled, onclick: fn }, label);
    const head = el('div', { class: 'ed-page-head' },
      el('span', { class: 'ed-page-no' }, `Страница ${i + 1} из ${pages.length}`),
      el('div', { class: 'ed-page-actions' },
        act('↑', 'Переместить выше', () => movePage(i, -1), i === 0),
        act('↓', 'Переместить ниже', () => movePage(i, 1), i === pages.length - 1),
        act('↺', 'Повернуть влево', () => rotatePage(p, 3)),
        act('↻', 'Повернуть вправо', () => rotatePage(p, 1)),
        act('⧉', 'Дублировать страницу', () => duplicatePage(i)),
        act('+', 'Вставить пустую страницу после', () => addBlank(i)),
        act('×', 'Удалить страницу', () => deletePage(i), pages.length === 1)));
    overlay.addEventListener('pointerdown', e => onOverlayDown(p, e));
    new ResizeObserver(() => overlay.style.setProperty('--k', overlay.clientWidth / size(p).W)).observe(overlay);
    pageDom.set(p.id, { overlay, p });
    items.filter(it => it.pageId === p.id).forEach(it => mountItem(it));
    return el('div', { class: 'ed-page-wrap', 'data-page': p.id }, head, pageEl);
  }

  function copyCanvas(c) {
    const n = makeCanvas(c.width, c.height);
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  function movePage(i, d) {
    [pages[i], pages[i + d]] = [pages[i + d], pages[i]];
    renderAll(); record();
  }
  function rotatePage(p, times) {
    for (let t = 0; t < times; t++) {
      const { H } = size(p);
      items.filter(it => it.pageId === p.id).forEach(it => rotateItemCW(it, H));
      p.rot = (p.rot + 90) % 360;
    }
    renderAll(); record();
  }
  function duplicatePage(i) {
    const src = pages[i], copy = { ...src, id: `p${++seq}` };
    if (src.kind === 'image') copy.src = src.src;
    pages.splice(i + 1, 0, copy);
    items.filter(it => it.pageId === src.id).forEach(it => items.push({ ...structuredClone(it), id: ++seq, pageId: copy.id }));
    renderAll(); record();
  }
  function addBlank(i) {
    const ref = pages[i] ? size(pages[i]) : { W: 595.28, H: 841.89 };
    pages.splice(i + 1, 0, { id: `p${++seq}`, kind: 'blank', rot: 0, baseRot: 0, w: ref.W, h: ref.H });
    renderAll(); record();
    pagesBox.children[i + 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function deletePage(i) {
    if (pages.length === 1) return;
    const [p] = pages.splice(i, 1);
    items = items.filter(it => it.pageId !== p.id);
    renderAll(); record();
  }

  /* ---------- Инструменты ---------- */

  function setTool(k) {
    tool = k;
    toolBtns.forEach(b => b.classList.toggle('on', b.dataset.tool === k));
    hint.textContent = ED_HINTS[k];
    pagesBox.dataset.tool = k;
    if (k === 'image') { pending = null; imgInput.click(); }
    if (k === 'sign') {
      pending = null;
      signatureDialog((src, ratio) => { pending = { src, ratio }; hint.textContent = 'Кликните на странице, куда поставить подпись.'; });
    }
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

  const toPt = (p, e) => {
    const r = pageDom.get(p.id).overlay.getBoundingClientRect(), { W, H } = size(p);
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };

  function onOverlayDown(p, e) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    if (tool === 'select') return select(null);
    const pt = toPt(p, e);
    if (ED_DRAG.has(tool)) return startDraw(p, e, pt);
    placeAt(p, pt);
  }

  function textItem(p, pt, text, size, w) {
    return { id: ++seq, pageId: p.id, type: 'text', x: pt.x, y: pt.y - size * 0.6, w, h: size * 1.3, text, size, color: style.color, font: style.font, bold: style.bold, opacity: style.opacity };
  }

  function placeAt(p, pt) {
    const { W } = size(p);
    let it;
    if (tool === 'text') it = textItem(p, pt, '', style.size, Math.min(W - pt.x, style.size * 14));
    else if (tool === 'check' || tool === 'cross') { it = textItem(p, { x: pt.x - 9, y: pt.y + 1 }, tool === 'check' ? '✓' : '✗', 18, 22); it.h = 24; }
    else if (tool === 'date') it = textItem(p, pt, new Date().toLocaleDateString('ru-RU'), style.size, style.size * 6.5);
    else if (tool === 'image' || tool === 'sign') {
      if (!pending) return;
      const w = tool === 'sign' ? Math.min(160, W / 3) : Math.min(220, W / 2.5);
      it = { id: ++seq, pageId: p.id, type: 'image', x: pt.x - w / 2, y: pt.y - w / pending.ratio / 2, w, h: w / pending.ratio, src: pending.src, opacity: 100 };
    }
    if (!it) return;
    items.push(it);
    mountItem(it, tool === 'text');
    select(it);
    record();
    if (!['check', 'cross', 'date'].includes(tool)) setTool('select');
  }

  function startDraw(p, e, start) {
    const overlay = pageDom.get(p.id).overlay;
    const it = { id: ++seq, pageId: p.id, type: tool, x: start.x, y: start.y, w: 1, h: 1, color: tool === 'highlight' ? style.fill : style.color, width: style.width, opacity: style.opacity, fill: style.filled ? style.fill : null };
    const abs = tool === 'pen' ? [[start.x, start.y]] : [[start.x, start.y], [start.x, start.y]];
    const fit = () => {
      if (it.type === 'pen' || it.type === 'line' || it.type === 'arrow') {
        const xs = abs.map(a => a[0]), ys = abs.map(a => a[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        it.x = x0; it.y = y0; it.w = Math.max(1, Math.max(...xs) - x0); it.h = Math.max(1, Math.max(...ys) - y0);
        it.pts = abs.map(([x, y]) => [(x - x0) / it.w, (y - y0) / it.h]);
      } else {
        const [a, b] = abs;
        it.x = Math.min(a[0], b[0]); it.y = Math.min(a[1], b[1]); it.w = Math.max(1, Math.abs(a[0] - b[0])); it.h = Math.max(1, Math.abs(a[1] - b[1]));
      }
    };
    fit();
    items.push(it);
    mountItem(it);
    overlay.setPointerCapture(e.pointerId);
    const move = ev => {
      const pt = toPt(p, ev);
      if (it.type === 'pen') abs.push([pt.x, pt.y]); else abs[1] = [pt.x, pt.y];
      fit();
      updateNode(it);
    };
    const up = () => {
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      overlay.removeEventListener('pointercancel', up);
      const tiny = it.w < 4 && it.h < 4;
      if (tiny) {
        if (it.type === 'pen') { items = items.filter(x => x !== it); nodes.get(it.id)?.remove(); return; }
        const def = { rect: [120, 60], ellipse: [90, 60], highlight: [140, 16], whiteout: [110, 22], line: [120, 1], arrow: [120, 1] }[it.type];
        it.x = start.x - def[0] / 2; it.y = start.y - def[1] / 2; it.w = def[0]; it.h = def[1];
        if (it.pts) it.pts = [[0, 0.5], [1, 0.5]];
      }
      updateNode(it);
      select(it);
      record();
    };
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
    overlay.addEventListener('pointercancel', up);
  }

  /* ---------- Элементы ---------- */

  function placeNode(it) {
    const n = nodes.get(it.id), { W, H } = size(pages[pageIndex(it.pageId)]);
    n.style.left = `${it.x / W * 100}%`; n.style.top = `${it.y / H * 100}%`;
    n.style.width = `${it.w / W * 100}%`; n.style.height = `${it.h / H * 100}%`;
  }

  function updateNode(it) {
    const n = nodes.get(it.id);
    if (!n) return;
    placeNode(it);
    if (ED_SHAPES.has(it.type)) n.querySelector('.ed-shape').innerHTML = shapeSvg(it);
    else if (it.type === 'text') {
      const t = n.querySelector('.ed-text');
      t.style.setProperty('--fs', it.size);
      t.style.color = it.color; t.style.fontFamily = ED_CSS_FONT[it.font || 'sans']; t.style.fontWeight = it.bold ? 700 : 400;
      t.style.opacity = (it.opacity ?? 100) / 100;
    } else if (it.type === 'image') n.querySelector('img').style.opacity = (it.opacity ?? 100) / 100;
  }

  function mountItem(it, focus) {
    const dom = pageDom.get(it.pageId);
    if (!dom) return;
    const n = el('div', { class: `ed-item ed-type-${it.type}`, tabindex: 0 });
    nodes.set(it.id, n);
    if (it.type === 'text') {
      const t = el('div', { class: 'ed-text', contenteditable: 'true', spellcheck: 'false' }, it.text);
      let before = it.text;
      t.addEventListener('focus', () => { before = it.text; });
      t.addEventListener('input', () => {
        it.text = t.innerText.replace(/\n$/, '');
        const k = dom.overlay.clientWidth / size(dom.p).W;
        it.h = Math.max(it.size * 1.3, t.scrollHeight / k);
        placeNode(it);
      });
      t.addEventListener('blur', () => {
        if (!it.text.trim()) { removeItem(it, false); record(); }
        else if (it.text !== before) record();
      });
      n.append(t, el('span', { class: 'ed-move', title: 'Перетащить', 'aria-hidden': 'true' }, '⠿'));
    } else if (it.type === 'image') n.append(el('img', { src: it.src, alt: '', draggable: 'false' }));
    else n.append(el('div', { class: 'ed-shape' }));
    const handle = el('span', { class: 'ed-resize', 'aria-hidden': 'true' });
    const del = el('button', { class: 'ed-del', type: 'button', 'aria-label': 'Удалить', onclick: () => { removeItem(it); record(); } }, '×');
    n.append(handle, del);
    dom.overlay.append(n);
    updateNode(it);
    if (focus) n.querySelector('.ed-text').focus();

    const drag = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      select(it);
      const r = dom.overlay.getBoundingClientRect(), k = size(dom.p).W / r.width;
      const sx = e.clientX, sy = e.clientY, o = { x: it.x, y: it.y, w: it.w, h: it.h };
      let moved = false;
      const move = ev => {
        const dx = (ev.clientX - sx) * k, dy = (ev.clientY - sy) * k;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
        if (mode === 'move') { it.x = o.x + dx; it.y = o.y + dy; }
        else { it.w = Math.max(6, o.w + dx); it.h = it.type === 'image' ? it.w * o.h / o.w : Math.max(it.type === 'line' || it.type === 'arrow' ? 1 : 6, o.h + dy); }
        updateNode(it);
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) record(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    handle.addEventListener('pointerdown', e => drag(e, 'resize'));
    n.addEventListener('pointerdown', e => {
      if (e.target === del) return;
      if (e.target.classList.contains('ed-text') && document.activeElement === e.target) { select(it); return; }
      drag(e, 'move');
    });
    n.addEventListener('dblclick', () => n.querySelector('.ed-text')?.focus());
  }

  function removeItem(it) {
    items = items.filter(x => x !== it);
    nodes.get(it.id)?.remove();
    nodes.delete(it.id);
    if (selected === it) selected = null;
  }

  function select(it) {
    selected = it;
    nodes.forEach((n, id) => n.classList.toggle('sel', !!it && id === it.id));
    if (!it) return;
    if (it.color) ctl.color.value = it.type === 'highlight' ? ctl.color.value : it.color;
    if (it.type === 'highlight') ctl.fill.value = it.color;
    if (it.width) ctl.width.value = it.width;
    if (it.opacity) ctl.opacity.value = it.opacity;
    if (it.type === 'rect' || it.type === 'ellipse') { ctl.filled.checked = !!it.fill; if (it.fill) ctl.fill.value = it.fill; }
    if (it.type === 'text') { ctl.size.value = it.size; ctl.font.value = it.font || 'sans'; ctl.bold.setAttribute('aria-pressed', String(!!it.bold)); ctl.bold.classList.toggle('on', !!it.bold); }
  }

  /* Изменения на панели стиля применяются к выделенному элементу и к новым */
  function applyStyle() {
    style.color = ctl.color.value; style.fill = ctl.fill.value; style.filled = ctl.filled.checked;
    style.width = Number(ctl.width.value); style.opacity = Number(ctl.opacity.value);
    style.size = Math.max(6, Number(ctl.size.value) || 14); style.font = ctl.font.value;
    style.bold = ctl.bold.getAttribute('aria-pressed') === 'true';
    const it = selected;
    if (!it || !items.includes(it)) return;
    if (it.type === 'highlight') it.color = style.fill;
    else if (it.type !== 'image' && it.type !== 'whiteout') it.color = style.color;
    if (ED_SHAPES.has(it.type)) it.width = style.width;
    it.opacity = style.opacity;
    if (it.type === 'rect' || it.type === 'ellipse') it.fill = style.filled ? style.fill : null;
    if (it.type === 'text') {
      const scale = style.size / it.size;
      it.size = style.size; it.font = style.font; it.bold = style.bold;
      it.h *= scale; if (it.text.length > 1) it.w *= scale;
    }
    updateNode(it);
  }
  for (const c of Object.values(ctl)) {
    if (c === ctl.bold) continue;
    c.addEventListener('input', applyStyle);
    c.addEventListener('change', () => { applyStyle(); if (selected) record(); });
  }
  ctl.bold.addEventListener('click', () => {
    const on = ctl.bold.getAttribute('aria-pressed') !== 'true';
    ctl.bold.setAttribute('aria-pressed', String(on)); ctl.bold.classList.toggle('on', on);
    applyStyle(); if (selected) record();
  });
  zoomSel.addEventListener('change', () => { zoom = Number(zoomSel.value); renderAll(); });

  const onKey = e => {
    if (!root.isConnected) return removeEventListener('keydown', onKey);
    if (bar.hidden) return;
    const editing = e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !editing) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y' && !editing) { e.preventDefault(); return redo(); }
    if (e.key === 'Escape') { if (editing) e.target.blur(); select(null); return setTool('select'); }
    if (editing || !selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(selected); record(); return; }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const copy = { ...structuredClone(selected), id: ++seq, x: selected.x + 12, y: selected.y + 12 };
      items.push(copy); mountItem(copy); select(copy); record(); return;
    }
    const step = e.shiftKey ? 10 : 1, dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (dir) { e.preventDefault(); selected.x += dir[0]; selected.y += dir[1]; updateNode(selected); clearTimeout(onKey.t); onKey.t = setTimeout(record, 400); }
  };
  addEventListener('keydown', onKey);

  /* ---------- Сохранение ---------- */

  saveBtn.addEventListener('click', async () => {
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    try {
      setStatus(status, 'busy', 'Сохраняю…');
      await tick();
      const P = PDFLib, out = await P.PDFDocument.create();
      const libs = {}, outPages = [];
      for (const p of pages) {
        let page;
        if (p.kind === 'pdf') {
          libs[p.doc] = libs[p.doc] || await P.PDFDocument.load(docs[p.doc].bytes, { ignoreEncryption: true });
          [page] = await out.copyPages(libs[p.doc], [p.index]);
          out.addPage(page);
          page.setRotation(P.degrees((p.baseRot + p.rot) % 360));
        } else {
          page = out.addPage([p.w, p.h]);
          if (p.kind === 'image') {
            const img = await out.embedJpg(await (await fetch(p.src)).arrayBuffer());
            const m = 20, k = Math.min((p.w - 2 * m) / img.width, (p.h - 2 * m) / img.height);
            page.drawImage(img, { x: (p.w - img.width * k) / 2, y: (p.h - img.height * k) / 2, width: img.width * k, height: img.height * k });
          }
          page.setRotation(P.degrees(p.rot));
        }
        outPages.push(page);
      }
      const live = items.filter(it => it.type !== 'text' || it.text.trim());
      const fonts = {}, imgs = {};
      for (const it of live.filter(x => x.type === 'text')) {
        const key = `${it.font || 'sans'}${it.bold ? 'B' : ''}`;
        if (!fonts[key]) fonts[key] = await embedCyrFont(out, ED_FONTS[it.font || 'sans'][it.bold ? 1 : 0]);
      }
      for (const it of live) {
        const page = outPages[pageIndex(it.pageId)];
        if (!page) continue;
        const g = pageGeom(page), H = g.H, op = (it.opacity ?? 100) / 100;
        const vis = (x, yTop) => visToBox(g, x, H - yTop);
        const rect = (inset = 0) => visRectToBox(g, it.x + inset, H - (it.y + it.h) + inset, it.x + it.w - inset, H - it.y - inset);
        const col = hexRgb(it.color || '#000000');
        if (it.type === 'text') {
          const font = fonts[`${it.font || 'sans'}${it.bold ? 'B' : ''}`];
          it.text.split('\n').forEach((line, i) => {
            if (line) drawTextVis(page, g, line, { vx: it.x, vy: H - it.y - it.size * (0.946 + i * 1.2), font, size: it.size, color: col, opacity: op });
          });
        } else if (it.type === 'image') {
          if (!imgs[it.src]) {
            const bytes = await (await fetch(it.src)).arrayBuffer();
            imgs[it.src] = it.src.startsWith('data:image/jpeg') ? await out.embedJpg(bytes) : await out.embedPng(bytes);
          }
          drawImageVis(page, g, imgs[it.src], { x0: it.x, y0: H - (it.y + it.h), x1: it.x + it.w, y1: H - it.y, opacity: op });
        } else if (it.type === 'rect') {
          page.drawRectangle({ ...rect(it.width / 2), borderColor: col, borderWidth: it.width, borderOpacity: op, ...(it.fill ? { color: hexRgb(it.fill), opacity: op } : {}) });
        } else if (it.type === 'ellipse') {
          const c = vis(it.x + it.w / 2, it.y + it.h / 2);
          const [rx, ry] = [Math.max(0.5, (it.w - it.width) / 2), Math.max(0.5, (it.h - it.width) / 2)];
          page.drawEllipse({ x: c.x, y: c.y, xScale: g.rot % 180 ? ry : rx, yScale: g.rot % 180 ? rx : ry, borderColor: col, borderWidth: it.width, borderOpacity: op, ...(it.fill ? { color: hexRgb(it.fill), opacity: op } : {}) });
        } else if (it.type === 'highlight') {
          page.drawRectangle({ ...rect(), color: col, opacity: 0.45 * op, blendMode: P.BlendMode.Multiply });
        } else if (it.type === 'whiteout') {
          page.drawRectangle({ ...rect(), color: P.rgb(1, 1, 1) });
        } else {
          const pts = it.pts.map(([u, v]) => [it.x + u * it.w, it.y + v * it.h]);
          const segs = [];
          for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
          if (it.type === 'arrow' && pts.length > 1) segs.push(...arrowHead(pts[pts.length - 2], pts[pts.length - 1], it.width));
          for (const [a, b] of segs) page.drawLine({ start: vis(...a), end: vis(...b), thickness: it.width, color: col, opacity: op, lineCap: P.LineCapStyle.Round });
        }
      }
      status.replaceChildren();
      renderResults(results, {
        files: [{ blob: pdfBlob(await out.save()), name: `${baseName(fileName)}_изменён.pdf` }],
        message: `Страниц: ${pages.length}, добавлено элементов: ${live.length}.`,
      });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
  });
}

tool({
  id: 'edit-pdf', cat: 'pdf', badge: 'Ред', title: 'Редактор PDF',
  desc: 'Текст, фигуры, рисование, подпись, маркер, а также добавление, удаление и поворот страниц.',
  render: root => pdfEditorTool(root, 'text'),
});
tool({
  id: 'sign-pdf', cat: 'pdf', badge: 'Подп', title: 'Подписать PDF',
  desc: 'Нарисуйте, напечатайте или загрузите подпись и поставьте её в документ.',
  render: root => pdfEditorTool(root, 'sign'),
});
