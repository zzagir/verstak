'use strict';

/* ===================== Видео и аудио: FFmpeg в браузере ===================== */

const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.mpeg,.mpg,.ogv,.gif';
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.wma,.amr,.aiff,.aif';
const MEDIA_ACCEPT = VIDEO_ACCEPT + ',' + AUDIO_ACCEPT;
const VIDEO_HINT = 'MP4, MOV, WEBM, MKV, AVI, WMV, 3GP и другие';
const VIDEO_NOTE = 'Видео обрабатывается на вашем устройстве. При первом запуске загружается видеодвижок (~32 МБ). Обработка идёт медленнее, чем в программах на компьютере: минута видео в HD — обычно 1–3 минуты.';

const MIME_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', gif: 'image/gif', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', jpg: 'image/jpeg', png: 'image/png' };

/* ---------- Движок ---------- */

let ffState = null;
function ffLoad() {
  if (!ffState) {
    ffState = (async () => {
      await loadLib('ffmpeg');
      const ff = new FFmpegWASM.FFmpeg();
      const base = new URL(ROOT + 'vendor/video/', location.href).href;
      await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
      const font = new Uint8Array(await fontBytes('DejaVuSans.ttf'));
      try { await ff.createDir('/fonts'); } catch { /* уже есть */ }
      await ff.writeFile('/fonts/DejaVuSans.ttf', font);
      return ff;
    })();
    ffState.catch(() => (ffState = null));
  }
  return ffState;
}

/** Останавливает текущую обработку: движок перезапустится при следующей. */
async function ffCancel() {
  if (wcCurrent) { try { await wcCurrent.cancel(); } catch { /* уже завершено */ } wcCurrent = null; }
  if (!ffState) return;
  const p = ffState;
  ffState = null;
  try { (await p).terminate(); } catch { /* уже остановлен */ }
}

