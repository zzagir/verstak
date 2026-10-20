'use strict';

const IMG_HINT = 'JPG, PNG, WEBP, GIF, HEIC, TIFF, BMP, SVG — можно сразу несколько';

function drawImageCanvas(img, w, h, { fill } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Плавное уменьшение в несколько шагов — без «лесенки» при сильном сжатии размеров. */
function downscale(img, w, h, fill) {
  let src = img, sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  while (sw / 2 > w && sh / 2 > h) {
    sw = Math.round(sw / 2); sh = Math.round(sh / 2);
    const step = makeCanvas(sw, sh);
    step.getContext('2d').drawImage(src, 0, 0, sw, sh);
    src = step;
  }
  return drawImageCanvas(src, w, h, { fill });
}

const fillFor = mime => mime === 'image/jpeg' ? '#ffffff' : null;
const sizeNote = (before, after) => {
  const d = Math.round((1 - after / before) * 100);
  return d >= 0 ? `−${d}%` : `+${-d}%`;
};

/* ---------- Умное сжатие: MozJPEG, WebP, PNG-палитра + OxiPNG, качество по SSIM ---------- */

const codecCache = {};
function codec(name) {
  if (!codecCache[name]) {
    const path = { jpeg: 'codecs/jpeg/encode.js', webp: 'codecs/webp/encode.js', oxipng: 'codecs/oxipng/optimise.js' }[name];
    codecCache[name] = import(new URL(ROOT + 'vendor/' + path, location.href).href).then(m => m.default);
    codecCache[name].catch(() => delete codecCache[name]);
  }
  return codecCache[name];
}
const pixels = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

/** Кодирует canvas лучшим доступным кодеком; q — качество 0…100. */
async function encodeBest(canvas, mime, q) {
  try {
    if (mime === 'image/jpeg') return new Blob([await (await codec('jpeg'))(pixels(canvas), { quality: q, progressive: true, optimize_coding: true, trellis_multipass: true, chroma_subsample: q >= 90 ? 1 : 2 })], { type: mime });
    if (mime === 'image/webp') return new Blob([await (await codec('webp'))(pixels(canvas), { quality: q, method: 4 })], { type: mime });
  } catch (e) { console.warn('Кодек недоступен, использую встроенный', e); }
  return canvasBlob(canvas, mime, q / 100);
}

/** PNG: уменьшение палитры (как TinyPNG) с проверкой качества, затем OxiPNG без потерь. */
async function encodePng(canvas, minSsim, refSmall) {
  await loadLib('upng');
  const id = pixels(canvas);
  let best = await canvasBlob(canvas, 'image/png');
  if (minSsim < 1) {
    for (const colors of [256, 128]) {
      const q = new Blob([upngLib.UPNG.encode([id.data.buffer.slice(0)], canvas.width, canvas.height, colors)], { type: 'image/png' });
      if (q.size < best.size && await similarity(refSmall, q) >= minSsim) best = q; else break;
    }
  }
  try {
    const opt = await (await codec('oxipng'))(await best.arrayBuffer(), { level: 2, interlace: false, optimiseAlpha: true });
    if (opt.byteLength < best.size) best = new Blob([opt], { type: 'image/png' });
  } catch (e) { console.warn('OxiPNG недоступен', e); }
  return best;
}

/** Уменьшенная копия в оттенках серого для сравнения. */
function lumaSmall(src, w, h) {
  const k = Math.min(1, 640 / Math.max(w, h));
  const c = makeCanvas(w * k, h * k), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data, y = new Float32Array(c.width * c.height);
  for (let i = 0; i < y.length; i++) y[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { y, w: c.width, h: c.height };
}

/** SSIM по блокам 8×8: 1 — идентично, ≥ 0,98 — разница на глаз не видна. */
function ssim(a, b) {
  const C1 = 6.5025, C2 = 58.5225;
  let sum = 0, n = 0;
  for (let by = 0; by + 8 <= a.h; by += 8) for (let bx = 0; bx + 8 <= a.w; bx += 8) {
    let ma = 0, mb = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (by + y) * a.w + bx + x; ma += a.y[i]; mb += b.y[i]; }
    ma /= 64; mb /= 64;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (by + y) * a.w + bx + x, da = a.y[i] - ma, db = b.y[i] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    n++;
  }
  return n ? sum / n : 1;
}

async function similarity(ref, blob) {
  const bmp = await createImageBitmap(blob);
  const s = ssim(ref, lumaSmall(bmp, bmp.width, bmp.height));
  bmp.close?.();
  return s;
}

/**
 * Подбирает самое низкое качество, при котором картинка визуально не отличается (SSIM ≥ minSsim).
 * Поиск идёт на уменьшенной копии, итоговое кодирование — один раз в полном размере.
 */
async function smartCompress(canvas, mime, minSsim) {
  // PNG-палитра даёт мелкую зернистость, которую SSIM оценивает строже, чем глаз, — порог для PNG ниже
  if (mime === 'image/png') return encodePng(canvas, minSsim - 0.03, lumaSmall(canvas, canvas.width, canvas.height));
  const k = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const proxy = k < 1 ? drawImageCanvas(canvas, canvas.width * k, canvas.height * k) : canvas;
  const ref = lumaSmall(proxy, proxy.width, proxy.height);
  let lo = 35, hi = 92, best = 92;
  while (lo <= hi) {
    const q = (lo + hi) >> 1;
    if (await similarity(ref, await encodeBest(proxy, mime, q)) >= minSsim) { best = q; hi = q - 1; } else lo = q + 1;
  }
  return encodeBest(canvas, mime, best);
}

/** Подбирает качество (и при необходимости уменьшает размеры), чтобы файл уложился в limit байт. */
async function compressToSize(img, w, h, mime, limit, name) {
  let best = null;
  for (let scale = 1, step = 0; step < 8; step++, scale *= 0.8) {
    const c = downscale(img, w * scale, h * scale, fillFor(mime));
    let lo = 5, hi = 95, fit = null;
    for (let it = 0; it < 7; it++) {
      const q = Math.round((lo + hi) / 2);
      const blob = await encodeBest(c, mime, q);
      const r = { blob, name: `${baseName(name)}_сжато.${IMG_EXT[blob.type] || 'jpg'}` };
      if (blob.size <= limit) { fit = r; lo = q; } else hi = q;
      if (!best || blob.size < best.blob.size) best = r;
      if (hi - lo <= 1) break;
    }
    if (fit) return fit;
  }
  return best;
}

fileTool({
  id: 'compress-image', cat: 'image', badge: 'КБ↓', title: 'Сжать изображение',
  desc: 'Уменьшите вес JPG, PNG и WEBP в разы без видимой потери качества.',
  accept: IMG_ACCEPT, multiple: true, hint: IMG_HINT, action: 'Сжать',
  note: 'Сжатие как у iLoveIMG и TinyPNG: JPG кодируется MozJPEG, PNG — с уменьшением палитры и OxiPNG, качество подбирается автоматически так, чтобы разница не была видна. Метаданные EXIF удаляются.',
  options: [
    { id: 'mode', label: 'Сжатие', type: 'select', value: 'smart', choices: [['smart', 'Рекомендуемое — без видимой потери качества'], ['strong', 'Сильное — меньше размер, качество чуть ниже'], ['quality', 'Задать качество вручную'], ['target', 'До нужного размера файла']] },
    { id: 'target', label: 'Файл не больше', type: 'select', value: '500', showIf: v => v.mode === 'target', choices: SIZE_TARGETS,
      hint: 'Удобно для сайтов с ограничением размера: Госуслуги, вузы, анкеты на визу. Точное требование смотрите на нужном сайте.' },
    { id: 'custom', label: 'Свой размер, КБ', type: 'number', min: 10, value: 300, showIf: v => v.mode === 'target' && v.target === 'custom' },
    { id: 'quality', label: 'Качество', type: 'range', min: 10, max: 100, value: 75, unit: '%', showIf: v => v.mode === 'quality' },
    { id: 'format', label: 'Формат', type: 'select', choices: [['same', 'Как у исходного'], ['image/jpeg', 'JPG'], ['image/webp', 'WEBP — обычно меньше всего']] },
    { id: 'max', label: 'Ограничить большую сторону', type: 'select', value: '0', choices: [['0', 'Не менять размер'], ['3840', '3840 px (4K)'], ['2560', '2560 px'], ['1920', '1920 px (Full HD)'], ['1280', '1280 px'], ['800', '800 px']] },
  ],
  async run(files, o, { progress }) {
    const out = [];
    let before = 0, after = 0;
    const limit = o.mode === 'target' ? (o.target === 'custom' ? Math.max(10, o.custom) : Number(o.target)) * 1024 : 0;
    for (const [i, f] of files.entries()) {
      await progress(`Сжимаю ${i + 1} из ${files.length}: ${f.name}`);
      const img = await loadImage(f);
      let mime = o.format === 'same' ? sameMime(f) : o.format;
      const max = Number(o.max), W = img.naturalWidth, H = img.naturalHeight;
      const k = max && Math.max(W, H) > max ? max / Math.max(W, H) : 1;
      let res;
      if (limit) {
        if (mime === 'image/png') mime = 'image/webp';
        res = await compressToSize(img, W * k, H * k, mime, limit, f.name);
        res.note = res.blob.size > limit ? `не удалось уложиться в ${fmtSize(limit)}, получилось ${fmtSize(res.blob.size)}` : `${fmtSize(f.size)} → ${fmtSize(res.blob.size)}, ${sizeNote(f.size, res.blob.size)}`;
        if (f.size <= limit && res.blob.size >= f.size) res = { blob: f, name: f.name, note: 'уже меньше нужного размера, оставлен исходный' };
      } else {
        const c = downscale(img, W * k, H * k, fillFor(mime));
        const blob = o.mode === 'quality'
          ? (mime === 'image/png' ? await encodePng(c, 0.97, lumaSmall(c, c.width, c.height)) : await encodeBest(c, mime, o.quality))
          : await smartCompress(c, mime, o.mode === 'strong' ? 0.965 : 0.985);
        res = { blob, name: `${baseName(f.name)}_сжато.${IMG_EXT[blob.type] || 'jpg'}` };
        if (blob.size >= f.size && k === 1 && blob.type === f.type) res = { blob: f, name: f.name, note: 'уже оптимально сжат, оставлен исходный' };
        else res.note = `${fmtSize(f.size)} → ${fmtSize(blob.size)}, ${sizeNote(f.size, blob.size)}`;
        if (blob.type === 'image/png' && blob.size > f.size * 0.7) res.note += ' · это фото в PNG — в формате JPG или WEBP оно станет в разы меньше';
      }
      before += f.size; after += res.blob.size;
      out.push(res);
    }
    return { files: out, zipName: 'compressed.zip', message: `Всего: ${fmtSize(before)} → ${fmtSize(after)} (${sizeNote(before, after)}).` };
  },
});

fileTool({
  id: 'resize-image', cat: 'image', badge: 'px', title: 'Изменить размер',
  desc: 'Задайте новые размеры в пикселях или процентах.',
  accept: IMG_ACCEPT, multiple: true, hint: IMG_HINT, action: 'Изменить размер',
  options: [
    { id: 'mode', label: 'Способ', type: 'select', choices: [['px', 'В пикселях'], ['pct', 'В процентах']] },
    { id: 'w', label: 'Ширина, px', type: 'number', min: 1, value: 1200, showIf: v => v.mode === 'px' },
    { id: 'h', label: 'Высота, px', type: 'number', min: 1, value: 800, showIf: v => v.mode === 'px' },
    { id: 'keep', label: 'Сохранять пропорции (вписать в рамку)', type: 'checkbox', value: true, showIf: v => v.mode === 'px' },
    { id: 'noUp', label: 'Не увеличивать маленькие изображения', type: 'checkbox', value: true, showIf: v => v.mode === 'px' },
    { id: 'pct', label: 'Масштаб', type: 'range', min: 5, max: 200, value: 50, unit: '%', showIf: v => v.mode === 'pct' },
  ],
  onLoad: async (file, form) => {
    const img = await loadImage(file);
    form.set('w', img.naturalWidth);
    form.set('h', img.naturalHeight);
    URL.revokeObjectURL(img.src);
  },
  async run(files, o, { progress }) {
    const out = [];
    for (const [i, f] of files.entries()) {
      await progress(`Изображение ${i + 1} из ${files.length}`);
      const img = await loadImage(f);
      const W = img.naturalWidth, H = img.naturalHeight;
      let w, h;
      if (o.mode === 'pct') { w = W * o.pct / 100; h = H * o.pct / 100; }
      else {
        if (!(o.w > 0 && o.h > 0)) throw new Error('Укажите ширину и высоту больше нуля.');
        if (o.keep) { const k = Math.min(o.w / W, o.h / H); w = W * k; h = H * k; } else { w = o.w; h = o.h; }
        if (o.noUp && (w > W || h > H)) { w = W; h = H; }
      }
      const mime = sameMime(f);
      const c = w < W ? downscale(img, w, h, fillFor(mime)) : drawImageCanvas(img, w, h, { fill: fillFor(mime) });
      const res = await exportCanvas(c, mime, 0.92, f.name, `_${c.width}x${c.height}`);
      res.note = `${W}×${H} → ${c.width}×${c.height}`;
      out.push(res);
    }
    return { files: out, zipName: 'resized.zip' };
  },
});

tool({
  id: 'crop-image', cat: 'image', badge: 'КАДР', title: 'Обрезать изображение',
  desc: 'Выделите область мышкой или задайте точные размеры в пикселях. Можно сразу несколько фото.',
  render(root) {
    const results = el('div', { class: 'results' });
    const dz = dropzone({ accept: IMG_ACCEPT, multiple: true, label: 'Выберите изображения', hint: 'Одно или несколько — выбранная область применится ко всем', onFiles: start });
    root.append(dz, results);

    async function start(files) {
      await loadLib('cropper');
      let img;
      try { img = await loadImage(files[0]); } catch (e) { return renderResults(results, { message: e.message }); }
      dz.hidden = true;
      const stage = el('div', { class: 'crop-stage' }, el('img', { src: img.src, alt: '' }));
      const ratio = el('select', { id: 'crop-ratio' },
        [['NaN', 'Свободно'], ['1', '1:1 квадрат'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.8', '4:5 Instagram'], ['0.5625', '9:16 сторис'], ['0.75', '3:4 фото на документы']]
          .map(([v, l]) => el('option', { value: v }, l)));
      const num = (id, label) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: 0, step: 1 }));
      const fields = el('div', { class: 'grid-2' }, num('crop-x', 'X, px'), num('crop-y', 'Y, px'), num('crop-w', 'Ширина, px'), num('crop-h', 'Высота, px'));
      const many = files.length > 1;
      const mode = el('select', { id: 'crop-mode' }, el('option', { value: 'rel' }, 'Та же область в процентах — для фото разного размера'), el('option', { value: 'abs' }, 'Те же пиксели'));
      const go = el('button', { class: 'btn primary big', type: 'button' }, many ? `Обрезать ${files.length} ${plural(files.length, ['файл', 'файла', 'файлов'])}` : 'Обрезать');
      const status = el('div', { class: 'status' });
      const work = el('div', { class: 'workspace' },
        el('div', { class: 'ws-files' }, stage, many && el('p', { class: 'hint' }, `Область выбирается на первом фото: ${files[0].name}. Остальные (${files.length - 1}) обрежутся так же.`)),
        el('div', { class: 'ws-side' },
          el('div', { class: 'field' }, el('label', { for: 'crop-ratio' }, 'Пропорции'), ratio),
          fields,
          many && el('div', { class: 'field' }, el('label', { for: 'crop-mode' }, 'Для остальных фото'), mode),
          !many && el('div', { class: 'row' },
            el('button', { class: 'btn', type: 'button', onclick: () => cropper.rotate(-90) }, '↺ 90°'),
            el('button', { class: 'btn', type: 'button', onclick: () => cropper.rotate(90) }, '↻ 90°'),
            el('button', { class: 'btn', type: 'button', onclick: () => cropper.reset() }, 'Сбросить')),
          go, status,
          el('button', { class: 'btn ghost', type: 'button', onclick: () => { cropper.destroy(); work.remove(); results.replaceChildren(); dz.hidden = false; dz.pick(); } }, 'Другие изображения')));
      root.insertBefore(work, results);
      const inputs = ['x', 'y', 'w', 'h'].map(k => $(`#crop-${k}`, work));
      const cropper = new Cropper(stage.firstChild, {
        viewMode: 1, autoCropArea: 0.85, background: false,
        crop: e => {
          const d = e.detail;
          [d.x, d.y, d.width, d.height].forEach((v, i) => { if (document.activeElement !== inputs[i]) inputs[i].value = Math.round(v); });
        },
      });
      inputs.forEach(inp => inp.addEventListener('change', () => {
        const [x, y, width, height] = inputs.map(i => Number(i.value) || 0);
        cropper.setData({ x, y, width, height });
      }));
      ratio.addEventListener('change', () => cropper.setAspectRatio(Number(ratio.value)));
      go.addEventListener('click', async () => {
        go.disabled = true;
        try {
          const out = [];
          const first = sameMime(files[0]);
          out.push(await exportCanvas(cropper.getCroppedCanvas({ imageSmoothingQuality: 'high', fillColor: fillFor(first) || 'transparent' }), first, 0.92, files[0].name, '_обрезано'));
          const d = cropper.getData(true), W0 = img.naturalWidth, H0 = img.naturalHeight;
          for (const [i, f] of files.slice(1).entries()) {
            setStatus(status, 'busy', `Изображение ${i + 2} из ${files.length}`);
            await tick();
            const im = await loadImage(f), W = im.naturalWidth, H = im.naturalHeight;
            const r = mode.value === 'rel'
              ? { x: d.x / W0 * W, y: d.y / H0 * H, w: d.width / W0 * W, h: d.height / H0 * H }
              : { x: d.x, y: d.y, w: Math.min(d.width, W - d.x), h: Math.min(d.height, H - d.y) };
            if (r.w <= 0 || r.h <= 0) continue;
            const c = makeCanvas(r.w, r.h), ctx = c.getContext('2d'), mime = sameMime(f);
            if (fillFor(mime)) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
            ctx.drawImage(im, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
            out.push(await exportCanvas(c, mime, 0.92, f.name, '_обрезано'));
          }
          status.replaceChildren();
          renderResults(results, { files: out, zipName: 'cropped.zip' });
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { setStatus(status, 'error', e.message); }
        finally { go.disabled = false; }
      });
    }
  },
});

const FORMAT_CHOICES = [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WEBP'], ['image/gif', 'GIF'], ['image/bmp', 'BMP'], ['image/tiff', 'TIFF']];

function convertImageTool(id, badge, title, desc, format, accept = IMG_ACCEPT) {
  fileTool({
    id, cat: 'image', badge, title, desc, accept, hint: IMG_HINT, action: 'Конвертировать', zipName: 'converted.zip',
    options: [
      { id: 'format', label: 'В формат', type: 'select', value: format, choices: FORMAT_CHOICES },
      { id: 'quality', label: 'Качество', type: 'range', min: 10, max: 100, value: 90, unit: '%', showIf: v => v.format === 'image/jpeg' || v.format === 'image/webp' },
      { id: 'bg', label: 'Фон вместо прозрачности', type: 'color', value: '#ffffff', showIf: v => v.format === 'image/jpeg' || v.format === 'image/bmp' },
    ],
    async perFile(f, o) {
      const img = await loadImage(f);
      const opaque = o.format === 'image/jpeg' || o.format === 'image/bmp';
      const c = drawImageCanvas(img, img.naturalWidth || 1024, img.naturalHeight || 1024, { fill: opaque ? o.bg : null });
      return [await exportCanvas(c, o.format, o.quality / 100, f.name)];
    },
  });
}

convertImageTool('convert-image', 'PNG', 'Конвертировать формат', 'Переведите изображения в JPG, PNG, WEBP, GIF, BMP или TIFF.', 'image/jpeg');
convertImageTool('heic-to-jpg', 'HEIC', 'HEIC в JPG', 'Откройте фото с iPhone где угодно: переведите HEIC в обычный JPG.', 'image/jpeg', '.heic,.heif,image/heic,image/heif');
convertImageTool('webp-to-jpg', 'WEBP', 'WEBP в JPG', 'Сохраните картинки WEBP из интернета в привычном JPG.', 'image/jpeg', '.webp,image/webp');
convertImageTool('png-to-jpg', 'P→J', 'PNG в JPG', 'Уменьшите вес PNG, переведя его в JPG с белым фоном.', 'image/jpeg', '.png,image/png');
convertImageTool('jpg-to-png', 'J→P', 'JPG в PNG', 'Переведите JPG в PNG без потери качества.', 'image/png', '.jpg,.jpeg,image/jpeg');
convertImageTool('tiff-to-jpg', 'TIF', 'TIFF в JPG', 'Откройте сканы TIFF в любом просмотрщике, переведя их в JPG.', 'image/jpeg', '.tif,.tiff,image/tiff');

fileTool({
  id: 'rotate-image', cat: 'image', badge: '90°', title: 'Повернуть и отразить',
  desc: 'Поверните фото на 90° или отразите по горизонтали и вертикали.',
  accept: IMG_ACCEPT, multiple: true, hint: IMG_HINT, action: 'Применить',
  options: [
    { id: 'angle', label: 'Поворот', type: 'select', value: '90', choices: [['0', 'Без поворота'], ['90', 'На 90° по часовой'], ['270', 'На 90° против часовой'], ['180', 'На 180°']] },
    { id: 'fh', label: 'Отразить по горизонтали', type: 'checkbox' },
    { id: 'fv', label: 'Отразить по вертикали', type: 'checkbox' },
  ],
  async run(files, o, { progress }) {
    const out = [];
    const a = Number(o.angle);
    for (const [i, f] of files.entries()) {
      await progress(`Изображение ${i + 1} из ${files.length}`);
      const img = await loadImage(f);
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = a % 180 ? makeCanvas(h, w) : makeCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(a * Math.PI / 180);
      ctx.scale(o.fh ? -1 : 1, o.fv ? -1 : 1);
      ctx.drawImage(img, -w / 2, -h / 2);
      out.push(await exportCanvas(c, sameMime(f), 0.93, f.name, '_повёрнуто'));
    }
    return { files: out, zipName: 'rotated.zip' };
  },
});

const imageCache = new WeakMap();
const cachedImage = f => { if (!imageCache.has(f)) imageCache.set(f, loadImage(f)); return imageCache.get(f); };

/** Водяной знак: текст или логотип; размеры считаются от ширины фото, поэтому предпросмотр совпадает с результатом. */
async function watermarkCanvas(img, o, maxSide = Infinity) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
  const c = drawImageCanvas(img, W, H);
  const ctx = c.getContext('2d');
  let sw, sh, draw;
  if (o.kind === 'logo') {
    if (!o.logo) throw new Error('Выберите файл логотипа.');
    const logo = await cachedImage(o.logo);
    sw = W * o.logoSize / 100; sh = sw * logo.naturalHeight / logo.naturalWidth;
    draw = () => ctx.drawImage(logo, -sw / 2, -sh / 2, sw, sh);
  } else {
    if (!o.text.trim()) throw new Error('Введите текст водяного знака.');
    const px = Math.max(8, W * o.size / 100);
    ctx.font = `700 ${px}px "Golos Text", "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    sw = ctx.measureText(o.text).width; sh = px;
    draw = () => {
      ctx.fillStyle = o.color;
      if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = px / 6; ctx.shadowOffsetY = px / 14; }
      ctx.fillText(o.text, 0, 0);
    };
  }
  ctx.globalAlpha = o.opacity / 100;
  const pad = Math.max(sh * 0.8, W * 0.02);
  const stamp = (x, y, angle = 0) => { ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); draw(); ctx.restore(); };
  if (o.pos === 'tile') {
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(o.angle * Math.PI / 180);
    const d = Math.hypot(W, H), sx = sw + sh * 2.5, sy = sh * 3.2;
    for (let y = -d / 2, row = 0; y < d / 2; y += sy, row++) for (let x = -d / 2 + (row % 2) * sx / 2; x < d / 2; x += sx) stamp(x, y);
    ctx.restore();
  } else if (o.pos === 'c') stamp(W / 2, H / 2, o.angle);
  else stamp(o.pos[1] === 'r' ? W - pad - sw / 2 : pad + sw / 2, o.pos[0] === 'b' ? H - pad - sh / 2 : pad + sh / 2);
  return c;
}

fileTool({
  id: 'watermark-image', cat: 'image', badge: '©WM', title: 'Водяной знак на фото',
  desc: 'Подпишите фото текстом или поставьте логотип. Результат видно сразу.',
  accept: IMG_ACCEPT, hint: IMG_HINT, action: 'Добавить водяной знак', zipName: 'watermarked.zip',
  options: [
    { id: 'kind', label: 'Что нанести', type: 'select', choices: [['text', 'Текст'], ['logo', 'Логотип (картинка)']] },
    { id: 'text', label: 'Текст', value: '© Моя студия', showIf: v => v.kind === 'text' },
    { id: 'logo', label: 'Файл логотипа', type: 'file', accept: 'image/*', hint: 'Лучше всего — PNG с прозрачным фоном', showIf: v => v.kind === 'logo' },
    { id: 'logoSize', label: 'Ширина логотипа', type: 'range', min: 3, max: 60, value: 18, unit: '% фото', showIf: v => v.kind === 'logo' },
    { id: 'size', label: 'Размер текста', type: 'range', min: 1, max: 20, value: 4, unit: '% ширины', showIf: v => v.kind === 'text' },
    { id: 'pos', label: 'Расположение', type: 'select', value: 'br', choices: [['br', 'Справа внизу'], ['bl', 'Слева внизу'], ['tr', 'Справа вверху'], ['tl', 'Слева вверху'], ['c', 'По центру'], ['tile', 'Плиткой по всему фото']] },
    { id: 'opacity', label: 'Непрозрачность', type: 'range', min: 5, max: 100, value: 60, unit: '%' },
    { id: 'angle', label: 'Наклон', type: 'range', min: -90, max: 90, value: -30, unit: '°', showIf: v => v.pos === 'tile' || v.pos === 'c' },
    { id: 'color', label: 'Цвет', type: 'color', value: '#ffffff', showIf: v => v.kind === 'text' },
    { id: 'shadow', label: 'Тень для читаемости', type: 'checkbox', value: true, showIf: v => v.kind === 'text' },
  ],
  async preview(f, o) {
    const c = await watermarkCanvas(await cachedImage(f), o, 900);
    c.className = 'preview-canvas';
    return c;
  },
  async perFile(f, o) {
    await ensureFont('700 40px "Golos Text"');
    return [await exportCanvas(await watermarkCanvas(await cachedImage(f), o), sameMime(f), 0.92, f.name, '_wm')];
  },
});

/* ===================== Удалить фон ===================== */

fileTool({
  id: 'remove-bg', cat: 'image', badge: 'Фон', title: 'Удалить фон',
  desc: 'Нейросеть вырежет человека, товар или животное с фото за несколько секунд.',
  accept: IMG_ACCEPT, hint: IMG_HINT, libs: ['bg'], action: 'Удалить фон', zipName: 'no-background.zip',
  note: 'Нейросеть работает прямо в браузере. Первый запуск загружает модель (~45 МБ), одно фото обрабатывается 5–30 секунд.',
  options: [
    { id: 'bg', label: 'Новый фон', type: 'select', choices: [['none', 'Прозрачный — PNG'], ['white', 'Белый — JPG'], ['color', 'Свой цвет — JPG']] },
    { id: 'color', label: 'Цвет фона', type: 'color', value: '#dfe8f5', showIf: v => v.bg === 'color' },
  ],
  async perFile(f, o, { progress }) {
    const src = await toBrowserImage(f);
    const blob = await imglyBg.removeBackground(src, {
      publicPath: new URL(ROOT + 'vendor/bg/', location.href).href,
      model: 'small', output: { format: 'image/png' },
      progress: (key, cur, total) => { progress(key.startsWith('fetch') ? `Загружаю нейросеть: ${Math.round(cur / total * 100)}%` : 'Вырезаю фон…'); },
    });
    if (o.bg === 'none') return [{ blob, name: `${baseName(f.name)}_без-фона.png` }];
    const img = await loadImage(new File([blob], 'cut.png', { type: 'image/png' }));
    const c = drawImageCanvas(img, img.naturalWidth, img.naturalHeight, { fill: o.bg === 'white' ? '#ffffff' : o.color });
    return [await exportCanvas(c, 'image/jpeg', 0.93, f.name, '_новый-фон')];
  },
});

/* ===================== Размыть лица ===================== */

let faceDetectorReady = null;

function drawFaceEffects(ctx, img, boxes, o, k) {
  ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const b of boxes) {
    if (!b.on) continue;
    const ex = b.w * o.expand / 100, ey = b.h * o.expand / 100;
    const x = (b.x - ex) * k, y = (b.y - ey * 1.3) * k, w = (b.w + 2 * ex) * k, h = (b.h + 2.3 * ey) * k;
    ctx.save();
    ctx.beginPath();
    if (o.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h);
    ctx.clip();
    if (o.mode === 'blur') {
      ctx.filter = `blur(${Math.max(2, w * o.strength / 300)}px)`;
      ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
    } else if (o.mode === 'pixel') {
      const block = Math.max(3, w * o.strength / 400);
      const t = makeCanvas(w / block, h / block);
      t.getContext('2d').drawImage(ctx.canvas, x, y, w, h, 0, 0, t.width, t.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h);
    } else { ctx.fillStyle = '#111'; ctx.fill(); }
    ctx.restore();
  }
}

tool({
  id: 'blur-faces', cat: 'image', badge: 'ЛИЦ', title: 'Размыть лица',
  desc: 'Найдите лица на фото автоматически и размойте или запикселизируйте их.',
  render(root) {
    const results = el('div', { class: 'results' });
    singleImageTool(root, {
      async onImage(img, file, again) {
        const status = el('div', { class: 'status' });
        root.append(status);
        setStatus(status, 'busy', 'Ищу лица…');
        let boxes = [];
        try {
          await loadLib('faceapi');
          if (!faceDetectorReady) {
            faceDetectorReady = (async () => {
              for (const backend of ['webgl', 'cpu']) {
                try { if (await faceapi.tf.setBackend(backend)) break; } catch { /* следующий вариант */ }
              }
              await faceapi.tf.ready();
            })();
          }
          await faceDetectorReady;
          if (!faceapi.nets.tinyFaceDetector.isLoaded) await faceapi.nets.tinyFaceDetector.loadFromUri(ROOT + 'vendor/face');
          const dets = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }));
          boxes = dets.map(d => ({ x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height, on: true }));
        } catch (e) { console.error(e); }
        status.remove();
        const canvas = el('canvas', { class: 'preview-canvas pick' });
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
        const form = buildForm('faces', [
          { id: 'mode', label: 'Эффект', type: 'select', choices: [['blur', 'Размытие'], ['pixel', 'Пикселизация'], ['black', 'Чёрная заливка']] },
          { id: 'strength', label: 'Сила', type: 'range', min: 10, max: 100, value: 60, unit: '%', showIf: v => v.mode !== 'black' },
          { id: 'shape', label: 'Форма', type: 'select', choices: [['ellipse', 'Овал'], ['rect', 'Прямоугольник']] },
          { id: 'expand', label: 'Захватить вокруг лица', type: 'range', min: 0, max: 60, value: 15, unit: '%' },
        ]);
        const info = el('p', { class: 'hint' });
        const draw = () => {
          const ctx = canvas.getContext('2d');
          drawFaceEffects(ctx, img, boxes, form.values(), k);
          ctx.lineWidth = 2;
          for (const b of boxes) { ctx.strokeStyle = b.on ? '#2c4bd8' : '#c8402c'; ctx.setLineDash(b.on ? [] : [6, 4]); ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k); }
          ctx.setLineDash([]);
          info.textContent = `Найдено лиц: ${boxes.length}. Кликните по рамке, чтобы выключить или включить её. Не нашлось лицо — обведите его мышкой.`;
        };
        let start = null;
        const at = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * canvas.width / k, y: (e.clientY - r.top) / r.height * canvas.height / k }; };
        canvas.addEventListener('pointerdown', e => { start = at(e); canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointerup', e => {
          if (!start) return;
          const p = at(e), w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
          if (w * k < 8 && h * k < 8) {
            const hit = boxes.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
            if (hit) hit.on = !hit.on;
          } else boxes.push({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w, h, on: true });
          start = null;
          draw();
        });
        form.el.addEventListener('input', draw);
        form.el.addEventListener('change', draw);
        draw();
        const save = el('button', { class: 'btn primary big', type: 'button' }, 'Сохранить фото');
        save.addEventListener('click', async () => {
          const full = makeCanvas(img.naturalWidth, img.naturalHeight);
          drawFaceEffects(full.getContext('2d'), img, boxes, form.values(), 1);
          renderResults(results, { files: [await exportCanvas(full, sameMime(file), 0.92, file.name, '_лица-скрыты')] });
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        root.append(el('div', { class: 'workspace' },
          el('div', { class: 'ws-files' }, canvas, info),
          el('div', { class: 'ws-side' }, form.el,
            el('button', { class: 'btn', type: 'button', onclick: () => { boxes = []; draw(); } }, 'Убрать все рамки'), save,
            el('button', { class: 'btn ghost', type: 'button', onclick: e => { e.target.closest('.workspace').remove(); results.replaceChildren(); again(); } }, 'Другое фото'))),
          results);
      },
    });
  },
});

/* ===================== GIF из картинок ===================== */

fileTool({
  id: 'gif-maker', cat: 'image', badge: 'GIF', title: 'Создать GIF',
  desc: 'Соберите анимированный GIF из нескольких фото или кадров.',
  accept: IMG_ACCEPT, multiple: true, sortable: true, minFiles: 2, libs: ['gifenc'], action: 'Создать GIF',
  hint: 'Кадры пойдут в порядке списка',
  options: [
    { id: 'delay', label: 'Длительность кадра', type: 'range', min: 50, max: 3000, step: 50, value: 600, unit: ' мс' },
    { id: 'width', label: 'Ширина', type: 'select', value: '480', choices: [['240', '240 px'], ['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['0', 'Как у первого кадра']] },
    { id: 'fit', label: 'Если кадры разного размера', type: 'select', choices: [['contain', 'Вписать целиком, добавить поля'], ['cover', 'Заполнить кадр, обрезав края']] },
    { id: 'bg', label: 'Цвет полей', type: 'color', value: '#ffffff', showIf: v => v.fit === 'contain' },
    { id: 'loop', label: 'Повторять бесконечно', type: 'checkbox', value: true },
  ],
  async run(files, o, { progress }) {
    const imgs = [];
    for (const [i, f] of files.entries()) { await progress(`Читаю кадр ${i + 1} из ${files.length}`); imgs.push(await loadImage(f)); }
    const W = Number(o.width) || imgs[0].naturalWidth;
    const H = Math.round(W * imgs[0].naturalHeight / imgs[0].naturalWidth);
    const frames = imgs.map(img => {
      const c = makeCanvas(W, H), ctx = c.getContext('2d');
      ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
      const s = (o.fit === 'cover' ? Math.max : Math.min)(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      return c;
    });
    await progress('Собираю анимацию…');
    const blob = await encodeGIF(frames, { delay: o.delay, loop: o.loop ? 0 : -1 });
    return { files: [{ blob, name: 'animation.gif' }], message: `${frames.length} ${plural(frames.length, ['кадр', 'кадра', 'кадров'])}, ${W}×${H} px, ${(frames.length * o.delay / 1000).toFixed(1).replace('.', ',')} с.` };
  },
});

/* ===================== Пипетка и палитра ===================== */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Палитра методом медианного разреза. */
function medianCut(pixels, count) {
  let boxes = [pixels];
  while (boxes.length < count) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > best) { best = hi - lo; bi = i; ch = c; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]);
    boxes.splice(bi, 1, b.slice(0, b.length >> 1), b.slice(b.length >> 1));
  }
  return boxes.filter(b => b.length).map(b => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return { rgb: s.map(v => Math.round(v / b.length)), share: b.length / pixels.length };
  }).sort((a, b) => b.share - a.share);
}

function colorRow(r, g, b, extra) {
  const values = [toHex(r, g, b), `rgb(${r}, ${g}, ${b})`, rgbToHsl(r, g, b)];
  return el('div', { class: 'color-row' },
    el('span', { class: 'swatch', style: `background:${values[0]}` }),
    el('div', { class: 'color-values' }, values.map(v => el('button', { class: 'chip mono', type: 'button', title: 'Скопировать', onclick: async e => { await copyText(v); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = v), 1200); } }, v))),
    extra && el('span', { class: 'muted' }, extra));
}

tool({
  id: 'color-picker', cat: 'image', badge: 'HEX', title: 'Пипетка и палитра',
  desc: 'Узнайте цвет любой точки фото и получите палитру основных цветов в HEX, RGB и HSL.',
  render(root) {
    if ('EyeDropper' in window) {
      const picked = el('div');
      root.append(el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', onclick: async () => {
          try {
            const { sRGBHex } = await new EyeDropper().open();
            const n = parseInt(sRGBHex.slice(1), 16);
            picked.replaceChildren(colorRow(n >> 16, n >> 8 & 255, n & 255, 'цвет с экрана'));
          } catch { /* отмена */ }
        } }, 'Взять цвет с экрана'),
        el('span', { class: 'muted' }, 'или загрузите изображение')), picked);
    }
    singleImageTool(root, {
      onImage(img, file, again) {
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = drawImageCanvas(img, img.naturalWidth * k, img.naturalHeight * k);
        canvas.className = 'preview-canvas pick';
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const pickedBox = el('div', { class: 'picked' }, el('p', { class: 'hint' }, 'Кликните по фото, чтобы узнать цвет точки.'));
        const paletteBox = el('div', { class: 'palette' });
        const count = el('select', { id: 'pal-count' }, [5, 8, 12, 16].map(n => el('option', { value: n }, `${n} цветов`)));
        count.value = '8';
        const small = drawImageCanvas(img, 120, Math.max(1, Math.round(120 * img.naturalHeight / img.naturalWidth)));
        const d = small.getContext('2d').getImageData(0, 0, small.width, small.height).data, px = [];
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
        const drawPalette = () => {
          const pal = medianCut(px.slice(), Number(count.value));
          paletteBox.replaceChildren(
            el('div', { class: 'palette-strip' }, pal.map(p => el('span', { style: `background:${toHex(...p.rgb)}; flex:${Math.max(p.share, 0.02)}` }))),
            ...pal.map(p => colorRow(...p.rgb, `${Math.round(p.share * 100)}%`)));
        };
        count.addEventListener('change', drawPalette);
        drawPalette();
        canvas.addEventListener('click', e => {
          const r = canvas.getBoundingClientRect();
          const [R, G, B] = ctx.getImageData(Math.floor((e.clientX - r.left) / r.width * canvas.width), Math.floor((e.clientY - r.top) / r.height * canvas.height), 1, 1).data;
          pickedBox.replaceChildren(colorRow(R, G, B, 'выбранная точка'));
        });
        root.append(el('div', { class: 'workspace' },
          el('div', { class: 'ws-files' }, canvas, pickedBox),
          el('div', { class: 'ws-side' }, el('div', { class: 'field' }, el('label', { for: 'pal-count' }, 'Палитра'), count), paletteBox,
            el('button', { class: 'btn ghost', type: 'button', onclick: e => { e.target.closest('.workspace').remove(); again(); } }, 'Другое изображение'))));
      },
    });
  },
});

/* ===================== Изображение ↔ Base64 ===================== */

tool({
  id: 'image-base64', cat: 'image', badge: 'B64', title: 'Изображение в Base64',
  desc: 'Получите Data URI для HTML и CSS или превратите строку Base64 обратно в картинку.',
  render(root) {
    const out = el('div', { class: 'b64-out' });
    const dz = dropzone({ accept: 'image/*', label: 'Картинка → Base64', hint: 'PNG, JPG, SVG, GIF, WEBP, ICO', onFiles: async ([f]) => {
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const snippets = [['Data URI', url], ['Только Base64', url.split(',')[1]], ['HTML', `<img src="${url}" alt="">`], ['CSS', `background-image: url("${url}");`]];
      out.replaceChildren(el('div', { class: 'row' }, el('img', { src: url, alt: '', class: 'thumb big' }), el('span', { class: 'muted' }, `${f.name}: ${fmtSize(f.size)} → ${fmtSize(url.length)} текста`)),
        ...snippets.map(([label, v], i) => {
          const ta = el('textarea', { id: `b64-s${i}`, class: 'text-out mono', rows: 3, readonly: true, value: v });
          return el('div', { class: 'field' }, el('label', { for: ta.id }, label), ta, el('div', { class: 'row' }, copyButton(() => ta.value, ta)));
        }));
    } });
    const back = el('textarea', { id: 'b64-in', class: 'text-in mono', rows: 5, placeholder: 'data:image/png;base64,iVBORw0KGgo… или просто iVBORw0KGgo…' });
    const prev = el('div', { class: 'b64-prev' });
    back.addEventListener('input', () => {
      let v = back.value.trim().replace(/\s+/g, '');
      if (!v) return prev.replaceChildren();
      if (!v.startsWith('data:')) {
        const mime = v.startsWith('/9j/') ? 'image/jpeg' : v.startsWith('R0lGOD') ? 'image/gif' : v.startsWith('UklGR') ? 'image/webp' : v.startsWith('PHN2Zy') || v.startsWith('PD94') ? 'image/svg+xml' : 'image/png';
        v = `data:${mime};base64,${v}`;
      }
      const img = el('img', { src: v, alt: 'Предпросмотр', class: 'preview-canvas' });
      img.onerror = () => prev.replaceChildren(el('p', { class: 'status-msg error' }, 'Это не похоже на картинку в Base64. Проверьте, что строка скопирована целиком.'));
      img.onload = () => prev.replaceChildren(img, el('div', { class: 'row' }, el('span', { class: 'muted' }, `${img.naturalWidth} × ${img.naturalHeight} px`),
        el('button', { class: 'btn primary', type: 'button', onclick: async () => { const b = await (await fetch(v)).blob(); download(b, `image.${IMG_EXT[b.type] || (b.type === 'image/svg+xml' ? 'svg' : 'png')}`); } }, 'Скачать картинку')));
    });
    root.append(el('div', { class: 'two-col' },
      el('section', { class: 'card-pad' }, el('h2', { class: 'h3' }, 'Картинка → Base64'), dz, out),
      el('section', { class: 'card-pad' }, el('h2', { class: 'h3' }, 'Base64 → картинка'), el('label', { for: 'b64-in', class: 'block-label' }, 'Вставьте строку'), back, prev)));
  },
});

/* ===================== Фото на документы ===================== */

const DOC_SIZES = [
  ['35x45', 35, 45, '3,5 × 4,5 см — паспорт РФ, загранпаспорт, шенген'],
  ['30x40', 30, 40, '3 × 4 см — пропуск, студенческий, военный билет'],
  ['25x35', 25, 35, '2,5 × 3,5 см — удостоверения'],
  ['40x60', 40, 60, '4 × 6 см — личное дело'],
  ['50x50', 50, 50, '5 × 5 см — виза США'],
  ['90x120', 90, 120, '9 × 12 см — личное дело, крупный формат'],
];

tool({
  id: 'doc-photo', cat: 'image', badge: '3×4', title: 'Фото на документы',
  desc: 'Обрежьте фото под 3×4, 3,5×4,5 и другие размеры и разложите копии на лист для печати.',
  render(root) {
    const results = el('div', { class: 'results' });
    singleImageTool(root, {
      label: 'Выберите портретное фото',
      async onImage(img, file, again) {
        await loadLib('cropper');
        const stage = el('div', { class: 'crop-stage' }, el('img', { src: img.src, alt: '' }));
        const form = buildForm('docph', [
          { id: 'size', label: 'Размер фото', type: 'select', choices: DOC_SIZES.map(([v, , , l]) => [v, l]) },
          { id: 'sheet', label: 'Лист для печати', type: 'select', choices: [['10x15', 'Фотобумага 10 × 15 см'], ['a4', 'Лист A4'], ['none', 'Без листа — только одно фото']] },
          { id: 'gray', label: 'Чёрно-белое', type: 'checkbox' },
          { id: 'lines', label: 'Линии для разрезания', type: 'checkbox', value: true },
        ]);
        const sz = () => DOC_SIZES.find(s => s[0] === form.values().size);
        form.el.addEventListener('change', () => cropper.setAspectRatio(sz()[1] / sz()[2]));
        const go = el('button', { class: 'btn primary big', type: 'button' }, 'Сделать фото');
        root.append(el('div', { class: 'workspace' },
          el('div', { class: 'ws-files' }, stage, el('p', { class: 'hint' }, 'Расположите рамку так, чтобы лицо занимало около 70–80% высоты, а над головой осталось немного места.')),
          el('div', { class: 'ws-side' }, form.el, go,
            el('button', { class: 'btn ghost', type: 'button', onclick: e => { cropper.destroy(); e.target.closest('.workspace').remove(); results.replaceChildren(); again(); } }, 'Другое фото'))),
          results);
        const cropper = new Cropper(stage.firstChild, { viewMode: 1, aspectRatio: sz()[1] / sz()[2], autoCropArea: 0.7, background: false });
        go.addEventListener('click', async () => {
          const o = form.values(), [, mw, mh] = sz(), dpmm = 300 / 25.4;
          const photo = cropper.getCroppedCanvas({ width: Math.round(mw * dpmm), height: Math.round(mh * dpmm), imageSmoothingQuality: 'high', fillColor: '#fff' });
          if (o.gray) { const g = photo.getContext('2d'); g.filter = 'grayscale(1)'; g.drawImage(photo, 0, 0); }
          const files = [await exportCanvas(photo, 'image/jpeg', 0.95, `фото_${o.size}`, '')];
          if (o.sheet !== 'none') {
            const [SW, SH] = o.sheet === 'a4' ? [210, 297] : [102, 152];
            const gap = 3, margin = 5;
            const cols = Math.floor((SW - 2 * margin + gap) / (mw + gap)), rows = Math.floor((SH - 2 * margin + gap) / (mh + gap));
            const sheet = makeCanvas(SW * dpmm, SH * dpmm), ctx = sheet.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sheet.width, sheet.height);
            const ox = (SW - cols * mw - (cols - 1) * gap) / 2, oy = (SH - rows * mh - (rows - 1) * gap) / 2;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
              const x = (ox + c * (mw + gap)) * dpmm, y = (oy + r * (mh + gap)) * dpmm;
              ctx.drawImage(photo, x, y, mw * dpmm, mh * dpmm);
              if (o.lines) { ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, mw * dpmm + 4, mh * dpmm + 4); }
            }
            files.push(await exportCanvas(sheet, 'image/jpeg', 0.95, `лист_${o.sheet}_${cols * rows}шт`, ''));
            await loadLib('pdflib');
            const pdf = await PDFLib.PDFDocument.create();
            const jpg = await pdf.embedJpg(await files[1].blob.arrayBuffer());
            pdf.addPage([mm2pt(SW), mm2pt(SH)]).drawImage(jpg, { x: 0, y: 0, width: mm2pt(SW), height: mm2pt(SH) });
            files.push({ blob: pdfBlob(await pdf.save()), name: `лист_${o.sheet}_для-печати.pdf` });
          }
          renderResults(results, { files, zipName: 'foto-na-dokumenty.zip', message: o.sheet !== 'none' ? 'Печатайте PDF в масштабе 100% («Фактический размер»), иначе размер фото изменится.' : '' });
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      },
    });
  },
});

function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

tool({
  id: 'meme-generator', cat: 'image', badge: 'LOL', title: 'Генератор мемов',
  desc: 'Добавьте классические подписи сверху и снизу картинки.',
  render(root) {
    const results = el('div', { class: 'results' });
    singleImageTool(root, {
      label: 'Выберите картинку для мема',
      async onImage(img, file, again) {
        const canvas = el('canvas', { class: 'preview-canvas' });
        const form = buildForm('meme', [
          { id: 'top', label: 'Текст сверху', type: 'textarea', rows: 2, value: 'Когда сжал PDF' },
          { id: 'bottom', label: 'Текст снизу', type: 'textarea', rows: 2, value: 'и он ничего не загрузил на сервер' },
          { id: 'size', label: 'Размер шрифта', type: 'range', min: 4, max: 18, value: 9, unit: '%' },
          { id: 'upper', label: 'ЗАГЛАВНЫМИ БУКВАМИ', type: 'checkbox', value: true },
          { id: 'color', label: 'Цвет текста', type: 'color', value: '#ffffff' },
          { id: 'stroke', label: 'Цвет обводки', type: 'color', value: '#000000' },
        ]);
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        await ensureFont('700 40px "Oswald"');
        const draw = () => {
          const o = form.values(), ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
          ctx.drawImage(img, 0, 0, W, H);
          const px = Math.round(W * o.size / 100);
          ctx.font = `700 ${px}px Oswald, Impact, "Arial Narrow", sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, px / 8);
          ctx.strokeStyle = o.stroke;
          ctx.fillStyle = o.color;
          const put = (text, fromTop) => {
            const lines = wrapLines(ctx, o.upper ? text.toUpperCase() : text, W * 0.92);
            const lh = px * 1.12;
            lines.forEach((ln, i) => {
              const y = fromTop ? px * 0.35 + lh * (i + 1) - px * 0.18 : H - px * 0.45 - lh * (lines.length - 1 - i);
              ctx.strokeText(ln, W / 2, y);
              ctx.fillText(ln, W / 2, y);
            });
          };
          put(o.top, true);
          put(o.bottom, false);
        };
        form.el.addEventListener('input', draw);
        draw();
        const save = el('button', { class: 'btn primary big', type: 'button' }, 'Сохранить мем');
        save.addEventListener('click', async () => {
          renderResults(results, { files: [await exportCanvas(canvas, 'image/jpeg', 0.92, file.name, '_мем')] });
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        root.append(el('div', { class: 'workspace' },
          el('div', { class: 'ws-files' }, canvas),
          el('div', { class: 'ws-side' }, form.el, save,
            el('button', { class: 'btn ghost', type: 'button', onclick: e => { e.target.closest('.workspace').remove(); results.replaceChildren(); again(); } }, 'Другая картинка'))),
          results);
      },
    });
  },
});

