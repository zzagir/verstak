'use strict';

/* ===================== Кодировщики ===================== */

const utf8 = s => new TextEncoder().encode(s);
const fromUtf8 = b => new TextDecoder('utf-8').decode(b);

function codecTool({ id, badge, title, desc, sample, encode, decode, options = [], enc = 'Закодировать', dec = 'Раскодировать' }) {
  tool({
    id, cat: 'dev', badge, title, desc,
    render(root) {
      liveTextTool(root, {
        id, rows: 7, input: sample, mono: true,
        options: [{ id: 'dir', label: 'Действие', type: 'select', choices: [['enc', enc], ['dec', dec]] }, ...options],
        compute: (t, o) => o.dir === 'enc' ? encode(t, o) : decode(t, o),
      });
    },
  });
}

codecTool({
  id: 'base64', badge: 'B64', title: 'Base64', desc: 'Закодируйте текст в Base64 или раскодируйте обратно. Кириллица поддерживается.',
  sample: 'Привет, мир! Hello, world!',
  options: [{ id: 'url', label: 'URL-safe вариант (- и _ вместо + и /)', type: 'checkbox' }],
  encode(t, o) {
    const b = utf8(t);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    const r = btoa(s);
    return o.url ? r.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : r;
  },
  decode(t) {
    let s = t.trim().replace(/^data:[^,]*,/, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try { return fromUtf8(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }
    catch { throw new Error('Это не похоже на Base64: проверьте, что строка скопирована целиком.'); }
  },
});

codecTool({
  id: 'url-encode', badge: '%20', title: 'URL-кодирование', desc: 'Закодируйте кириллицу и спецсимволы для адресной строки или раскодируйте %D0%BF%D1%80…',
  sample: 'https://site.ru/поиск?q=купить ноутбук&page=2',
  options: [{ id: 'full', label: 'Это целый адрес — не трогать :/?&=', type: 'checkbox', value: true }],
  encode: (t, o) => o.full ? encodeURI(t) : encodeURIComponent(t),
  decode(t) { try { return decodeURIComponent(t.replace(/\+/g, ' ')); } catch { throw new Error('В строке есть неправильная последовательность %XX.'); } },
});

const MORSE_EN = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
const MORSE_RU = { А: '.-', Б: '-...', В: '.--', Г: '--.', Д: '-..', Е: '.', Ё: '.', Ж: '...-', З: '--..', И: '..', Й: '.---', К: '-.-', Л: '.-..', М: '--', Н: '-.', О: '---', П: '.--.', Р: '.-.', С: '...', Т: '-', У: '..-', Ф: '..-.', Х: '....', Ц: '-.-.', Ч: '---.', Ш: '----', Щ: '--.-', Ъ: '--.--', Ы: '-.--', Ь: '-..-', Э: '..-..', Ю: '..--', Я: '.-.-' };
const MORSE_COMMON = { 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '.-.-.', '?': '..--..', '!': '-.-.--', '-': '-....-', '/': '-..-.', '@': '.--.-.', '(': '-.--.', ')': '-.--.-', ':': '---...', ';': '-.-.-.', '=': '-...-', '"': '.-..-.', "'": '.----.' };

codecTool({
  id: 'morse', badge: '·−', title: 'Азбука Морзе', desc: 'Переведите текст на русском или английском в азбуку Морзе и обратно.',
  sample: 'SOS Привет', enc: 'Текст → Морзе', dec: 'Морзе → текст',
  options: [{ id: 'lang', label: 'Алфавит для расшифровки', type: 'select', choices: [['ru', 'Русский'], ['en', 'Английский']], showIf: v => v.dir === 'dec' }],
  encode: t => t.toUpperCase().split(/\s+/).filter(Boolean).map(w => [...w].map(c => MORSE_RU[c] || MORSE_EN[c] || MORSE_COMMON[c] || '').filter(Boolean).join(' ')).join(' / '),
  decode(t, o) {
    const table = { ...MORSE_COMMON, ...(o.lang === 'ru' ? MORSE_RU : MORSE_EN) };
    const rev = {};
    for (const [k, v] of Object.entries(table)) if (!rev[v] || k !== 'Ё') rev[v] = k;
    return t.replace(/[—–]/g, '-').replace(/[·•]/g, '.').trim().split(/\s*\/\s*|\s{3,}/).map(w => w.split(/\s+/).map(c => rev[c] || (c ? '�' : '')).join('')).join(' ');
  },
});

codecTool({
  id: 'binary', badge: '0101', title: 'Текст в двоичный код', desc: 'Переведите текст в нули и единицы (UTF-8) и обратно.',
  sample: 'Hi! Привет', enc: 'Текст → двоичный код', dec: 'Двоичный код → текст',
  encode: t => [...utf8(t)].map(b => b.toString(2).padStart(8, '0')).join(' '),
  decode(t) {
    const groups = t.replace(/[^01]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const bits = groups.length === 1 && groups[0].length > 8 ? groups[0].match(/.{1,8}/g) : groups;
    return fromUtf8(Uint8Array.from(bits, g => parseInt(g, 2)));
  },
});

codecTool({
  id: 'hex', badge: '0xFF', title: 'Текст в HEX', desc: 'Переведите текст в шестнадцатеричный код (UTF-8) и обратно.',
  sample: 'Hello, мир', enc: 'Текст → HEX', dec: 'HEX → текст',
  options: [{ id: 'sep', label: 'Разделять байты пробелом', type: 'checkbox', value: true, showIf: v => v.dir === 'enc' }],
  encode: (t, o) => [...utf8(t)].map(b => b.toString(16).padStart(2, '0')).join(o.sep ? ' ' : ''),
  decode(t) {
    const h = t.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (h.length % 2) throw new Error('Нечётное количество HEX-цифр: проверьте строку.');
    return fromUtf8(Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)));
  },
});

function caesar(t, shift, alphabets) {
  return [...t].map(c => {
    for (const a of alphabets) {
      const lo = a.indexOf(c), up = a.toUpperCase().indexOf(c);
      const i = lo >= 0 ? lo : up;
      if (i >= 0) { const r = a[((i + shift) % a.length + a.length) % a.length]; return lo >= 0 ? r : r.toUpperCase(); }
    }
    return c;
  }).join('');
}
const ALPHA_EN = 'abcdefghijklmnopqrstuvwxyz', ALPHA_RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';

codecTool({
  id: 'rot13', badge: 'ROT', title: 'ROT13', desc: 'Классический шифр ROT13: сдвиг латинских букв на 13 позиций. Повторное применение возвращает текст.',
  sample: 'Hello, World!', enc: 'Зашифровать', dec: 'Расшифровать',
  encode: t => caesar(t, 13, [ALPHA_EN]), decode: t => caesar(t, 13, [ALPHA_EN]),
});

codecTool({
  id: 'caesar', badge: 'A→D', title: 'Шифр Цезаря', desc: 'Зашифруйте текст сдвигом букв русского и английского алфавита.',
  sample: 'Привет, Цезарь! Hello, Caesar!', enc: 'Зашифровать', dec: 'Расшифровать',
  options: [{ id: 'shift', label: 'Сдвиг', type: 'number', min: 1, max: 32, value: 3 }],
  encode: (t, o) => caesar(t, o.shift, [ALPHA_RU, ALPHA_EN]),
  decode: (t, o) => caesar(t, -o.shift, [ALPHA_RU, ALPHA_EN]),
});

/* ===================== Хеши ===================== */

function md5(bytes) {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const len = bytes.length, blocks = Math.floor((len + 8) / 64) + 1;
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(blocks * 64 - 8, (len * 8) >>> 0, true);
  dv.setUint32(blocks * 64 - 4, Math.floor(len * 8 / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let o = 0; o < buf.length; o += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(o + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map(x => [0, 8, 16, 24].map(s => ((x >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

function crc32(bytes) {
  const T = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  let c = 0xffffffff;
  for (const b of bytes) c = T[(c ^ b) & 255] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

async function allHashes(bytes) {
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const out = [['MD5', md5(bytes)], ['CRC32', crc32(bytes)]];
  for (const alg of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) out.push([alg, crypto.subtle ? hex(await crypto.subtle.digest(alg, bytes)) : 'нужен HTTPS']);
  return out;
}

tool({
  id: 'hash', cat: 'dev', badge: '#MD5', title: 'Хеш MD5, SHA-256',
  desc: 'Посчитайте MD5, SHA-1, SHA-256, SHA-512 и CRC32 для текста или файла.',
  render(root) {
    const ta = el('textarea', { id: 'hash-in', class: 'text-in', rows: 5, value: 'Привет, мир!' });
    const upper = el('input', { type: 'checkbox', id: 'hash-up' });
    const out = el('div', { class: 'hash-out' });
    const src = el('p', { class: 'muted' });
    let fileBytes = null;
    const show = async () => {
      const bytes = fileBytes || utf8(ta.value);
      const rows = await allHashes(bytes);
      out.replaceChildren(...rows.map(([name, v]) => {
        const val = upper.checked ? v.toUpperCase() : v;
        const inp = el('input', { type: 'text', readonly: true, class: 'mono', value: val, 'aria-label': name });
        return el('div', { class: 'hash-row' }, el('span', { class: 'chip mono' }, name), inp, copyButton(() => inp.value, inp));
      }));
    };
    const dz = dropzone({ label: 'Или выберите файл', hint: 'Файл не загружается на сервер', onFiles: async ([f]) => {
      fileBytes = new Uint8Array(await f.arrayBuffer());
      src.textContent = `Хеш файла ${f.name} (${fmtSize(f.size)}). Начните печатать в поле, чтобы снова считать хеш текста.`;
      show();
    } });
    ta.addEventListener('input', () => { fileBytes = null; src.textContent = 'Хеш текста из поля'; show(); });
    upper.addEventListener('change', show);
    root.append(el('div', { class: 'text-tool single' },
      el('label', { for: 'hash-in', class: 'block-label' }, 'Текст'), ta, dz, src,
      el('label', { class: 'field check' }, upper, el('span', {}, 'ЗАГЛАВНЫМИ буквами')), out));
    src.textContent = 'Хеш текста из поля';
    show();
  },
});

/* ===================== Генераторы ===================== */

function randInt(max) {
  const lim = Math.floor(0x100000000 / max) * max, a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % max;
}

function genTool({ id, badge, title, desc, options, generate, action = 'Сгенерировать' }) {
  tool({
    id, cat: 'dev', badge, title, desc,
    render(root) {
      const form = buildForm(id, options);
      const out = el('textarea', { id: `${id}-out`, class: 'text-out mono', rows: 10, readonly: true });
      const info = el('div', { class: 'gen-info' });
      const run = () => {
        try { const r = generate(form.values()); out.value = r.text; info.replaceChildren(r.info || ''); }
        catch (e) { out.value = ''; setStatus(info, 'error', e.message); }
      };
      form.el.addEventListener('change', run);
      root.append(el('div', { class: 'text-tool' },
        el('div', { class: 'text-main' }, el('label', { for: out.id, class: 'block-label' }, 'Результат'), out, info,
          el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'button', onclick: run }, action), copyButton(() => out.value, out),
            el('button', { class: 'btn', type: 'button', onclick: () => download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), `${id}.txt`) }, 'Скачать .txt'))),
        el('div', { class: 'ws-side' }, form.el)));
      run();
    },
  });
}

genTool({
  id: 'password-generator', badge: '***', title: 'Генератор паролей',
  desc: 'Надёжные случайные пароли нужной длины. Генерируются на вашем устройстве.',
  options: [
    { id: 'len', label: 'Длина', type: 'range', min: 4, max: 64, value: 16, unit: ' симв.' },
    { id: 'count', label: 'Сколько паролей', type: 'number', min: 1, max: 100, value: 5 },
    { id: 'lower', label: 'Строчные буквы a–z', type: 'checkbox', value: true },
    { id: 'upper', label: 'Заглавные буквы A–Z', type: 'checkbox', value: true },
    { id: 'digits', label: 'Цифры 0–9', type: 'checkbox', value: true },
    { id: 'symbols', label: 'Символы !@#$%^&*', type: 'checkbox', value: true },
    { id: 'similar', label: 'Без похожих символов (l, 1, I, O, 0)', type: 'checkbox' },
  ],
  generate(o) {
    const sets = [o.lower && 'abcdefghijklmnopqrstuvwxyz', o.upper && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', o.digits && '0123456789', o.symbols && '!@#$%^&*()-_=+[]{};:,.?/']
      .filter(Boolean).map(s => o.similar ? s.replace(/[il1IoO0|]/g, '') : s);
    if (!sets.length) throw new Error('Выберите хотя бы один набор символов.');
    const pool = sets.join(''), len = Math.max(sets.length, o.len);
    const one = () => {
      const chars = sets.map(s => s[randInt(s.length)]);
      while (chars.length < len) chars.push(pool[randInt(pool.length)]);
      for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
      return chars.join('');
    };
    const bits = Math.round(len * Math.log2(pool.length));
    const level = bits < 40 ? ['слабый', 'bad'] : bits < 64 ? ['средний', 'warn'] : bits < 100 ? ['надёжный', 'ok'] : ['очень надёжный', 'ok'];
    return {
      text: Array.from({ length: Math.min(100, Math.max(1, o.count)) }, one).join('\n'),
      info: el('span', { class: `pill ${level[1]}` }, `Стойкость: ${level[0]} — ${bits} бит`),
    };
  },
});

genTool({
  id: 'uuid-generator', badge: 'UUID', title: 'Генератор UUID',
  desc: 'Случайные идентификаторы UUID v4 (GUID) по одному или списком.',
  options: [
    { id: 'count', label: 'Количество', type: 'number', min: 1, max: 1000, value: 10 },
    { id: 'upper', label: 'Заглавными буквами', type: 'checkbox' },
    { id: 'noDash', label: 'Без дефисов', type: 'checkbox' },
    { id: 'braces', label: 'В фигурных скобках {…}', type: 'checkbox' },
  ],
  generate: o => ({
    text: Array.from({ length: Math.min(1000, Math.max(1, o.count)) }, () => {
      let u = uuid();
      if (o.noDash) u = u.replace(/-/g, '');
      if (o.upper) u = u.toUpperCase();
      return o.braces ? `{${u}}` : u;
    }).join('\n'),
  }),
});

genTool({
  id: 'random-number', badge: '1–100', title: 'Случайное число',
  desc: 'Генератор случайных чисел в диапазоне: для розыгрышей, лотерей и жеребьёвки.',
  options: [
    { id: 'min', label: 'От', type: 'number', value: 1 },
    { id: 'max', label: 'До', type: 'number', value: 100 },
    { id: 'count', label: 'Сколько чисел', type: 'number', min: 1, max: 10000, value: 1 },
    { id: 'unique', label: 'Без повторов', type: 'checkbox', value: true },
    { id: 'sort', label: 'Отсортировать', type: 'checkbox' },
  ],
  generate(o) {
    const lo = Math.ceil(Math.min(o.min, o.max)), hi = Math.floor(Math.max(o.min, o.max)), span = hi - lo + 1;
    const n = Math.min(10000, Math.max(1, Math.floor(o.count)));
    if (o.unique && n > span) throw new Error(`В диапазоне ${lo}–${hi} только ${span} разных чисел — уменьшите количество или снимите «Без повторов».`);
    let nums;
    if (o.unique) { const s = new Set(); while (s.size < n) s.add(lo + randInt(span)); nums = [...s]; }
    else nums = Array.from({ length: n }, () => lo + randInt(span));
    if (o.sort) nums.sort((a, b) => a - b);
    return { text: nums.join('\n'), info: n === 1 ? el('div', { class: 'big-number' }, nums[0]) : '' };
  },
});

/* ===================== JSON и CSV ===================== */

function jsonError(e, text) {
  const m = String(e.message).match(/position (\d+)/);
  if (!m) return `Ошибка в JSON: ${e.message}`;
  const pos = Number(m[1]), before = text.slice(0, pos);
  const line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
  return `Ошибка в JSON: строка ${line}, символ ${col}. ${e.message.replace(/ in JSON at position \d+.*/, '')}`;
}
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;

tool({
  id: 'json-formatter', cat: 'dev', badge: '{ }', title: 'JSON форматтер',
  desc: 'Отформатируйте, проверьте или сожмите JSON. Ошибки показываются с номером строки.',
  render(root) {
    const ok = el('p', { class: 'hint' });
    liveTextTool(root, {
      id: 'json', rows: 14, mono: true, inLabel: 'JSON',
      input: '{"name":"Верстак","tools":["pdf","image","text"],"free":true,"version":2,"meta":{"lang":"ru"}}',
      options: [
        { id: 'mode', label: 'Действие', type: 'select', choices: [['pretty', 'Форматировать'], ['min', 'Сжать в одну строку']] },
        { id: 'indent', label: 'Отступ', type: 'select', choices: [['2', '2 пробела'], ['4', '4 пробела'], ['tab', 'Табуляция']], showIf: v => v.mode === 'pretty' },
        { id: 'sort', label: 'Сортировать ключи', type: 'checkbox' },
      ],
      compute(t, o) {
        if (!t.trim()) { ok.textContent = ''; return ''; }
        let v;
        try { v = JSON.parse(t); } catch (e) { ok.textContent = ''; throw new Error(jsonError(e, t)); }
        if (o.sort) v = sortKeys(v);
        ok.textContent = 'JSON корректен.';
        return o.mode === 'min' ? JSON.stringify(v) : JSON.stringify(v, null, o.indent === 'tab' ? '\t' : Number(o.indent));
      },
      extra: () => ok,
    });
  },
});

function parseCsv(text, delim) {
  if (delim === 'auto') {
    const first = text.split('\n')[0];
    delim = [';', '\t', ',', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
const csvCell = (v, d) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s; };

tool({
  id: 'csv-json', cat: 'dev', badge: 'CSV', title: 'CSV ⇄ JSON',
  desc: 'Превратите таблицу CSV в JSON или массив JSON в CSV для Excel.',
  render(root) {
    liveTextTool(root, {
      id: 'csv', rows: 12, mono: true, inLabel: 'Данные',
      input: 'Имя;Город;Возраст\nАнна;Москва;29\nИван;"Санкт-Петербург; центр";34',
      options: [
        { id: 'dir', label: 'Направление', type: 'select', choices: [['c2j', 'CSV → JSON'], ['j2c', 'JSON → CSV']] },
        { id: 'delim', label: 'Разделитель', type: 'select', choices: [['auto', 'Определить автоматически'], [';', 'Точка с запятой — Excel в России'], [',', 'Запятая'], ['\t', 'Табуляция']] },
        { id: 'header', label: 'Первая строка — заголовки', type: 'checkbox', value: true, showIf: v => v.dir === 'c2j' },
        { id: 'numbers', label: 'Числа как числа', type: 'checkbox', value: true, showIf: v => v.dir === 'c2j' },
      ],
      compute(t, o) {
        if (!t.trim()) return '';
        if (o.dir === 'c2j') {
          const rows = parseCsv(t, o.delim);
          const conv = v => o.numbers && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.replace(',', '.')) : v;
          if (!o.header) return JSON.stringify(rows.map(r => r.map(conv)), null, 2);
          const [head, ...body] = rows;
          return JSON.stringify(body.map(r => Object.fromEntries(head.map((h, i) => [h || `col${i + 1}`, conv(r[i] ?? '')]))), null, 2);
        }
        let data;
        try { data = JSON.parse(t); } catch (e) { throw new Error(jsonError(e, t)); }
        if (!Array.isArray(data)) data = [data];
        const d = o.delim === 'auto' ? ';' : o.delim;
        if (data.every(Array.isArray)) return data.map(r => r.map(v => csvCell(v, d)).join(d)).join('\n');
        const keys = [...new Set(data.flatMap(r => Object.keys(r || {})))];
        return [keys.map(k => csvCell(k, d)).join(d), ...data.map(r => keys.map(k => csvCell(r?.[k], d)).join(d))].join('\n');
      },
    });
  },
});

/* ===================== QR-коды ===================== */

function qrMatrix(text, level) {
  const qr = qrcode(0, level);
  qrcode.stringToBytes = s => [...utf8(s)];
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

tool({
  id: 'qr-generator', cat: 'dev', badge: 'QR', title: 'Генератор QR-кодов',
  desc: 'QR-код для ссылки, текста, Wi-Fi или визитки. Скачайте в PNG или SVG.',
  render(root) {
    const form = buildForm('qr', [
      { id: 'type', label: 'Что закодировать', type: 'select', choices: [['text', 'Ссылку или текст'], ['wifi', 'Wi-Fi сеть'], ['vcard', 'Контакт (визитку)'], ['tel', 'Номер телефона'], ['mail', 'E-mail']] },
      { id: 'text', label: 'Ссылка или текст', type: 'textarea', rows: 3, value: 'https://example.ru', showIf: v => v.type === 'text' },
      { id: 'ssid', label: 'Название сети', value: 'Home_WiFi', showIf: v => v.type === 'wifi' },
      { id: 'pass', label: 'Пароль', value: '', showIf: v => v.type === 'wifi' },
      { id: 'enc', label: 'Защита', type: 'select', choices: [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'Без пароля']], showIf: v => v.type === 'wifi' },
      { id: 'name', label: 'Имя и фамилия', value: 'Иван Петров', showIf: v => v.type === 'vcard' },
      { id: 'org', label: 'Компания', value: '', showIf: v => v.type === 'vcard' },
      { id: 'phone', label: 'Телефон', value: '+7 900 000-00-00', showIf: v => v.type === 'vcard' || v.type === 'tel' },
      { id: 'email', label: 'E-mail', value: '', showIf: v => v.type === 'vcard' || v.type === 'mail' },
      { id: 'site', label: 'Сайт', value: '', showIf: v => v.type === 'vcard' },
      { id: 'size', label: 'Размер картинки', type: 'select', value: '1024', choices: [['256', '256 px'], ['512', '512 px'], ['1024', '1024 px'], ['2048', '2048 px — для печати']] },
      { id: 'level', label: 'Устойчивость к повреждениям', type: 'select', value: 'M', choices: [['L', 'Низкая — 7%'], ['M', 'Средняя — 15%'], ['Q', 'Высокая — 25%'], ['H', 'Максимальная — 30%']] },
      { id: 'fg', label: 'Цвет кода', type: 'color', value: '#111111' },
      { id: 'bg', label: 'Цвет фона', type: 'color', value: '#ffffff' },
    ]);
    const canvas = el('canvas', { class: 'qr-canvas', width: 320, height: 320 });
    const err = el('div', { class: 'status' });
    const payload = o => {
      const esc = s => s.replace(/([\\;,:"])/g, '\\$1');
      if (o.type === 'wifi') return `WIFI:T:${o.enc};S:${esc(o.ssid)};${o.enc !== 'nopass' ? `P:${esc(o.pass)};` : ''};`;
      if (o.type === 'vcard') return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${o.name}`, `N:${o.name.split(' ').reverse().join(';')};;;`, o.org && `ORG:${o.org}`, o.phone && `TEL;TYPE=CELL:${o.phone}`, o.email && `EMAIL:${o.email}`, o.site && `URL:${o.site}`, 'END:VCARD'].filter(Boolean).join('\n');
      if (o.type === 'tel') return `tel:${o.phone.replace(/[^\d+]/g, '')}`;
      if (o.type === 'mail') return `mailto:${o.email}`;
      return o.text;
    };
    let qr = null;
    const paint = (c, px, o) => {
      const n = qr.getModuleCount(), quiet = 4, cell = px / (n + quiet * 2);
      c.width = c.height = px;
      const ctx = c.getContext('2d');
      ctx.fillStyle = o.bg; ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = o.fg;
      for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) ctx.fillRect(Math.floor((q + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    };
    const update = async () => {
      err.replaceChildren();
      try {
        await loadLib('qrcode');
        const o = form.values(), data = payload(o);
        if (!data.trim()) throw new Error('Введите данные для QR-кода.');
        qr = qrMatrix(data, o.level);
        paint(canvas, 640, o);
      } catch (e) { qr = null; setStatus(err, 'error', /overflow|length/i.test(e.message || e) ? 'Слишком много данных для QR-кода — сократите текст или снизьте устойчивость.' : (e.message || String(e))); }
    };
    const savePng = async () => {
      if (!qr) return;
      const o = form.values(), c = makeCanvas(1, 1);
      paint(c, Number(o.size), o);
      download(await canvasBlob(c), 'qr-code.png');
    };
    const saveSvg = () => {
      if (!qr) return;
      const o = form.values(), n = qr.getModuleCount(), q = 4, s = n + q * 2;
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
      download(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="${o.bg}"/><path d="${d}" fill="${o.fg}"/></svg>`], { type: 'image/svg+xml' }), 'qr-code.svg');
    };
    form.el.addEventListener('input', update);
    form.el.addEventListener('change', update);
    root.append(el('div', { class: 'workspace' },
      el('div', { class: 'ws-files qr-preview' }, canvas, err,
        el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'button', onclick: savePng }, 'Скачать PNG'), el('button', { class: 'btn', type: 'button', onclick: saveSvg }, 'Скачать SVG — для печати'))),
      el('div', { class: 'ws-side' }, form.el)));
    update();
  },
});

tool({
  id: 'qr-scanner', cat: 'dev', badge: '⌖QR', title: 'Сканер QR-кодов',
  desc: 'Прочитайте QR-код с картинки, скриншота или камерой телефона.',
  render(root) {
    const out = el('div', { class: 'qr-result' });
    const video = el('video', { class: 'qr-video', playsinline: true, muted: true, hidden: true });
    let stream = null;
    const show = data => {
      const isUrl = /^https?:\/\//i.test(data);
      const wifi = data.match(/^WIFI:(.*)$/i);
      const ta = el('textarea', { class: 'text-out mono', rows: 4, readonly: true, value: data, 'aria-label': 'Содержимое QR-кода' });
      out.replaceChildren(el('div', { class: 'results' },
        el('div', { class: 'results-head' }, el('h2', {}, 'QR-код прочитан')),
        wifi && el('p', {}, `Wi-Fi: сеть «${(data.match(/S:((?:\\.|[^;])*)/) || [, ''])[1]}», пароль «${(data.match(/P:((?:\\.|[^;])*)/) || [, ''])[1]}»`),
        ta,
        el('div', { class: 'row' }, copyButton(() => data, ta), isUrl && el('a', { class: 'btn primary', href: data, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть ссылку'))));
    };
    const scanCanvas = c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    };
    const dz = dropzone({ accept: IMG_ACCEPT, label: 'Выберите картинку с QR-кодом', hint: 'Фото, скриншот, PNG, JPG', onFiles: async ([f]) => {
      await loadLib('jsqr');
      const img = await loadImage(f);
      for (const max of [1200, 800, 2000, 500]) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const r = scanCanvas(drawImageCanvas(img, img.naturalWidth * k, img.naturalHeight * k, { fill: '#fff' }));
        if (r) return show(r.data);
      }
      out.replaceChildren(el('p', { class: 'status-msg error' }, 'QR-код не найден. Попробуйте обрезать картинку вокруг кода или сфотографировать ровнее.'));
    } });
    const camBtn = el('button', { class: 'btn', type: 'button' }, 'Сканировать камерой');
    const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; video.hidden = true; camBtn.textContent = 'Сканировать камерой'; };
    camBtn.addEventListener('click', async () => {
      if (stream) return stop();
      try {
        await loadLib('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream; video.hidden = false; await video.play();
        camBtn.textContent = 'Остановить камеру';
        const c = makeCanvas(1, 1);
        const loop = () => {
          if (!stream) return;
          if (video.videoWidth) {
            c.width = video.videoWidth; c.height = video.videoHeight;
            c.getContext('2d').drawImage(video, 0, 0);
            const r = scanCanvas(c);
            if (r) { show(r.data); stop(); return; }
          }
          requestAnimationFrame(loop);
        };
        loop();
      } catch { stop(); out.replaceChildren(el('p', { class: 'status-msg error' }, 'Нет доступа к камере. Разрешите доступ в браузере или загрузите фото QR-кода.')); }
    });
    root.append(dz, el('div', { class: 'row' }, camBtn), video, out);
  },
});