let ffQueue = Promise.resolve();
const tsec = s => { const m = String(s).match(/(\d+):(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };

/**
 * Запускает FFmpeg. inputs — [{ name, file | data }], outputs — имена файлов результата.
 * duration — ожидаемая длительность результата для процента выполнения.
 */
function ffRun({ inputs = [], args, outputs = [], outputPrefix = null, duration = 0, progress, label = 'Обработка' }) {
  const job = ffQueue.then(async () => {
    if (progress) await progress('Загружаю видеодвижок…');
    const ff = await ffLoad();
    const logs = [];
    const onLog = ({ message }) => {
      logs.push(message);
      if (logs.length > 400) logs.shift();
      const t = message.match(/time=\s*(\d+:\d+:\d+\.\d+)/);
      if (!t || !progress) return;
      const done = tsec(t[1]), sp = parseFloat((message.match(/speed=\s*([\d.]+)x/) || [])[1]) || 0;
      const fr = (message.match(/frame=\s*(\d+)/) || [])[1];
      const pct = duration ? Math.min(99, Math.floor(done / duration * 100)) : null;
      const left = duration && sp > 0 ? (duration - done) / sp : 0;
      progress([`${label}: ${pct != null ? pct + '%' : fmtTime(done)}`, fr && `кадр ${fr}`, left > 5 && `осталось ~${left > 90 ? Math.round(left / 60) + ' мин' : Math.round(left) + ' с'}`].filter(Boolean).join(' · '));
    };
    ff.on('log', onLog);
    try {
      for (const inp of inputs) {
        if (progress) await progress(`Читаю ${inp.file?.name || inp.name}…`);
        await ff.writeFile(inp.name, inp.data || new Uint8Array(await inp.file.arrayBuffer()));
      }
      if (progress) await progress(`${label}…`);
      const code = await ff.exec(args);
      if (outputPrefix) outputs = (await ff.listDir('/')).filter(e => !e.isDir && e.name.startsWith(outputPrefix)).map(e => e.name).sort();
      const files = [];
      if (code !== 0) {
        const err = logs.filter(l => /error|invalid|failed|not supported|could not|unable|no such|incompatible/i.test(l)).slice(-3).join(' · ');
        throw new Error(`FFmpeg не смог обработать файл${err ? `: ${err}` : '. Возможно, формат не поддерживается.'}`);
      }
      for (const name of outputs) {
        let data;
        try { data = await ff.readFile(name); } catch { data = null; }
        if (!data || !data.length) {
          const err = logs.filter(l => /error|invalid|failed|not supported|could not|unable|no such/i.test(l)).slice(-3).join(' · ');
          throw new Error(code === 0 ? 'Не удалось обработать видео.' : `FFmpeg не смог обработать файл${err ? `: ${err}` : '. Возможно, формат не поддерживается.'}`);
        }
        files.push(data);
      }
      return { files, logs, names: outputs.slice() };
    } catch (e) {
      if (/terminate|called FFmpeg.terminate/i.test(e?.message || '')) throw new Error('Обработка отменена.');
      throw e;
    } finally {
      ff.off('log', onLog);
      if (outputPrefix) { try { for (const e of await ff.listDir('/')) if (!e.isDir && e.name.startsWith(outputPrefix)) await ff.deleteFile(e.name); } catch { /* */ } }
      for (const f of [...inputs.map(i => i.name), ...outputs]) { try { await ff.deleteFile(f); } catch { /* нет файла */ } }
    }
  });
  ffQueue = job.catch(() => {});
  return job;
}

/** Длительность, размер кадра, кодеки, звук — по журналу FFmpeg. */
async function ffProbe(file) {
  const name = 'probe.' + (extOf(file.name) || 'bin');
  const ff = await ffLoad();
  const logs = [];
  const onLog = ({ message }) => logs.push(message);
  ff.on('log', onLog);
  try {
    await ff.writeFile(name, new Uint8Array(await file.arrayBuffer()));
    await ff.exec(['-hide_banner', '-i', name]);
  } finally { ff.off('log', onLog); try { await ff.deleteFile(name); } catch { /* */ } }
  const text = logs.join('\n');
  const v = text.match(/Stream #\d+:\d+[^:]*: Video: ([^\n]+)/), a = text.match(/Stream #\d+:\d+[^:]*: Audio: ([^\n]+)/);
  const size = v && v[1].match(/(\d{2,5})x(\d{2,5})/);
  return {
    duration: tsec((text.match(/Duration: (\d+:\d+:\d+\.\d+)/) || [])[1] || ''),
    bitrate: (text.match(/bitrate: (\d+ kb\/s)/) || [])[1] || '',
    video: v && { codec: v[1].split(/[ ,(]/)[0], width: size ? +size[1] : 0, height: size ? +size[2] : 0, fps: (v[1].match(/([\d.]+) fps/) || [])[1] || '', raw: v[1] },
    audio: a && { codec: a[1].split(/[ ,(]/)[0], rate: (a[1].match(/(\d+) Hz/) || [])[1] || '', channels: (a[1].match(/Hz, ([^,]+)/) || [])[1] || '', raw: a[1] },
    rotation: +((text.match(/rotate\s*:\s*(-?\d+)/) || text.match(/rotation of (-?[\d.]+)/) || [])[1] || 0),
  };
}

/** Быстрая проверка средствами браузера; если не вышло — через FFmpeg. */
async function mediaInfo(file) {
  const quick = await new Promise(res => {
    const isAudio = /^audio\//.test(file.type) || AUDIO_ACCEPT.split(',').includes('.' + extOf(file.name));
    const m = document.createElement(isAudio ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    const done = v => { clearTimeout(t); URL.revokeObjectURL(url); res(v); };
    const t = setTimeout(() => done(null), 6000);
    m.preload = 'metadata';
    m.onloadedmetadata = () => done(isFinite(m.duration) && m.duration > 0 ? { duration: m.duration, width: m.videoWidth || 0, height: m.videoHeight || 0 } : null);
    m.onerror = () => done(null);
    m.src = url;
  });
  if (quick && (quick.width || !/^video\//.test(file.type))) return quick;
  const p = await ffProbe(file);
  return { duration: p.duration, width: p.video?.width || 0, height: p.video?.height || 0, probe: p };
}

/* ---------- Быстрый путь: WebCodecs (кодирование силами видеокарты) через Mediabunny ---------- */

let mbLib = null, wcCurrent = null;
const mediabunny = () => (mbLib = mbLib || import(new URL(ROOT + 'vendor/video/mediabunny.min.mjs', location.href).href).catch(e => { mbLib = null; throw e; }));

/**
 * Перекодирует в MP4 средствами браузера — в разы быстрее FFmpeg.
 * Возвращает null, если браузер или файл не подходят: тогда используется FFmpeg.
 * opts: { height, quality: 'low'|'medium'|'high'|'very-high', bitrate (бит/с), audioKbps | 0 (без звука), crop, rotate, trim }
 */
async function webcodecsMp4(file, opts, progress, label = 'Обработка') {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return null;
  let M;
  try { M = await mediabunny(); } catch { return null; }
  try {
    const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return null;
    const W = vt.displayWidth, H = vt.displayHeight;
    const scale = opts.height && Math.min(W, H) > opts.height ? opts.height / Math.min(W, H) : 1;
    const w = Math.round(W * scale / 2) * 2, h = Math.round(H * scale / 2) * 2;
    const codec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'hevc', 'av1', 'vp8'], { width: w, height: h });
    if (!codec) return null;
    const Q = { low: M.QUALITY_LOW, medium: M.QUALITY_MEDIUM, high: M.QUALITY_HIGH, 'very-high': M.QUALITY_VERY_HIGH }[opts.quality || 'medium'];
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const video = { codec, bitrate: opts.bitrate || Q, forceTranscode: true, hardwareAcceleration: 'no-preference' };
    if (scale !== 1) Object.assign(video, { width: w, height: h, fit: 'fill' });
    if (opts.crop) video.crop = opts.crop;
    if (opts.rotate) video.rotate = opts.rotate;
    const conv = await M.Conversion.init({
      input, output, video,
      audio: opts.audioKbps === 0 ? { discard: true } : { bitrate: (opts.audioKbps || 128) * 1000 },
      ...(opts.trim ? { trim: opts.trim } : {}),
    });
    if (!conv.isValid) return null;
    const t0 = Date.now();
    conv.onProgress = p => {
      const el = (Date.now() - t0) / 1000, left = p > 0.03 ? el / p - el : 0;
      progress([`${label}: ${Math.floor(p * 100)}%`, left > 5 && `осталось ~${left > 90 ? Math.round(left / 60) + ' мин' : Math.round(left) + ' с'}`].filter(Boolean).join(' · '));
    };
    wcCurrent = conv;
    await progress(`${label}: 0%`);
    await conv.execute();
    wcCurrent = null;
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } catch (e) {
    wcCurrent = null;
    if (/cancel/i.test(e?.message || '') || e?.name === 'ConversionCanceledError') throw new Error('Обработка отменена.');
    console.warn('WebCodecs не справился, переключаюсь на FFmpeg', e);
    return null;
  }
}

const outBlob = (data, ext) => new Blob([data], { type: MIME_BY_EXT[ext] || 'application/octet-stream' });
const inName = (f, i = 0) => `in${i}.${extOf(f.name) || 'mp4'}`;
const H264 = (crf = 23, preset = 'veryfast') => ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p'];
const AAC = (kbps = 128) => ['-c:a', 'aac', '-b:a', `${kbps}k`];
const FASTSTART = ['-movflags', '+faststart'];
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
const fmtTime = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${sec.toFixed(1).padStart(4, '0')}`; };
const parseTime = v => { const p = String(v).trim().replace(',', '.').split(':').map(Number); return p.some(isNaN) ? NaN : p.reduce((a, b) => a * 60 + b, 0); };

/** Видео-инструмент на основе обычного: добавляет отмену и пометку о скорости. */
function videoTool(cfg) {
  fileTool({ accept: VIDEO_ACCEPT, hint: VIDEO_HINT, note: VIDEO_NOTE, zipName: 'video.zip', ...cfg, cat: cfg.cat || 'video', cancel: ffCancel });
}

/* ---------- Плеер с выбором фрагмента ---------- */

/**
 * Плеер и шкала с двумя ручками. onReady(api) получает { media, file, info, range() }.
 * Для форматов, которые браузер не показывает, готовит лёгкую копию для предпросмотра.
 */
function mediaEditor(root, { accept = VIDEO_ACCEPT, label, hint = VIDEO_HINT, withRange = true, onReady }) {
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const dz = dropzone({ accept, label: label || 'Выберите видео', hint, onFiles: f => open(f[0]) });
  const stage = el('div', { class: 'media-stage', hidden: true });
  root.append(dz, status, stage);

  async function open(file) {
    stage.replaceChildren(); stage.hidden = true;
    setStatus(status, 'busy', 'Открываю…');
    try {
      const info = await mediaInfo(file);
      const isAudio = !info.width && (/^audio\//.test(file.type) || AUDIO_ACCEPT.split(',').includes('.' + extOf(file.name)));
      let src = URL.createObjectURL(file), proxy = false;
      const media = el(isAudio ? 'audio' : 'video', { class: 'media-view', controls: true, preload: 'auto', playsinline: true, src });
      const playable = await new Promise(res => { media.onloadeddata = () => res(true); media.onerror = () => res(false); setTimeout(() => res(media.readyState >= 2), 8000); });
      if (!playable && !isAudio) {
        setStatus(status, 'busy', 'Браузер не показывает этот формат — готовлю копию для предпросмотра…');
        // Копию делаем в том кодеке, который браузер точно покажет
        const h264 = !!media.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
        const pv = h264 ? 'preview.mp4' : 'preview.webm';
        const codec = h264 ? [...H264(30, 'ultrafast'), '-c:a', 'aac', '-b:a', '64k'] : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '800k', '-c:a', 'libvorbis', '-q:a', '2'];
        const { files } = await ffRun({ inputs: [{ name: inName(file), file }], args: ['-i', inName(file), '-vf', 'scale=-2:360', ...codec, pv], outputs: [pv], duration: info.duration, progress: m => setStatus(status, 'busy', `Предпросмотр: ${m}`), label: 'Предпросмотр' });
        URL.revokeObjectURL(src);
        src = URL.createObjectURL(outBlob(files[0], h264 ? 'mp4' : 'webm'));
        proxy = true;
        media.src = src;
        await new Promise(res => { media.onloadeddata = res; setTimeout(res, 8000); });
        if (!info.width && media.videoWidth) Object.assign(info, { width: media.videoWidth, height: media.videoHeight });
        if (info.width && media.videoWidth) info.width = info.width || media.videoWidth;
      }
      if (!info.width && media.videoWidth) Object.assign(info, { width: media.videoWidth, height: media.videoHeight });
      status.replaceChildren();
      dz.hidden = true; stage.hidden = false;
      const duration = info.duration || media.duration || 0;
      let start = 0, end = duration;
      const track = el('div', { class: 'tl-track' }, el('div', { class: 'tl-sel' }), el('div', { class: 'tl-head' }), el('span', { class: 'tl-h tl-a', role: 'slider', tabindex: 0, 'aria-label': 'Начало' }), el('span', { class: 'tl-h tl-b', role: 'slider', tabindex: 0, 'aria-label': 'Конец' }));
      const sIn = el('input', { type: 'text', class: 'tl-time', id: 'tl-start', 'aria-label': 'Начало' });
      const eIn = el('input', { type: 'text', class: 'tl-time', id: 'tl-end', 'aria-label': 'Конец' });
      const len = el('span', { class: 'muted' });
      const sync = () => {
        const a = start / duration * 100, b = end / duration * 100;
        track.querySelector('.tl-sel').style.cssText = `left:${a}%;width:${b - a}%`;
        track.querySelector('.tl-a').style.left = `${a}%`; track.querySelector('.tl-b').style.left = `${b}%`;
        if (document.activeElement !== sIn) sIn.value = fmtTime(start);
        if (document.activeElement !== eIn) eIn.value = fmtTime(end);
        len.textContent = `Фрагмент: ${fmtTime(end - start)} из ${fmtTime(duration)}`;
      };
      const setRange = (a, b) => { start = Math.max(0, Math.min(a, duration)); end = Math.max(start + 0.05, Math.min(b, duration)); sync(); };
      media.addEventListener('timeupdate', () => {
        track.querySelector('.tl-head').style.left = `${media.currentTime / duration * 100}%`;
        if (track.dataset.playSel && media.currentTime >= end) { media.pause(); delete track.dataset.playSel; }
      });
      const posOf = e => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration; };
      track.addEventListener('pointerdown', e => {
        const h = e.target.closest('.tl-h');
        if (!h) { media.currentTime = posOf(e); return; }
        track.setPointerCapture(e.pointerId);
        const mv = ev => { const t = posOf(ev); if (h.classList.contains('tl-a')) setRange(Math.min(t, end - 0.05), end); else setRange(start, Math.max(t, start + 0.05)); media.currentTime = h.classList.contains('tl-a') ? start : end; };
        const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); };
        track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up);
      });
      for (const [inp, which] of [[sIn, 'a'], [eIn, 'b']]) inp.addEventListener('change', () => { const t = parseTime(inp.value); if (!isNaN(t)) which === 'a' ? setRange(t, end) : setRange(start, t); });
      const rangeBox = withRange && el('div', { class: 'tl' },
        track,
        el('div', { class: 'row' },
          el('label', { for: 'tl-start', class: 'muted' }, 'Начало'), sIn,
          el('button', { class: 'btn small', type: 'button', onclick: () => setRange(media.currentTime, end) }, '⇤ Текущий момент'),
          el('label', { for: 'tl-end', class: 'muted' }, 'Конец'), eIn,
          el('button', { class: 'btn small', type: 'button', onclick: () => setRange(start, media.currentTime) }, 'Текущий момент ⇥'),
          el('button', { class: 'btn small', type: 'button', onclick: () => { media.currentTime = start; track.dataset.playSel = '1'; media.play(); } }, '▶ Проиграть фрагмент'),
          len));
      stage.append(media, rangeBox || '', el('div', { class: 'row muted' }, `${file.name} · ${fmtSize(file.size)} · ${fmtTime(duration)}${info.width ? ` · ${info.width}×${info.height}` : ''}`,
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { media.pause(); stage.hidden = true; dz.hidden = false; dz.pick(); } }, 'Другой файл')));
      sync();
      onReady({ media, file, info: { ...info, duration }, proxy, range: () => ({ start, end }), stage, status });
    } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
  }
}

/** Кнопка запуска с отменой и выводом результата под редактором. */
function runPanel(stage, status, label, job) {
  const results = el('div', { class: 'results' });
  const go = el('button', { class: 'btn primary big', type: 'button' }, label);
  const stop = el('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => ffCancel() }, 'Отмена');
  go.addEventListener('click', async () => {
    go.disabled = true; stop.hidden = false; results.replaceChildren();
    const progress = m => { setStatus(status, 'busy', m); return tick(); };
    try {
      const res = await job(progress);
      status.replaceChildren();
      renderResults(results, Array.isArray(res) ? { files: res } : res);
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); setStatus(status, 'error', e.message); }
    finally { go.disabled = false; stop.hidden = true; }
  });
  stage.append(el('div', { class: 'row' }, go, stop), status, results);
}

/* ---------- Выбор области на кадре ---------- */

async function frameRegion(media, box, { aspect = NaN, label = 'Выделите область' } = {}) {
  await loadLib('cropper');
  const c = makeCanvas(media.videoWidth, media.videoHeight);
  c.getContext('2d').drawImage(media, 0, 0, c.width, c.height);
  const img = el('img', { src: c.toDataURL('image/jpeg', 0.85), alt: '' });
  const holder = el('div', { class: 'crop-stage' }, img);
  box.replaceChildren(el('p', { class: 'hint' }, label), holder);
  return new Promise(res => {
    const cropper = new Cropper(img, { viewMode: 1, autoCropArea: 0.6, aspectRatio: aspect, background: false, ready: () => res(cropper) });
  });
}

/* ===================== Инструменты ===================== */

const RES_CHOICES = [['0', 'Как в исходном'], ['2160', '4K — 2160p'], ['1440', '1440p'], ['1080', 'Full HD — 1080p'], ['720', 'HD — 720p'], ['480', '480p'], ['360', '360p']];
const scaleTo = h => Number(h) ? `scale=-2:'min(${h},ih)'` : EVEN;

videoTool({
  id: 'compress-video', badge: 'МБ↓', title: 'Сжать видео',
  desc: 'Уменьшите размер видео в разы для отправки в мессенджерах и почте.',
  action: 'Сжать видео',
  options: [
    { id: 'mode', label: 'Сжатие', type: 'select', value: 'smart', choices: [['smart', 'Рекомендуемое — хорошее качество, файл в разы меньше'], ['strong', 'Сильное — минимальный размер'], ['high', 'Бережное — почти без потери качества'], ['target', 'До нужного размера файла']] },
    { id: 'target', label: 'Файл не больше', type: 'select', value: '25', choices: [['8', '8 МБ'], ['10', '10 МБ'], ['16', '16 МБ'], ['25', '25 МБ'], ['50', '50 МБ'], ['100', '100 МБ'], ['custom', 'Свой размер']], showIf: v => v.mode === 'target', hint: 'Подходит для лимитов мессенджеров и почты — проверьте лимит у своего сервиса.' },
    { id: 'custom', label: 'Свой размер, МБ', type: 'number', min: 1, value: 20, showIf: v => v.mode === 'target' && v.target === 'custom' },
    { id: 'res', label: 'Разрешение', type: 'select', value: '1080', choices: RES_CHOICES, hint: 'Уменьшение разрешения сильнее всего уменьшает файл' },
    { id: 'audio', label: 'Звук', type: 'select', value: '96', choices: [['128', 'Хороший — 128 кбит/с'], ['96', 'Обычный — 96 кбит/с'], ['64', 'Экономный — 64 кбит/с'], ['none', 'Убрать звук']] },
  ],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file);
    const result = blob => {
      const note = `${fmtSize(file.size)} → ${fmtSize(blob.size)}, ${blob.size < file.size ? `−${Math.round((1 - blob.size / file.size) * 100)}%` : 'не меньше исходного'}`;
      return { files: [{ blob, name: `${baseName(file.name)}_сжато.mp4`, note }], message: note };
    };
    let targetBps = 0;
    if (o.mode === 'target') {
      const mb = o.target === 'custom' ? Math.max(1, o.custom) : Number(o.target);
      if (file.size <= mb * 1024 * 1024 && o.res === '0') return { files: [], message: `«${file.name}» уже меньше ${mb} МБ — сжимать не нужно.` };
      targetBps = Math.floor((mb * 8 * 1024 * 1024 * 0.93 / Math.max(1, info.duration)) - (o.audio === 'none' ? 0 : Number(o.audio) * 1000));
    }
    // Быстрый путь — кодирование видеокартой; если браузер не умеет, ниже работает FFmpeg
    if (!(o.mode === 'target' && targetBps < 60000)) {
      const fast = await webcodecsMp4(file, { height: Number(o.res) || 0, quality: { smart: 'medium', strong: 'low', high: 'high' }[o.mode], bitrate: targetBps || undefined, audioKbps: o.audio === 'none' ? 0 : Number(o.audio) }, progress, 'Сжимаю');
      if (fast) return result(fast);
      await progress('Браузер не умеет быстрое сжатие этого видео — использую FFmpeg, это медленнее…');
    }
    const vf = scaleTo(o.res);
    let video;
    if (o.mode === 'target') {
      const mb = o.target === 'custom' ? Math.max(1, o.custom) : Number(o.target);
      const audioK = o.audio === 'none' ? 0 : Number(o.audio);
      const total = mb * 8 * 1024 * 0.95 / Math.max(1, info.duration);
      const vk = Math.floor(total - audioK);
      if (vk < 60) throw new Error(`Видео слишком длинное, чтобы уложиться в ${mb} МБ с нормальным качеством. Выберите больший размер, уменьшите разрешение или обрежьте видео.`);
      video = ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.2)}k`, '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p'];
    } else video = H264({ smart: 28, strong: 32, high: 23 }[o.mode], 'superfast');
    const name = inName(file);
    const { files } = await ffRun({
      inputs: [{ name, file }], duration: info.duration, progress, label: 'Сжимаю',
      args: ['-i', name, '-vf', vf, ...video, ...(o.audio === 'none' ? ['-an'] : AAC(o.audio)), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'],
    });
    return result(outBlob(files[0], 'mp4'));
  },
});

const VIDEO_FORMATS = [['mp4', 'MP4 (H.264) — открывается везде'], ['webm', 'WEBM — для сайтов'], ['mov', 'MOV — для Apple'], ['mkv', 'MKV'], ['avi', 'AVI — для старых плееров']];
function convertArgs(ext, crf = 22) {
  if (ext === 'webm') return ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '12', '-qmin', '4', '-qmax', '42', '-c:a', 'libvorbis', '-q:a', '4'];
  if (ext === 'avi') return ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-q:a', '3'];
  return [...H264(crf), ...AAC(160), ...(ext === 'mp4' || ext === 'mov' ? FASTSTART : [])];
}

/** Можно ли переложить видео в контейнер без перекодирования, чтобы оно открылось в плеерах. */
function copyCompatible(p, ext) {
  const v = p.video?.codec || '', a = p.audio?.codec || '';
  const ok = {
    mp4: [/^(h264|hevc|av1)$/, /^(aac|mp3|ac3|eac3|opus|alac|flac|)$/], mov: [/^(h264|hevc|prores|mjpeg)$/, /^(aac|mp3|pcm_\w+|alac|)$/],
    webm: [/^(vp8|vp9|av1)$/, /^(opus|vorbis|)$/], mkv: [/./, /.*/],
  }[ext];
  return !!ok && !!v && ok[0].test(v) && ok[1].test(a);
}

function videoConverter(id, badge, title, desc, format, accept = VIDEO_ACCEPT) {
  videoTool({
    id, badge, title, desc, accept, action: 'Конвертировать',
    options: [
      { id: 'format', label: 'В формат', type: 'select', value: format, choices: VIDEO_FORMATS },
      { id: 'fast', label: 'Быстро, без перекодирования (если формат позволяет)', type: 'checkbox', value: true, hint: 'Перекладывает видео в новый контейнер за секунды. Если не получится — перекодирует.' },
      { id: 'res', label: 'Разрешение', type: 'select', choices: RES_CHOICES },
    ],
    async perFile(file, o, { progress }) {
      const info = await mediaInfo(file);
      const name = inName(file), out = `out.${o.format}`;
      if (o.fast && o.res === '0' && o.format !== 'avi' && copyCompatible(info.probe || await ffProbe(file), o.format)) {
        try {
          const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', ...(o.format === 'mp4' || o.format === 'mov' ? FASTSTART : []), out], outputs: [out], duration: info.duration, progress, label: 'Перекладываю' });
          return [{ blob: outBlob(files[0], o.format), name: `${baseName(file.name)}.${o.format}`, note: 'без перекодирования' }];
        } catch { await progress('Без перекодирования не получилось — перекодирую…'); }
      }
      if (o.format === 'mp4') {
        const fast = await webcodecsMp4(file, { height: Number(o.res) || 0, quality: 'high' }, progress, 'Конвертирую');
        if (fast) return [{ blob: fast, name: `${baseName(file.name)}.mp4` }];
      }
      const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', scaleTo(o.res), ...convertArgs(o.format), out], outputs: [out], duration: info.duration, progress, label: 'Конвертирую' });
      return [{ blob: outBlob(files[0], o.format), name: `${baseName(file.name)}.${o.format}` }];
    },
  });
}
videoConverter('convert-video', 'MP4', 'Конвертировать видео', 'Переведите видео в MP4, WEBM, MOV, MKV или AVI.', 'mp4');
videoConverter('mov-to-mp4', 'M→M', 'MOV в MP4', 'Видео с iPhone в универсальный MP4, который откроется на любом устройстве.', 'mp4', '.mov,video/quicktime');
videoConverter('webm-to-mp4', 'W→M', 'WEBM в MP4', 'Переведите WEBM в MP4 для телефонов, Windows и соцсетей.', 'mp4', '.webm,video/webm');
videoConverter('mkv-to-mp4', 'MKV', 'MKV в MP4', 'Перепакуйте MKV в MP4 — чаще всего за секунды, без потери качества.', 'mp4', '.mkv,video/x-matroska');
videoConverter('avi-to-mp4', 'AVI', 'AVI в MP4', 'Старое видео AVI в современный MP4.', 'mp4', '.avi,video/x-msvideo,video/avi');
videoConverter('mp4-to-webm', 'M→W', 'MP4 в WEBM', 'Видео для сайтов в формате WEBM.', 'webm', '.mp4,.m4v,video/mp4');

/* --- Обрезка по времени --- */

tool({
  id: 'trim-video', cat: 'video', badge: '✂', title: 'Обрезать видео',
  desc: 'Вырежьте нужный фрагмент видео или удалите лишнее из середины.',
  render(root) {
    mediaEditor(root, {
      onReady({ media, file, info, range, stage, status }) {
        const form = buildForm('trim', [
          { id: 'mode', label: 'Что сделать', type: 'select', choices: [['keep', 'Оставить выбранный фрагмент'], ['remove', 'Вырезать выбранный фрагмент']] },
          { id: 'fast', label: 'Быстро, без перекодирования', type: 'checkbox', value: true, showIf: v => v.mode === 'keep', hint: 'Мгновенно и без потери качества, но границы сдвигаются к ближайшему ключевому кадру (до пары секунд).' },
          { id: 'fade', label: 'Плавное появление и затухание', type: 'checkbox', showIf: v => v.mode === 'keep' && !v.fast },
        ]);
        stage.append(form.el);
        runPanel(stage, status, 'Обрезать', async progress => {
          const { start, end } = range(), o = form.values(), name = inName(file);
          const base = baseName(file.name);
          const probe = info.probe || await ffProbe(file);
          const hasAudio = !!probe.audio;
          const own = { m4v: 'mp4' }[extOf(file.name)] || extOf(file.name);
          if (o.mode === 'keep' && o.fast && copyCompatible(probe, own)) {
            const ext = own;
            const { files } = await ffRun({ inputs: [{ name, file }], args: ['-ss', String(start), '-to', String(end), '-i', name, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(ext === 'mp4' || ext === 'mov' ? FASTSTART : []), `out.${ext}`], outputs: [`out.${ext}`], duration: end - start, progress, label: 'Обрезаю' });
            return [{ blob: outBlob(files[0], ext), name: `${base}_${fmtTime(start).replace(/[:.]/g, '-')}.${ext}` }];
          }
          let args;
          const d = end - start;
          if (o.mode === 'keep') {
            const vf = [EVEN, o.fade && `fade=t=in:st=0:d=0.6,fade=t=out:st=${Math.max(0, d - 0.6)}:d=0.6`].filter(Boolean).join(',');
            const af = o.fade ? `afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, d - 0.6)}:d=0.6` : null;
            args = ['-ss', String(start), '-i', name, '-t', String(d), '-vf', vf, ...(af ? ['-af', af] : []), ...H264(20), ...AAC(160), ...FASTSTART, 'out.mp4'];
          } else {
            const parts = [[0, start], [end, info.duration]].filter(([a, b]) => b - a > 0.05);
            if (!parts.length) throw new Error('Вы выбрали всё видео — вырезать нечего.');
            const fc = parts.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS,${EVEN}[v${i}];` + (hasAudio ? `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${i}];` : '')).join('') +
              parts.map((_, i) => `[v${i}]` + (hasAudio ? `[a${i}]` : '')).join('') + `concat=n=${parts.length}:v=1:a=${hasAudio ? 1 : 0}[v]` + (hasAudio ? '[a]' : '');
            args = ['-i', name, '-filter_complex', fc, '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []), ...H264(20), ...AAC(160), ...FASTSTART, 'out.mp4'];
          }
          const { files } = await ffRun({ inputs: [{ name, file }], args, outputs: ['out.mp4'], duration: o.mode === 'keep' ? d : info.duration - d, progress, label: 'Обрезаю' });
          return [{ blob: outBlob(files[0], 'mp4'), name: `${base}_обрезано.mp4` }];
        });
      },
    });
  },
});

/* --- Кадрирование и размытие области --- */

const ASPECTS = [['NaN', 'Свободно'], ['0.5625', '9:16 — Reels, Shorts, TikTok, Stories'], ['1', '1:1 — квадрат'], ['0.8', '4:5 — пост в Instagram'], ['1.7778', '16:9 — YouTube'], ['1.3333', '4:3']];

function regionTool({ id, badge, title, desc, button, extraOptions = [], aspects = true, build }) {
  tool({
    id, cat: 'video', badge, title, desc,
    render(root) {
      mediaEditor(root, {
        withRange: false,
        onReady({ media, file, info, stage, status }) {
          if (!media.videoWidth && !info.width) { setStatus(status, 'error', 'Здесь нужно видео, а не аудиофайл.'); return; }
          const area = el('div', { class: 'region-box' });
          let cropper = null;
          const form = buildForm(id, [...(aspects ? [{ id: 'aspect', label: 'Пропорции', type: 'select', choices: ASPECTS }] : []), ...extraOptions]);
          const pick = el('button', { class: 'btn', type: 'button' }, 'Выбрать область на текущем кадре');
          pick.addEventListener('click', async () => {
            media.pause();
            cropper?.destroy();
            cropper = await frameRegion(media, area, { aspect: aspects ? Number(form.values().aspect) : NaN, label: 'Перетащите рамку. Чтобы выбрать по другому кадру, перемотайте видео и нажмите кнопку снова.' });
          });
          form.el.addEventListener('change', () => cropper && aspects && cropper.setAspectRatio(Number(form.values().aspect)));
          stage.append(el('div', { class: 'row' }, pick), area, form.el);
          runPanel(stage, status, button, async progress => {
            if (!cropper) throw new Error('Сначала выберите область на кадре.');
            const d = cropper.getData(true);
            // Кадр мог быть взят из уменьшенной копии для предпросмотра — пересчитываем в размер исходника
            const k = (info.width || media.videoWidth) / cropper.getImageData().naturalWidth;
            const W = info.width || media.videoWidth, H = info.height || media.videoHeight;
            const r = { x: Math.max(0, Math.round(d.x * k / 2) * 2), y: Math.max(0, Math.round(d.y * k / 2) * 2), w: Math.max(2, Math.round(d.width * k / 2) * 2), h: Math.max(2, Math.round(d.height * k / 2) * 2) };
            r.w = Math.min(r.w, W - r.x - ((W - r.x) % 2)); r.h = Math.min(r.h, H - r.y - ((H - r.y) % 2));
            const name = inName(file);
            const { vf, fc } = build(r, form.values(), info);
            const args = ['-i', name, ...(fc ? ['-filter_complex', fc, '-map', '[v]', '-map', '0:a?'] : ['-vf', vf]), ...H264(20), '-c:a', 'copy', ...FASTSTART, 'out.mp4'];
            const { files } = await ffRun({ inputs: [{ name, file }], args, outputs: ['out.mp4'], duration: info.duration, progress, label: 'Обрабатываю' });
            return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_${id}.mp4` }];
          });
        },
      });
    },
  });
}