const PHOTO_PRESETS = {
  'Исходное': {},
  'Ч/Б': { grayscale: 100, contrast: 110 },
  'Сепия': { sepia: 80, contrast: 105 },
  'Винтаж': { sepia: 35, saturate: 70, contrast: 90, brightness: 105 },
  'Ярко': { saturate: 150, contrast: 115, brightness: 105 },
  'Холодно': { hue: 190, saturate: 80 },
};
const PHOTO_DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, hue: 0, grayscale: 0, sepia: 0, blur: 0, invert: 0 };

tool({
  id: 'photo-editor', cat: 'image', badge: 'FX', title: 'Фоторедактор',
  desc: 'Яркость, контраст, насыщенность, ч/б, сепия и размытие.',
  render(root) {
    const results = el('div', { class: 'results' });
    singleImageTool(root, {
      onImage(img, file, again) {
        const canvas = el('canvas', { class: 'preview-canvas' });
        if (!('filter' in CanvasRenderingContext2D.prototype)) {
          root.append(el('p', { class: 'status-msg error' }, 'Ваш браузер не поддерживает фильтры изображений. Откройте страницу в Chrome, Edge, Firefox или Safari 18+.'));
          return;
        }
        const form = buildForm('photo', [
          { id: 'brightness', label: 'Яркость', type: 'range', min: 0, max: 200, value: 100, unit: '%' },
          { id: 'contrast', label: 'Контраст', type: 'range', min: 0, max: 200, value: 100, unit: '%' },
          { id: 'saturate', label: 'Насыщенность', type: 'range', min: 0, max: 200, value: 100, unit: '%' },
          { id: 'hue', label: 'Оттенок', type: 'range', min: 0, max: 360, value: 0, unit: '°' },
          { id: 'grayscale', label: 'Чёрно-белое', type: 'range', min: 0, max: 100, value: 0, unit: '%' },
          { id: 'sepia', label: 'Сепия', type: 'range', min: 0, max: 100, value: 0, unit: '%' },
          { id: 'blur', label: 'Размытие', type: 'range', min: 0, max: 20, step: 0.5, value: 0, unit: ' px' },
          { id: 'invert', label: 'Негатив', type: 'range', min: 0, max: 100, value: 0, unit: '%' },
        ]);
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        const filter = (o, blurScale) => `brightness(${o.brightness}%) contrast(${o.contrast}%) saturate(${o.saturate}%) hue-rotate(${o.hue}deg) grayscale(${o.grayscale}%) sepia(${o.sepia}%) blur(${o.blur * blurScale}px) invert(${o.invert}%)`;
        const draw = () => {
          const ctx = canvas.getContext('2d');
          ctx.filter = filter(form.values(), 1);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        form.el.addEventListener('input', draw);
        draw();
        const presets = el('div', { class: 'chips' }, Object.entries(PHOTO_PRESETS).map(([name, p]) =>
          el('button', { class: 'chip', type: 'button', onclick: () => { for (const [key, v] of Object.entries({ ...PHOTO_DEFAULTS, ...p })) form.set(key, v); draw(); } }, name)));
        const save = el('button', { class: 'btn primary big', type: 'button' }, 'Сохранить фото');
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            const full = makeCanvas(img.naturalWidth, img.naturalHeight);
            const ctx = full.getContext('2d');
            ctx.filter = filter(form.values(), 1 / k);
            ctx.drawImage(img, 0, 0);
            renderResults(results, { files: [await exportCanvas(full, sameMime(file), 0.92, file.name, '_правка')] });
            results.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } finally { save.disabled = false; }
        });
        root.append(el('div', { class: 'workspace' },
          el('div', { class: 'ws-files' }, canvas, presets),
          el('div', { class: 'ws-side' }, form.el, save,
            el('button', { class: 'btn ghost', type: 'button', onclick: e => { e.target.closest('.workspace').remove(); results.replaceChildren(); again(); } }, 'Другое фото'))),
          results);
      },
    });
  },
});