regionTool({
  id: 'crop-video', badge: 'КАДР', title: 'Кадрировать видео', button: 'Кадрировать',
  desc: 'Обрежьте края видео или сделайте вертикальное 9:16 и квадратное 1:1 для соцсетей.',
  build: r => ({ vf: `crop=${r.w}:${r.h}:${r.x}:${r.y}` }),
});

regionTool({
  id: 'blur-video', badge: 'BLUR', title: 'Размыть область на видео', button: 'Скрыть область', aspects: false,
  desc: 'Скройте лицо, номер машины, логотип или водяной знак на всём видео.',
  extraOptions: [
    { id: 'mode', label: 'Как скрыть', type: 'select', choices: [['blur', 'Размыть'], ['pixel', 'Пикселизация'], ['delogo', 'Убрать логотип — заполнить окружением'], ['black', 'Закрасить чёрным']] },
    { id: 'strength', label: 'Сила', type: 'range', min: 5, max: 60, value: 25, showIf: v => v.mode === 'blur' || v.mode === 'pixel' },
  ],
  build(r, o) {
    if (o.mode === 'delogo') return { vf: `delogo=x=${Math.max(1, r.x)}:y=${Math.max(1, r.y)}:w=${r.w - 2}:h=${r.h - 2}` };
    if (o.mode === 'black') return { vf: `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=black:t=fill` };
    const fx = o.mode === 'blur' ? `boxblur=${Math.min(Math.floor(Math.min(r.w, r.h) / 2) - 1, Math.round(o.strength / 2))}:2` : `scale=max(2\\,iw/${Math.round(o.strength / 2)}):-2,scale=${r.w}:${r.h}:flags=neighbor`;
    return { fc: `[0:v]crop=${r.w}:${r.h}:${r.x}:${r.y},${fx}[b];[0:v][b]overlay=${r.x}:${r.y}[v]` };
  },
});

/* --- Размер, поворот, скорость, реверс --- */

videoTool({
  id: 'resize-video', badge: 'px', title: 'Изменить размер видео',
  desc: 'Измените разрешение или подгоните видео под формат 9:16, 1:1, 16:9 с полями.',
  action: 'Изменить размер',
  options: [
    { id: 'mode', label: 'Способ', type: 'select', choices: [['scale', 'Изменить разрешение'], ['fit', 'Вписать в формат с полями (ничего не обрезая)']] },
    { id: 'res', label: 'Высота кадра', type: 'select', value: '720', choices: RES_CHOICES.slice(1).concat([['custom', 'Своя ширина']]), showIf: v => v.mode === 'scale' },
    { id: 'width', label: 'Ширина, px', type: 'number', min: 16, value: 1280, showIf: v => v.mode === 'scale' && v.res === 'custom' },
    { id: 'aspect', label: 'Формат', type: 'select', choices: [['1080x1920', '9:16 — 1080×1920 (Reels, Shorts, TikTok)'], ['1080x1080', '1:1 — 1080×1080'], ['1080x1350', '4:5 — 1080×1350'], ['1920x1080', '16:9 — 1920×1080 (YouTube)']], showIf: v => v.mode === 'fit' },
    { id: 'bg', label: 'Поля', type: 'select', choices: [['blur', 'Размытая копия видео'], ['black', 'Чёрные'], ['white', 'Белые']], showIf: v => v.mode === 'fit' },
  ],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file);
    if (o.mode === 'scale' && o.res !== 'custom') {
      const fast = await webcodecsMp4(file, { height: Number(o.res), quality: 'high' }, progress, 'Меняю размер');
      if (fast) return [{ blob: fast, name: `${baseName(file.name)}_${o.res}p.mp4` }];
    }
    let vfArgs;
    if (o.mode === 'scale') vfArgs = ['-vf', o.res === 'custom' ? `scale=${Math.round(o.width / 2) * 2}:-2` : `scale=-2:${o.res}`];
    else {
      const [W, H] = o.aspect.split('x').map(Number);
      vfArgs = o.bg === 'blur'
        ? ['-filter_complex', `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:3[bg];[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`, '-map', '[v]', '-map', '0:a?']
        : ['-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${o.bg},setsar=1`];
    }
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, ...vfArgs, ...H264(21), '-c:a', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Меняю размер' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_${o.mode === 'fit' ? o.aspect : o.res + 'p'}.mp4` }];
  },
});

videoTool({
  id: 'rotate-video', badge: '90°', title: 'Повернуть видео',
  desc: 'Поверните видео на 90° или 180°, отразите зеркально.',
  action: 'Повернуть',
  options: [
    { id: 'angle', label: 'Поворот', type: 'select', value: '90', choices: [['0', 'Без поворота'], ['90', 'На 90° по часовой'], ['270', 'На 90° против часовой'], ['180', 'На 180°']] },
    { id: 'fh', label: 'Отразить по горизонтали', type: 'checkbox' },
    { id: 'fv', label: 'Отразить по вертикали', type: 'checkbox' },
  ],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file);
    const vf = [{ 90: 'transpose=1', 270: 'transpose=2', 180: 'transpose=1,transpose=1' }[o.angle], o.fh && 'hflip', o.fv && 'vflip'].filter(Boolean);
    if (!vf.length) throw new Error('Выберите поворот или отражение.');
    if (!o.fh && !o.fv) {
      const fast = await webcodecsMp4(file, { rotate: Number(o.angle), quality: 'high' }, progress, 'Поворачиваю');
      if (fast) return [{ blob: fast, name: `${baseName(file.name)}_повёрнуто.mp4` }];
    }
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', vf.join(','), ...H264(20), '-c:a', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Поворачиваю' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_повёрнуто.mp4` }];
  },
});

function atempoChain(s) {
  const parts = [];
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

videoTool({
  id: 'video-speed', badge: '2×', title: 'Ускорить или замедлить видео',
  desc: 'Измените скорость видео от 0,25× до 4×, звук подстраивается без «мультяшности».',
  action: 'Изменить скорость',
  options: [
    { id: 'speed', label: 'Скорость', type: 'select', value: '2', choices: [['0.25', '0,25× — очень медленно'], ['0.5', '0,5× — замедление'], ['0.75', '0,75×'], ['1.25', '1,25×'], ['1.5', '1,5×'], ['2', '2× — ускорение'], ['3', '3×'], ['4', '4× — таймлапс']] },
    { id: 'audio', label: 'Звук', type: 'select', choices: [['keep', 'Сохранить и подстроить'], ['none', 'Убрать звук']] },
  ],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file), s = Number(o.speed);
    const hasAudio = o.audio === 'none' ? false : !!(info.probe || await ffProbe(file)).audio;
    const audio = o.audio === 'none' || !hasAudio ? ['-an'] : ['-af', atempoChain(s), ...AAC(128)];
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', `setpts=PTS/${s},${EVEN}`, ...audio, ...H264(21), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration / s, progress, label: 'Меняю скорость' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_${o.speed}x.mp4` }];
  },
});

videoTool({
  id: 'reverse-video', badge: '◀◀', title: 'Видео задом наперёд',
  desc: 'Проиграйте видео в обратную сторону — вместе со звуком.',
  action: 'Развернуть', note: 'Реверс требует много памяти: лучше всего работает с роликами до 1 минуты. ' + VIDEO_NOTE,
  options: [{ id: 'audio', label: 'Звук', type: 'select', choices: [['reverse', 'Тоже задом наперёд'], ['none', 'Убрать']] }],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file);
    if (info.duration > 180) throw new Error('Видео длиннее 3 минут — для реверса в браузере не хватит памяти. Сначала обрежьте нужный фрагмент.');
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', `reverse,${EVEN}`, ...(o.audio === 'none' ? ['-an'] : ['-af', 'areverse', ...AAC(128)]), ...H264(21), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Разворачиваю' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_реверс.mp4` }];
  },
});

videoTool({
  id: 'loop-video', badge: '∞', title: 'Зациклить видео',
  desc: 'Повторите видео несколько раз подряд в одном файле.',
  action: 'Зациклить',
  options: [{ id: 'n', label: 'Сколько раз повторить', type: 'number', min: 2, max: 50, value: 3 }],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file), n = Math.min(50, Math.max(2, Math.floor(o.n)));
    const ext = ['mp4', 'mov', 'webm', 'mkv'].includes(extOf(file.name)) ? extOf(file.name) : 'mp4';
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-stream_loop', String(n - 1), '-i', name, '-c', 'copy', ...(ext === 'mp4' || ext === 'mov' ? FASTSTART : []), `out.${ext}`], outputs: [`out.${ext}`], duration: info.duration * n, progress, label: 'Повторяю' });
    return [{ blob: outBlob(files[0], ext), name: `${baseName(file.name)}_x${n}.${ext}` }];
  },
});

/* --- Склейка --- */

videoTool({
  id: 'merge-video', badge: '1+2', title: 'Склеить видео',
  desc: 'Объедините несколько роликов в одно видео в нужном порядке.',
  multiple: true, sortable: true, minFiles: 2, action: 'Склеить',
  options: [
    { id: 'res', label: 'Размер итогового видео', type: 'select', value: 'first', choices: [['first', 'Как у первого ролика'], ['1080', '1080p'], ['720', '720p'], ['1080x1920', 'Вертикальное 1080×1920']] },
  ],
  async run(files, o, { progress }) {
    const infos = [];
    for (const [i, f] of files.entries()) { await progress(`Читаю ролик ${i + 1} из ${files.length}`); infos.push(await ffProbe(f)); }
    let W, H;
    if (o.res === 'first') { W = infos[0].video?.width || 1280; H = infos[0].video?.height || 720; }
    else if (o.res === '1080x1920') { W = 1080; H = 1920; }
    else { H = Number(o.res); W = Math.round(H * (infos[0].video ? infos[0].video.width / infos[0].video.height : 16 / 9) / 2) * 2; }
    W = Math.round(W / 2) * 2; H = Math.round(H / 2) * 2;
    const total = infos.reduce((s, x) => s + x.duration, 0);
    const parts = [];
    for (const [i, f] of files.entries()) {
      const name = inName(f, i), has = !!infos[i].audio;
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      const args = has
        ? ['-i', name, '-vf', vf, ...H264(21), '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k', `p${i}.mp4`]
        : ['-i', name, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-vf', vf, ...H264(21), '-c:a', 'aac', '-b:a', '160k', '-map', '0:v', '-map', '1:a', `p${i}.mp4`];
      const { files: out } = await ffRun({ inputs: [{ name, file: f }], args, outputs: [`p${i}.mp4`], duration: infos[i].duration, progress: m => progress(`Ролик ${i + 1} из ${files.length}: ${m}`), label: 'Подготавливаю' });
      parts.push(out[0]);
    }
    const list = new TextEncoder().encode(parts.map((_, i) => `file 'p${i}.mp4'`).join('\n'));
    const { files: res } = await ffRun({ inputs: [...parts.map((d, i) => ({ name: `p${i}.mp4`, data: d })), { name: 'list.txt', data: list }], args: ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: total, progress, label: 'Склеиваю' });
    return { files: [{ blob: outBlob(res[0], 'mp4'), name: 'склеенное-видео.mp4' }], message: `${files.length} ${plural(files.length, ['ролик', 'ролика', 'роликов'])}, ${fmtTime(total)}, ${W}×${H}.` };
  },
});

/* --- GIF --- */

videoTool({
  id: 'video-to-gif', badge: 'GIF', title: 'Видео в GIF',
  desc: 'Сделайте анимированную GIF из фрагмента видео с хорошей палитрой цветов.',
  action: 'Создать GIF',
  options: [
    { id: 'start', label: 'Начало, секунда', type: 'number', min: 0, step: 0.1, value: 0 },
    { id: 'dur', label: 'Длительность, секунд', type: 'number', min: 0.5, max: 60, step: 0.5, value: 5 },
    { id: 'width', label: 'Ширина', type: 'select', value: '480', choices: [['240', '240 px'], ['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px']] },
    { id: 'fps', label: 'Кадров в секунду', type: 'select', value: '12', choices: [['8', '8 — меньше размер'], ['12', '12'], ['15', '15'], ['24', '24 — плавнее']] },
  ],
  async perFile(file, o, { progress }) {
    const name = inName(file);
    const d = Math.min(60, Math.max(0.5, o.dur));
    const vf = `fps=${o.fps},scale=${o.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`;
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-ss', String(o.start || 0), '-t', String(d), '-i', name, '-vf', vf, '-loop', '0', 'out.gif'], outputs: ['out.gif'], duration: d, progress, label: 'Создаю GIF' });
    return [{ blob: outBlob(files[0], 'gif'), name: `${baseName(file.name)}.gif` }];
  },
});

videoTool({
  id: 'gif-to-video', badge: 'G→M', title: 'GIF в MP4',
  desc: 'Превратите GIF в лёгкое видео MP4 — оно весит в разы меньше.',
  accept: '.gif,image/gif', hint: 'GIF-анимация', action: 'Конвертировать',
  options: [{ id: 'loops', label: 'Повторить анимацию раз', type: 'number', min: 1, max: 20, value: 1 }],
  async perFile(file, o, { progress }) {
    const n = Math.min(20, Math.max(1, Math.floor(o.loops)));
    const { files } = await ffRun({ inputs: [{ name: 'in.gif', file }], args: [...(n > 1 ? ['-stream_loop', String(n - 1)] : []), '-i', 'in.gif', '-vf', EVEN, ...H264(22), ...FASTSTART, '-an', 'out.mp4'], outputs: ['out.mp4'], progress, label: 'Конвертирую' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}.mp4`, note: `${fmtSize(file.size)} → ${fmtSize(files[0].length)}` }];
  },
});

/* --- Звук --- */

const AUDIO_FORMATS = [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV — без сжатия'], ['ogg', 'OGG (Vorbis)'], ['opus', 'OPUS'], ['flac', 'FLAC — без потерь']];
function audioArgs(ext, kbps) {
  return {
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`], m4a: ['-c:a', 'aac', '-b:a', `${kbps}k`], wav: ['-c:a', 'pcm_s16le'],
    ogg: ['-c:a', 'libvorbis', '-b:a', `${kbps}k`], opus: ['-c:a', 'libopus', '-b:a', `${Math.min(kbps, 256)}k`], flac: ['-c:a', 'flac'],
  }[ext];
}
const BITRATES = [['320', '320 кбит/с — максимум'], ['256', '256 кбит/с'], ['192', '192 кбит/с — стандарт'], ['128', '128 кбит/с'], ['96', '96 кбит/с']];

function audioExtract(id, badge, title, desc, format) {
  videoTool({
    id, badge, title, desc, action: 'Извлечь звук',
    options: [
      { id: 'format', label: 'Формат', type: 'select', value: format, choices: AUDIO_FORMATS },
      { id: 'kbps', label: 'Качество', type: 'select', value: '192', choices: BITRATES, showIf: v => !['wav', 'flac'].includes(v.format) },
    ],
    async perFile(file, o, { progress }) {
      const info = await mediaInfo(file), name = inName(file), out = `out.${o.format}`;
      const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vn', ...audioArgs(o.format, o.kbps), out], outputs: [out], duration: info.duration, progress, label: 'Извлекаю звук' });
      return [{ blob: outBlob(files[0], o.format), name: `${baseName(file.name)}.${o.format}` }];
    },
  });
}
audioExtract('extract-audio', '♪', 'Извлечь звук из видео', 'Сохраните звуковую дорожку видео в MP3, M4A, WAV, OGG или FLAC.', 'mp3');
audioExtract('video-to-mp3', 'MP3', 'Видео в MP3', 'Достаньте музыку или речь из видео в MP3.', 'mp3');

videoTool({
  id: 'mute-video', badge: 'MUTE', title: 'Убрать звук из видео',
  desc: 'Удалите звуковую дорожку за секунды, без перекодирования видео.',
  action: 'Убрать звук',
  async perFile(file, o, { progress }) {
    const name = inName(file), ext = ['mp4', 'mov', 'webm', 'mkv'].includes(extOf(file.name)) ? extOf(file.name) : 'mp4';
    try {
      const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-an', '-c:v', 'copy', ...(ext === 'mp4' || ext === 'mov' ? FASTSTART : []), `out.${ext}`], outputs: [`out.${ext}`], progress, label: 'Убираю звук' });
      return [{ blob: outBlob(files[0], ext), name: `${baseName(file.name)}_без-звука.${ext}` }];
    } catch {
      const info = await mediaInfo(file);
      const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-an', '-vf', EVEN, ...H264(21), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Убираю звук' });
      return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_без-звука.mp4` }];
    }
  },
});

videoTool({
  id: 'add-audio', badge: '+♪', title: 'Добавить музыку в видео',
  desc: 'Наложите музыку на видео или замените исходный звук.',
  action: 'Добавить звук',
  options: [
    { id: 'music', label: 'Аудиофайл', type: 'file', accept: AUDIO_ACCEPT, hint: 'MP3, M4A, WAV, OGG, FLAC' },
    { id: 'mode', label: 'Исходный звук видео', type: 'select', choices: [['mix', 'Оставить и смешать с музыкой'], ['replace', 'Заменить музыкой']] },
    { id: 'vol', label: 'Громкость музыки', type: 'range', min: 5, max: 150, value: 60, unit: '%' },
    { id: 'loop', label: 'Повторять музыку, если она короче видео', type: 'checkbox', value: true },
    { id: 'fade', label: 'Плавно заглушить музыку в конце', type: 'checkbox', value: true },
  ],
  async perFile(file, o, { progress }) {
    if (!o.music) throw new Error('Выберите аудиофайл с музыкой.');
    const info = await ffProbe(file), name = inName(file), mname = 'music.' + (extOf(o.music.name) || 'mp3');
    const d = info.duration, v = (o.vol / 100).toFixed(2);
    const music = `[1:a]volume=${v}${o.fade ? `,afade=t=out:st=${Math.max(0, d - 2)}:d=2` : ''},atrim=0:${d}[m]`;
    const fc = o.mode === 'mix' && info.audio ? `${music};[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]` : music.replace('[m]', '[a]');
    const { files } = await ffRun({
      inputs: [{ name, file }, { name: mname, file: o.music }], duration: d, progress, label: 'Свожу звук',
      args: ['-i', name, ...(o.loop ? ['-stream_loop', '-1'] : []), '-i', mname, '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...AAC(192), '-t', String(d), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'],
    });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_с-музыкой.mp4` }];
  },
});

videoTool({
  id: 'video-volume', badge: 'VOL', title: 'Громкость видео',
  desc: 'Сделайте тихое видео громче, выровняйте громкость или приглушите звук.',
  action: 'Изменить громкость', accept: MEDIA_ACCEPT, hint: 'Видео или аудио',
  options: [
    { id: 'mode', label: 'Что сделать', type: 'select', choices: [['norm', 'Выровнять громкость (как в эфире)'], ['gain', 'Изменить громкость']] },
    { id: 'gain', label: 'Громкость', type: 'range', min: 10, max: 400, step: 10, value: 200, unit: '%', showIf: v => v.mode === 'gain' },
  ],
  async perFile(file, o, { progress }) {
    const info = await ffProbe(file), name = inName(file);
    if (!info.audio) throw new Error('В этом файле нет звуковой дорожки.');
    const isVideo = !!info.video, ext = isVideo ? 'mp4' : (['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(extOf(file.name)) ? extOf(file.name) : 'mp3');
    const af = o.mode === 'norm' ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : `volume=${(o.gain / 100).toFixed(2)},alimiter=limit=0.97`;
    const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-af', af, ...(isVideo ? ['-c:v', 'copy', ...AAC(192), ...FASTSTART] : audioArgs(ext, 192)), `out.${ext}`], outputs: [`out.${ext}`], duration: info.duration, progress, label: 'Обрабатываю звук' });
    return [{ blob: outBlob(files[0], ext), name: `${baseName(file.name)}_громкость.${ext}` }];
  },
});

/* --- Текст, логотип, субтитры, фильтры --- */

const ffText = s => s.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '\\%');

videoTool({
  id: 'watermark-video', badge: '©WM', title: 'Водяной знак на видео',
  desc: 'Добавьте на видео текст, подпись или логотип в нужном углу.',
  action: 'Добавить',
  options: [
    { id: 'kind', label: 'Что добавить', type: 'select', choices: [['text', 'Текст'], ['logo', 'Логотип (картинка)']] },
    { id: 'text', label: 'Текст', value: '© Мой канал', showIf: v => v.kind === 'text' },
    { id: 'logo', label: 'Файл логотипа', type: 'file', accept: 'image/png,image/jpeg,image/webp', showIf: v => v.kind === 'logo', hint: 'PNG с прозрачным фоном выглядит лучше всего' },
    { id: 'pos', label: 'Расположение', type: 'select', value: 'br', choices: [['br', 'Справа внизу'], ['bl', 'Слева внизу'], ['tr', 'Справа вверху'], ['tl', 'Слева вверху'], ['c', 'По центру'], ['bc', 'Внизу по центру']] },
    { id: 'size', label: 'Размер', type: 'range', min: 2, max: 30, value: 6, unit: '% высоты' },
    { id: 'opacity', label: 'Непрозрачность', type: 'range', min: 10, max: 100, value: 80, unit: '%' },
    { id: 'color', label: 'Цвет текста', type: 'color', value: '#ffffff', showIf: v => v.kind === 'text' },
  ],
  async perFile(file, o, { progress }) {
    const info = await mediaInfo(file), name = inName(file);
    const DT = { br: ['w-tw-M', 'h-th-M'], bl: ['M', 'h-th-M'], tr: ['w-tw-M', 'M'], tl: ['M', 'M'], c: ['(w-tw)/2', '(h-th)/2'], bc: ['(w-tw)/2', 'h-th-M'] }[o.pos];
    const OV = { br: ['W-w-M', 'H-h-M'], bl: ['M', 'H-h-M'], tr: ['W-w-M', 'M'], tl: ['M', 'M'], c: ['(W-w)/2', '(H-h)/2'], bc: ['(W-w)/2', 'H-h-M'] }[o.pos];
    let args;
    const inputs = [{ name, file }];
    if (o.kind === 'logo') {
      if (!o.logo) throw new Error('Выберите файл логотипа.');
      const img = await loadImage(o.logo);
      const lc = drawImageCanvas(img, img.naturalWidth, img.naturalHeight);
      inputs.push({ name: 'logo.png', data: new Uint8Array(await (await canvasBlob(lc, 'image/png')).arrayBuffer()) });
      const M = 'min(W\\,H)*0.03';
      const fc = `[1:v]format=rgba,colorchannelmixer=aa=${(o.opacity / 100).toFixed(2)}[lg];[lg][0:v]scale2ref=w='oh*iw/ih':h='main_h*${(o.size / 100).toFixed(3)}'[lg2][base];[base][lg2]overlay=${OV[0].replace(/M/g, M)}:${OV[1].replace(/M/g, M)},${EVEN}[v]`;
      args = ['-i', name, '-i', 'logo.png', '-filter_complex', fc, '-map', '[v]', '-map', '0:a?'];
    } else {
      if (!o.text.trim()) throw new Error('Введите текст.');
      const M = 'min(w\\,h)*0.03';
      const dt = `drawtext=fontfile=/fonts/DejaVuSans.ttf:text='${ffText(o.text)}':fontcolor=${o.color.replace('#', '0x')}@${(o.opacity / 100).toFixed(2)}:fontsize=h*${(o.size / 100).toFixed(3)}:shadowcolor=black@0.5:shadowx=2:shadowy=2:x=${DT[0].replace(/M/g, M)}:y=${DT[1].replace(/M/g, M)}`;
      args = ['-i', name, '-vf', `${dt},${EVEN}`];
    }
    const { files } = await ffRun({ inputs, args: [...args, ...H264(21), '-c:a', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Накладываю' });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_wm.mp4` }];
  },
});

videoTool({
  id: 'burn-subtitles', badge: 'SRT', title: 'Вшить субтитры в видео',
  desc: 'Добавьте субтитры SRT, VTT или ASS прямо в картинку — они будут видны в любом плеере и соцсети.',
  action: 'Вшить субтитры',
  options: [
    { id: 'subs', label: 'Файл субтитров', type: 'file', accept: '.srt,.vtt,.ass,.ssa', hint: 'SRT, VTT, ASS' },
    { id: 'size', label: 'Размер шрифта', type: 'range', min: 12, max: 48, value: 22 },
    { id: 'style', label: 'Оформление', type: 'select', choices: [['outline', 'Белый с обводкой'], ['box', 'Белый на тёмной подложке'], ['yellow', 'Жёлтый с обводкой']] },
    { id: 'pos', label: 'Положение', type: 'select', choices: [['2', 'Снизу'], ['8', 'Сверху']] },
  ],
  async perFile(file, o, { progress }) {
    if (!o.subs) throw new Error('Выберите файл субтитров.');
    const info = await mediaInfo(file), name = inName(file), sname = 'subs.' + (extOf(o.subs.name) || 'srt');
    const subText = decodeText(await o.subs.arrayBuffer());
    const st = { outline: 'PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0', box: 'PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0', yellow: 'PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0' }[o.style];
    const style = extOf(o.subs.name) === 'ass' || extOf(o.subs.name) === 'ssa' ? '' : `:force_style='FontName=DejaVu Sans,FontSize=${o.size},Alignment=${o.pos},MarginV=24,${st}'`;
    const { files } = await ffRun({
      inputs: [{ name, file }, { name: sname, data: new TextEncoder().encode(subText) }], duration: info.duration, progress, label: 'Вшиваю субтитры',
      args: ['-i', name, '-vf', `subtitles=${sname}:fontsdir=/fonts${style},${EVEN}`, ...H264(21), '-c:a', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'],
    });
    return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_субтитры.mp4` }];
  },
});

const VIDEO_PRESETS = { 'Исходное': {}, 'Ч/Б': { gray: true, contrast: 110 }, 'Сепия': { sepia: true }, 'Ярче': { brightness: 115, saturate: 125 }, 'Кино': { contrast: 115, saturate: 80, vignette: true }, 'Тёплый': { hue: -10, saturate: 115 } };

tool({
  id: 'video-filters', cat: 'video', badge: 'FX', title: 'Фильтры и цветокоррекция видео',
  desc: 'Яркость, контраст, насыщенность, ч/б, сепия, размытие и виньетка с живым предпросмотром.',
  render(root) {
    mediaEditor(root, {
      withRange: false,
      onReady({ media, file, info, stage, status }) {
        const form = buildForm('vfx', [
          { id: 'brightness', label: 'Яркость', type: 'range', min: 50, max: 150, value: 100, unit: '%' },
          { id: 'contrast', label: 'Контраст', type: 'range', min: 50, max: 200, value: 100, unit: '%' },
          { id: 'saturate', label: 'Насыщенность', type: 'range', min: 0, max: 250, value: 100, unit: '%' },
          { id: 'hue', label: 'Оттенок', type: 'range', min: -180, max: 180, value: 0, unit: '°' },
          { id: 'blur', label: 'Размытие', type: 'range', min: 0, max: 10, value: 0 },
          { id: 'gray', label: 'Чёрно-белое', type: 'checkbox' },
          { id: 'sepia', label: 'Сепия', type: 'checkbox' },
          { id: 'vignette', label: 'Виньетка', type: 'checkbox' },
          { id: 'sharpen', label: 'Повысить резкость', type: 'checkbox' },
        ]);
        const preview = () => {
          const o = form.values();
          media.style.filter = `brightness(${o.brightness}%) contrast(${o.contrast}%) saturate(${o.saturate}%) hue-rotate(${o.hue}deg) blur(${o.blur / 2}px)${o.gray ? ' grayscale(1)' : ''}${o.sepia ? ' sepia(0.85)' : ''}`;
          stage.classList.toggle('vignette', o.vignette);
        };
        form.el.addEventListener('input', preview);
        form.el.addEventListener('change', preview);
        const chips = el('div', { class: 'chips' }, Object.entries(VIDEO_PRESETS).map(([n, p]) => el('button', { class: 'chip', type: 'button', onclick: () => {
          for (const [k, v] of Object.entries({ brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, gray: false, sepia: false, vignette: false, sharpen: false, ...p })) form.set(k, v);
          preview();
        } }, n)));
        stage.append(chips, form.el);
        runPanel(stage, status, 'Применить к видео', async progress => {
          const o = form.values(), name = inName(file);
          const vf = [
            `eq=brightness=${((o.brightness - 100) / 250).toFixed(3)}:contrast=${(o.contrast / 100).toFixed(2)}:saturation=${(o.saturate / 100).toFixed(2)}`,
            o.hue && `hue=h=${o.hue}`, o.gray && 'hue=s=0',
            o.sepia && 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
            o.blur && `boxblur=${o.blur}:1`, o.sharpen && 'unsharp=5:5:0.8', o.vignette && 'vignette=PI/4', EVEN,
          ].filter(Boolean).join(',');
          const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', vf, ...H264(20), '-c:a', 'copy', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: info.duration, progress, label: 'Применяю фильтры' });
          return [{ blob: outBlob(files[0], 'mp4'), name: `${baseName(file.name)}_фильтр.mp4` }];
        });
      },
    });
  },
});

/* --- Кадры --- */

tool({
  id: 'video-frames', cat: 'video', badge: 'JPG', title: 'Кадры из видео',
  desc: 'Сохраните кадр в полном качестве или нарежьте видео на картинки через равные промежутки.',
  render(root) {
    mediaEditor(root, {
      withRange: false,
      onReady({ media, file, info, proxy, stage, status }) {
        if (!media.videoWidth && !info.width) { setStatus(status, 'error', 'Здесь нужно видео, а не аудиофайл.'); return; }
        const results = el('div', { class: 'results' });
        const form = buildForm('vfr', [
          { id: 'mode', label: 'Сколько кадров', type: 'select', choices: [['every', 'Каждые N секунд'], ['count', 'Заданное количество по всему видео']] },
          { id: 'every', label: 'Интервал, секунд', type: 'number', min: 0.1, step: 0.1, value: 1, showIf: v => v.mode === 'every' },
          { id: 'count', label: 'Количество кадров', type: 'number', min: 1, max: 500, value: 12, showIf: v => v.mode === 'count' },
          { id: 'format', label: 'Формат', type: 'select', choices: [['image/jpeg', 'JPG'], ['image/png', 'PNG']] },
        ]);
        const grab = async t => {
          await new Promise(res => { media.onseeked = res; media.currentTime = Math.min(t, Math.max(0, info.duration - 0.05)); });
          const c = makeCanvas(media.videoWidth, media.videoHeight);
          c.getContext('2d').drawImage(media, 0, 0);
          return c;
        };
        const one = el('button', { class: 'btn', type: 'button' }, 'Сохранить текущий кадр');
        one.addEventListener('click', async () => {
          media.pause();
          if (proxy) {
            const ext = form.values().format === 'image/png' ? 'png' : 'jpg', name = inName(file);
            try {
              const r = await ffRun({ inputs: [{ name, file }], args: ['-ss', String(media.currentTime), '-i', name, '-frames:v', '1', ...(ext === 'jpg' ? ['-q:v', '2'] : []), `shot.${ext}`], outputs: [`shot.${ext}`], progress: m => { setStatus(status, 'busy', m); return tick(); }, label: 'Сохраняю кадр' });
              status.replaceChildren();
              renderResults(results, { files: [{ blob: outBlob(r.files[0], ext), name: `${baseName(file.name)}_${fmtTime(media.currentTime).replace(/[:.]/g, '-')}.${ext}` }] });
            } catch (e) { setStatus(status, 'error', e.message); }
            return;
          }
          const c = makeCanvas(media.videoWidth, media.videoHeight);
          c.getContext('2d').drawImage(media, 0, 0);
          renderResults(results, { files: [await exportCanvas(c, form.values().format, 0.95, file.name, `_${fmtTime(media.currentTime).replace(/[:.]/g, '-')}`)] });
        });
        const all = el('button', { class: 'btn primary', type: 'button' }, 'Нарезать на кадры');
        all.addEventListener('click', async () => {
          all.disabled = true; media.pause();
          try {
            const o = form.values(), times = [];
            if (o.mode === 'every') for (let t = 0; t < info.duration && times.length < 1000; t += Math.max(0.1, o.every)) times.push(t);
            else { const n = Math.min(500, Math.max(1, Math.floor(o.count))); for (let i = 0; i < n; i++) times.push(info.duration * (i + 0.5) / n); }
            const out = [];
            if (proxy) {
              // Браузер показывает уменьшенную копию — кадры в полном качестве берём через FFmpeg
              const ext = o.format === 'image/png' ? 'png' : 'jpg', name = inName(file);
              const fps = o.mode === 'every' ? `1/${Math.max(0.1, o.every)}` : `${Math.min(500, Math.max(1, Math.floor(o.count)))}/${info.duration}`;
              // Серия JPEG роняет FFmpeg в браузере, поэтому берём PNG и при необходимости переводим в JPG здесь
              const r = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vf', `fps=${fps}`, 'frame_%04d.png'], outputPrefix: 'frame_', duration: info.duration, progress: m => { setStatus(status, 'busy', m); return tick(); }, label: 'Нарезаю кадры' });
              for (const [i, d] of r.files.entries()) {
                const png = outBlob(d, 'png'), nm = `${baseName(file.name)}_${String(i + 1).padStart(4, '0')}`;
                if (ext === 'png') { out.push({ blob: png, name: `${nm}.png` }); continue; }
                const bmp = await createImageBitmap(png), c = makeCanvas(bmp.width, bmp.height);
                c.getContext('2d').drawImage(bmp, 0, 0);
                out.push(await exportCanvas(c, 'image/jpeg', 0.92, nm, ''));
              }
            } else for (const [i, t] of times.entries()) {
              setStatus(status, 'busy', `Кадр ${i + 1} из ${times.length}`);
              out.push(await exportCanvas(await grab(t), o.format, 0.92, file.name, `_${String(i + 1).padStart(4, '0')}`));
            }
            status.replaceChildren();
            renderResults(results, { files: out, zipName: `${baseName(file.name)}_кадры.zip`, message: `${out.length} ${plural(out.length, ['кадр', 'кадра', 'кадров'])}, ${proxy ? info.width : media.videoWidth}×${proxy ? info.height : media.videoHeight}.` });
            results.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) { setStatus(status, 'error', e.message); } finally { all.disabled = false; }
        });
        stage.append(form.el, el('div', { class: 'row' }, one, all), status, results);
      },
    });
  },
});

/* --- Видео из фото --- */

fileTool({
  id: 'photos-to-video', cat: 'video', badge: 'IMG▶', title: 'Видео из фото',
  desc: 'Соберите слайд-шоу из фотографий с музыкой и плавными переходами.',
  accept: IMG_ACCEPT, multiple: true, sortable: true, minFiles: 1, action: 'Создать видео', note: VIDEO_NOTE, cancel: ffCancel,
  options: [
    { id: 'sec', label: 'Секунд на фото', type: 'number', min: 0.5, max: 30, step: 0.5, value: 3 },
    { id: 'size', label: 'Формат', type: 'select', value: '1920x1080', choices: [['1920x1080', '16:9 — 1920×1080'], ['1280x720', '16:9 — 1280×720'], ['1080x1920', '9:16 — 1080×1920 (Reels, Stories)'], ['1080x1080', '1:1 — 1080×1080']] },
    { id: 'fit', label: 'Фото другой формы', type: 'select', choices: [['blur', 'Вписать, фон — размытое фото'], ['black', 'Вписать, чёрные поля'], ['cover', 'Заполнить кадр, обрезав края']] },
    { id: 'fade', label: 'Плавные переходы', type: 'checkbox', value: true },
    { id: 'music', label: 'Музыка (необязательно)', type: 'file', accept: AUDIO_ACCEPT },
  ],
  async run(files, o, { progress }) {
    const [W, H] = o.size.split('x').map(Number), sec = Math.min(30, Math.max(0.5, o.sec));
    const inputs = [];
    for (const [i, f] of files.entries()) {
      await progress(`Готовлю фото ${i + 1} из ${files.length}`);
      const img = await loadImage(f), c = makeCanvas(W, H), ctx = c.getContext('2d');
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const cover = Math.max(W / iw, H / ih), contain = Math.min(W / iw, H / ih);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (o.fit === 'blur') { ctx.filter = 'blur(40px) brightness(0.7)'; ctx.drawImage(img, (W - iw * cover) / 2, (H - ih * cover) / 2, iw * cover, ih * cover); ctx.filter = 'none'; }
      const k = o.fit === 'cover' ? cover : contain;
      ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      inputs.push({ name: `f${String(i).padStart(4, '0')}.jpg`, data: new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer()) });
    }
    const total = sec * files.length;
    const fadeD = Math.min(0.5, sec / 4);
    const list = inputs.map(x => `file '${x.name}'\nduration ${sec}`).join('\n') + `\nfile '${inputs[inputs.length - 1].name}'`;
    inputs.push({ name: 'list.txt', data: new TextEncoder().encode(list) });
    const vf = [`fps=30,format=yuv420p`, o.fade && files.length > 1 && files.map((_, i) => i ? `fade=t=in:st=${i * sec}:d=${fadeD}` : '').filter(Boolean).join(','), `fade=t=in:st=0:d=${fadeD},fade=t=out:st=${Math.max(0, total - fadeD)}:d=${fadeD}`].filter(Boolean).join(',');
    let audio = ['-an'];
    if (o.music) {
      inputs.push({ name: 'music.' + (extOf(o.music.name) || 'mp3'), file: o.music });
      audio = ['-stream_loop', '-1', '-i', 'music.' + (extOf(o.music.name) || 'mp3'), '-map', '0:v', '-map', '1:a', '-af', `afade=t=out:st=${Math.max(0, total - 2)}:d=2`, ...AAC(192), '-t', String(total)];
    }
    const { files: out } = await ffRun({ inputs, args: ['-f', 'concat', '-safe', '0', '-i', 'list.txt', ...audio, '-vf', vf, ...H264(21), '-r', '30', ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: total, progress, label: 'Собираю видео' });
    return { files: [{ blob: outBlob(out[0], 'mp4'), name: 'слайдшоу.mp4' }], message: `${files.length} ${plural(files.length, ['фото', 'фото', 'фото'])}, ${fmtTime(total)}, ${W}×${H}.` };
  },
});

/* --- Информация --- */

tool({
  id: 'video-info', cat: 'video', badge: 'i', title: 'Информация о видео',
  desc: 'Узнайте разрешение, длительность, частоту кадров, кодеки и битрейт видео или аудио.',
  render(root) {
    const out = el('div', { class: 'video-info' });
    const status = el('div', { class: 'status' });
    root.append(dropzone({ accept: MEDIA_ACCEPT, label: 'Выберите видео или аудио', hint: VIDEO_HINT, onFiles: async ([f]) => {
      out.replaceChildren();
      setStatus(status, 'busy', 'Загружаю видеодвижок и читаю файл…');
      try {
        const p = await ffProbe(f);
        status.replaceChildren();
        const rows = [['Файл', f.name], ['Размер', fmtSize(f.size)], ['Длительность', fmtTime(p.duration)], ['Общий битрейт', p.bitrate],
          p.video && ['Видео', `${p.video.codec}, ${p.video.width}×${p.video.height}${p.video.fps ? `, ${p.video.fps} кадр/с` : ''}`],
          p.rotation && ['Поворот', `${p.rotation}°`],
          p.audio ? ['Звук', `${p.audio.codec}${p.audio.rate ? `, ${p.audio.rate} Гц` : ''}${p.audio.channels ? `, ${p.audio.channels}` : ''}`] : ['Звук', 'нет'],
          p.video && ['Подробно о видео', p.video.raw], p.audio && ['Подробно о звуке', p.audio.raw]].filter(Boolean).filter(([, v]) => v);
        out.append(el('dl', { class: 'mail-head' }, rows.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', { class: 'notranslate' }, v)))));
      } catch (e) { setStatus(status, 'error', e.message); }
    } }), status, out);
  },
});

/* --- Аудио --- */

function audioConverter(id, badge, title, desc, format, accept = AUDIO_ACCEPT) {
  fileTool({
    id, cat: 'video', badge, title, desc, accept, hint: 'MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA, AMR', action: 'Конвертировать', zipName: 'audio.zip', cancel: ffCancel,
    options: [
      { id: 'format', label: 'В формат', type: 'select', value: format, choices: AUDIO_FORMATS },
      { id: 'kbps', label: 'Качество', type: 'select', value: '192', choices: BITRATES, showIf: v => !['wav', 'flac'].includes(v.format) },
    ],
    async perFile(file, o, { progress }) {
      const info = await mediaInfo(file), name = inName(file), out = `out.${o.format}`;
      const { files } = await ffRun({ inputs: [{ name, file }], args: ['-i', name, '-vn', ...audioArgs(o.format, o.kbps), out], outputs: [out], duration: info.duration, progress, label: 'Конвертирую' });
      return [{ blob: outBlob(files[0], o.format), name: `${baseName(file.name)}.${o.format}` }];
    },
  });
}
audioConverter('audio-converter', '♫', 'Конвертер аудио', 'Переведите аудио в MP3, M4A, WAV, OGG, OPUS или FLAC.', 'mp3');
audioConverter('wav-to-mp3', 'W→M', 'WAV в MP3', 'Сожмите WAV в MP3 — файл станет в 10 раз меньше.', 'mp3', '.wav,audio/wav,audio/x-wav');
audioConverter('m4a-to-mp3', 'M4A', 'M4A в MP3', 'Голосовые и записи с iPhone в универсальный MP3.', 'mp3', '.m4a,.aac,audio/mp4,audio/aac,audio/x-m4a');

tool({
  id: 'trim-audio', cat: 'video', badge: '✂♪', title: 'Обрезать аудио',
  desc: 'Вырежьте фрагмент песни или записи, сделайте рингтон с плавным началом и концом.',
  render(root) {
    mediaEditor(root, {
      accept: AUDIO_ACCEPT + ',' + VIDEO_ACCEPT, label: 'Выберите аудио', hint: 'MP3, WAV, M4A, FLAC, OGG — или видео',
      onReady({ file, info, range, stage, status }) {
        const form = buildForm('ta', [
          { id: 'format', label: 'Сохранить как', type: 'select', choices: [['mp3', 'MP3'], ['m4a', 'M4A — рингтон для iPhone (переименуйте в .m4r)'], ['wav', 'WAV'], ['ogg', 'OGG']] },
          { id: 'fade', label: 'Плавное начало и конец', type: 'checkbox', value: true },
        ]);
        stage.append(form.el);
        runPanel(stage, status, 'Обрезать', async progress => {
          const { start, end } = range(), o = form.values(), name = inName(file), d = end - start;
          const af = o.fade ? ['-af', `afade=t=in:st=0:d=${Math.min(1.5, d / 4)},afade=t=out:st=${Math.max(0, d - Math.min(1.5, d / 4))}:d=${Math.min(1.5, d / 4)}`] : [];
          const out = `out.${o.format}`;
          const { files } = await ffRun({ inputs: [{ name, file }], args: ['-ss', String(start), '-i', name, '-t', String(d), '-vn', ...af, ...audioArgs(o.format, 192), out], outputs: [out], duration: d, progress, label: 'Обрезаю' });
          return [{ blob: outBlob(files[0], o.format), name: `${baseName(file.name)}_фрагмент.${o.format}` }];
        });
      },
    });
  },
});

/* --- Запись экрана и камеры --- */

function recorderTool({ id, badge, title, desc, screen }) {
  tool({
    id, cat: 'video', badge, title, desc,
    render(root) {
      const status = el('div', { class: 'status', role: 'status' });
      const results = el('div', { class: 'results' });
      const preview = el('video', { class: 'media-view', autoplay: true, muted: true, playsinline: true, hidden: true });
      const form = buildForm(id, screen
        ? [{ id: 'mic', label: 'Записывать микрофон', type: 'checkbox', value: true }, { id: 'sys', label: 'Записывать звук вкладки или системы (если браузер позволяет)', type: 'checkbox', value: true }]
        : [{ id: 'mic', label: 'Записывать звук', type: 'checkbox', value: true }, { id: 'mirror', label: 'Зеркальный предпросмотр', type: 'checkbox', value: true }, { id: 'res', label: 'Качество', type: 'select', value: '720', choices: [['1080', '1080p'], ['720', '720p'], ['480', '480p']] }]);
      const startBtn = el('button', { class: 'btn primary big', type: 'button' }, screen ? '● Начать запись экрана' : '● Начать запись');
      const stopBtn = el('button', { class: 'btn big', type: 'button', hidden: true }, '■ Остановить');
      const photoBtn = !screen && el('button', { class: 'btn', type: 'button', hidden: true }, 'Сделать фото');
      const timer = el('span', { class: 'rec-timer', hidden: true });
      let rec, streams = [], t0, tick$;
      const stopAll = () => { streams.forEach(s => s.getTracks().forEach(t => t.stop())); streams = []; clearInterval(tick$); timer.hidden = true; preview.hidden = true; if (photoBtn) photoBtn.hidden = true; };
      if (!navigator.mediaDevices || (screen && !navigator.mediaDevices.getDisplayMedia)) {
        root.append(el('p', { class: 'status-msg error' }, screen ? 'Ваш браузер не умеет записывать экран. Откройте страницу в Chrome, Edge или Firefox на компьютере.' : 'Ваш браузер не даёт доступ к камере.'));
        return;
      }
      startBtn.addEventListener('click', async () => {
        results.replaceChildren(); status.replaceChildren();
        try {
          const o = form.values();
          let main;
          if (screen) main = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: !!o.sys });
          else main = await navigator.mediaDevices.getUserMedia({ video: { height: { ideal: Number(o.res) } }, audio: !!o.mic });
          streams.push(main);
          let tracks = [...main.getVideoTracks()];
          const audioTracks = [...main.getAudioTracks()];
          if (screen && o.mic) { try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streams.push(mic); audioTracks.push(...mic.getAudioTracks()); } catch { /* без микрофона */ } }
          if (audioTracks.length > 1) {
            const ac = new AudioContext(), dest = ac.createMediaStreamDestination();
            audioTracks.forEach(t => ac.createMediaStreamSource(new MediaStream([t])).connect(dest));
            tracks.push(...dest.stream.getAudioTracks());
          } else tracks.push(...audioTracks);
          const stream = new MediaStream(tracks);
          preview.srcObject = main; preview.hidden = false;
          preview.style.transform = !screen && o.mirror ? 'scaleX(-1)' : '';
          const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
          const chunks = [];
          rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
          rec.ondataavailable = e => e.data.size && chunks.push(e.data);
          rec.onstop = async () => {
            stopAll();
            startBtn.hidden = false; stopBtn.hidden = true;
            const type = rec.mimeType.split(';')[0] || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(chunks, { type });
            const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
            const name = `${screen ? 'запись-экрана' : 'запись-камеры'}-${stamp}.${ext}`;
            renderResults(results, { files: [{ blob, name }], message: `Длительность ${fmtTime((Date.now() - t0) / 1000)}. Запись в WEBM открывается в браузерах и VLC; для телефона и соцсетей сохраните в MP4.` });
            const mp4 = el('button', { class: 'btn', type: 'button' }, 'Сохранить в MP4');
            mp4.addEventListener('click', async () => {
              mp4.disabled = true;
              try {
                const { files } = await ffRun({ inputs: [{ name: `rec.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) }], args: ['-i', `rec.${ext}`, '-vf', EVEN, '-r', '30', ...H264(23), ...AAC(128), ...FASTSTART, 'out.mp4'], outputs: ['out.mp4'], duration: (Date.now() - t0) / 1000, progress: m => { setStatus(status, 'busy', m); return tick(); }, label: 'Сохраняю в MP4' });
                status.replaceChildren();
                renderResults(results, { files: [{ blob: outBlob(files[0], 'mp4'), name: name.replace(/\.\w+$/, '.mp4') }] });
              } catch (e) { setStatus(status, 'error', e.message); } finally { mp4.disabled = false; }
            });
            results.append(mp4);
          };
          main.getVideoTracks()[0].addEventListener('ended', () => rec.state !== 'inactive' && rec.stop());
          rec.start(1000);
          t0 = Date.now();
          timer.hidden = false;
          tick$ = setInterval(() => (timer.textContent = `● ${fmtTime((Date.now() - t0) / 1000)}`), 250);
          startBtn.hidden = true; stopBtn.hidden = false; if (photoBtn) photoBtn.hidden = false;
        } catch (e) {
          stopAll();
          setStatus(status, 'error', e.name === 'NotAllowedError' ? 'Доступ не разрешён. Разрешите доступ в окне браузера и попробуйте снова.' : `Не удалось начать запись: ${e.message}`);
        }
      });
      stopBtn.addEventListener('click', () => rec && rec.state !== 'inactive' && rec.stop());
      if (photoBtn) photoBtn.addEventListener('click', async () => {
        const c = makeCanvas(preview.videoWidth, preview.videoHeight), ctx = c.getContext('2d');
        if (form.values().mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(preview, 0, 0);
        renderResults(results, { files: [await exportCanvas(c, 'image/jpeg', 0.95, `фото-${Date.now()}`, '')] });
      });
      root.append(el('div', { class: 'workspace' },
        el('div', { class: 'ws-files' }, preview, el('p', { class: 'hint' }, screen ? 'После нажатия браузер спросит, что записывать: весь экран, окно или вкладку. Запись идёт на вашем компьютере и никуда не отправляется.' : 'Браузер спросит разрешение на камеру и микрофон. Запись остаётся на вашем устройстве.')),
        el('div', { class: 'ws-side' }, form.el, el('div', { class: 'row' }, timer), startBtn, stopBtn, photoBtn, status)), results);
    },
  });
}
recorderTool({ id: 'screen-recorder', badge: 'REC', title: 'Запись экрана', screen: true, desc: 'Запишите экран, окно или вкладку браузера со звуком и микрофоном — без установки программ.' });
recorderTool({ id: 'webcam-recorder', badge: 'CAM', title: 'Запись с камеры', screen: false, desc: 'Запишите видео с веб-камеры или сделайте фото прямо в браузере.' });
