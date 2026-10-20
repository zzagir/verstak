'use strict';

/* ===================== Транслитерация для SEO ===================== */

const TR_BASE = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', ы: 'y', э: 'e',
  // украинский и белорусский
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

const TR_SYSTEMS = {
  yandex: {
    label: 'Яндекс / SEO — для ЧПУ',
    map: { ё: 'e', ж: 'zh', й: 'y', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ь: '', ю: 'yu', я: 'ya' },
  },
  gost: {
    label: 'ГОСТ 7.79-2000, система Б',
    map: { ё: 'yo', ж: 'zh', й: 'j', х: 'x', ц: 'cz', ч: 'ch', ш: 'sh', щ: 'shh', ъ: '', ь: '', ю: 'yu', я: 'ya' },
  },
  mvd: {
    label: 'Загранпаспорт (МВД, ICAO)',
    map: { ё: 'e', ж: 'zh', й: 'i', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ie', ь: '', ю: 'iu', я: 'ia' },
  },
  bgn: {
    label: 'Научная (BGN/PCGN)',
    map: { ё: 'yo', ж: 'zh', й: 'y', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ь: '', ю: 'yu', я: 'ya' },
  },
};

const STOP_WORDS = new Set('и в во на с со по для о об от до из за к ко у а но или'.split(' '));

function translit(text, system) {
  const map = { ...TR_BASE, ...TR_SYSTEMS[system].map };
  const chars = [...text];
  return chars.map((ch, i) => {
    const low = ch.toLowerCase();
    const r = map[low];
    if (r == null) return ch;
    if (ch === low || !r) return r;
    // Заглавная: «Щука» → «Shchuka», «ЩУКА» → «SHCHUKA»
    const next = chars[i + 1] || '', prev = chars[i - 1] || '';
    const allCaps = (next && next !== next.toLowerCase()) || (!next && prev && prev !== prev.toLowerCase());
    return allCaps ? r.toUpperCase() : r[0].toUpperCase() + r.slice(1);
  }).join('');
}

function slugify(text, o) {
  let s = text;
  if (o.stop) s = s.split(/\s+/).filter(w => !STOP_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu, ''))).join(' ');
  if (o.lower) s = s.toLowerCase();
  s = translit(s, o.system).replace(/&/g, ' and ');
  const sep = o.sep;
  s = s.replace(/['’`"]/g, '').replace(/[^A-Za-z0-9]+/g, sep).replace(new RegExp(`\\${sep}+`, 'g'), sep).replace(new RegExp(`^\\${sep}|\\${sep}$`, 'g'), '');
  if (o.max > 0 && s.length > o.max) {
    const cut = s.slice(0, o.max);
    const at = cut.lastIndexOf(sep);
    s = at > o.max * 0.5 ? cut.slice(0, at) : cut;
  }
  return s;
}

tool({
  id: 'translit-seo', cat: 'text', badge: 'Я→Ya', title: 'Транслит для SEO',
  desc: 'Превратите заголовок в ЧПУ-адрес страницы: kak-vybrat-noutbuk.',
  render(root) {
    const input = el('textarea', { id: 'tr-input', rows: 6, class: 'text-in', spellcheck: 'false',
      value: 'Как выбрать ноутбук для работы в 2026 году\nЛучшие рецепты щей и борща\nДоставка цветов по Москве — недорого!' });
    const form = buildForm('tr', [
      { id: 'system', label: 'Система транслитерации', type: 'select', choices: Object.entries(TR_SYSTEMS).map(([k, s]) => [k, s.label]) },
      { id: 'sep', label: 'Разделитель слов', type: 'select', choices: [['-', 'Дефис: kak-vybrat'], ['_', 'Подчёркивание: kak_vybrat']] },
      { id: 'max', label: 'Максимальная длина', type: 'select', value: '0', choices: [['0', 'Без ограничения'], ['50', '50 символов'], ['75', '75 символов'], ['100', '100 символов']] },
      { id: 'lower', label: 'Только строчные буквы', type: 'checkbox', value: true },
      { id: 'stop', label: 'Убрать предлоги и союзы (в, на, для, и…)', type: 'checkbox' },
    ]);
    const slugOut = el('textarea', { id: 'tr-slug', rows: 6, class: 'text-out mono', readonly: true });
    const fullOut = el('textarea', { id: 'tr-full', rows: 6, class: 'text-out', readonly: true });
    const prefix = el('input', { id: 'tr-prefix', type: 'text', placeholder: 'https://site.ru/blog/', value: '' });
    const preview = el('div', { class: 'url-preview mono' });

    const update = () => {
      const o = form.values();
      o.max = Number(o.max);
      const lines = input.value.split('\n');
      const slugs = lines.map(l => l.trim() ? slugify(l, o) : '');
      slugOut.value = slugs.join('\n');
      fullOut.value = lines.map(l => translit(l, o.system)).join('\n');
      const first = slugs.find(Boolean) || '';
      preview.replaceChildren(el('span', { class: 'muted' }, prefix.value || 'https://site.ru/'), el('strong', {}, first));
    };
    [input, prefix].forEach(n => n.addEventListener('input', update));
    form.el.addEventListener('input', update);
    form.el.addEventListener('change', update);
    update();

    root.append(el('div', { class: 'text-tool' },
      el('div', { class: 'text-main' },
        el('label', { for: 'tr-input', class: 'block-label' }, 'Текст на русском — каждая строка обрабатывается отдельно'),
        input,
        el('div', { class: 'row' }, el('button', { class: 'btn ghost', type: 'button', onclick: () => { input.value = ''; update(); input.focus(); } }, 'Очистить')),
        el('label', { for: 'tr-slug', class: 'block-label' }, 'ЧПУ (адрес страницы)'),
        slugOut,
        el('div', { class: 'row' }, copyButton(() => slugOut.value, slugOut, 'Копировать ЧПУ')),
        el('label', { for: 'tr-full', class: 'block-label' }, 'Транслитерация с сохранением регистра и знаков'),
        fullOut,
        el('div', { class: 'row' }, copyButton(() => fullOut.value, fullOut, 'Копировать транслит'))),
      el('div', { class: 'ws-side' },
        form.el,
        el('div', { class: 'field' }, el('label', { for: 'tr-prefix' }, 'Адрес сайта для предпросмотра'), prefix),
        el('div', { class: 'field' }, el('span', { class: 'block-label' }, 'Так будет выглядеть ссылка'), preview),
        el('details', { class: 'table-details' }, el('summary', {}, 'Таблица замен'), trTable()))));

    function trTable() {
      const letters = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.split('');
      const keys = Object.keys(TR_SYSTEMS);
      return el('div', { class: 'table-scroll' }, el('table', { class: 'tr-table' },
        el('thead', {}, el('tr', {}, el('th', {}, ''), keys.map(k => el('th', {}, TR_SYSTEMS[k].label.split(/[ ,—(]/)[0])))),
        el('tbody', {}, letters.map(l => el('tr', {}, el('th', {}, l), keys.map(k => el('td', { class: 'mono' }, translit(l, k) || '—')))))));
    }
  },
});

/* ===================== Регистр текста ===================== */

const SMALL_WORDS = new Set('a an the and but or nor for so yet as at by in of on to up via vs и в во на с со по для о об от до из за к у а но или'.split(' '));

const CASES = [
  ['sentence', 'Как в предложении', t => {
    const s = t.toLowerCase().replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return s.replace(/\bi\b/g, 'I');
  }],
  ['lower', 'строчные', t => t.toLowerCase()],
  ['upper', 'ПРОПИСНЫЕ', t => t.toUpperCase()],
  ['capital', 'Каждое Слово С Заглавной', t => t.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())],
  ['title', 'Заголовок (Title Case)', t => t.split('\n').map(line => {
    const words = line.toLowerCase().split(/(\s+)/);
    const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter(i => i >= 0);
    const first = idx[0], last = idx[idx.length - 1];
    return words.map((w, i) => {
      if (!/\S/.test(w)) return w;
      const bare = w.replace(/[^\p{L}]/gu, '');
      if (i !== first && i !== last && SMALL_WORDS.has(bare)) return w;
      return w.replace(/\p{L}/u, c => c.toUpperCase());
    }).join('');
  }).join('\n')],
  ['alternating', 'чЕрЕдОвАнИе', t => { let k = 0; return [...t].map(c => c.toLowerCase() !== c.toUpperCase() ? (k++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c).join(''); }],
  ['inverse', 'иНВЕРСИЯ рЕГИСТРА', t => [...t].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('')],
];

function textStats(t) {
  return [
    ['Символов', [...t].length],
    ['Без пробелов', [...t.replace(/\s/g, '')].length],
    ['Слов', (t.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length],
    ['Предложений', (t.match(/[^.!?…]*[\p{L}\p{N}][^.!?…]*([.!?…]+|$)/gu) || []).filter(s => s.trim()).length],
    ['Строк', t ? t.split('\n').length : 0],
  ];
}

tool({
  id: 'convert-case', cat: 'text', badge: 'Aa', title: 'Регистр текста',
  desc: 'Строчные, ПРОПИСНЫЕ, Как В Заголовке и ещё четыре варианта в один клик.',
  render(root) {
    const ta = el('textarea', { id: 'case-text', class: 'text-in', rows: 12, spellcheck: 'false',
      value: 'вставьте сюда текст. ВЫБЕРИТЕ нужный регистр кнопкой ниже — и результат сразу появится в этом же поле.\nthe quick brown fox jumps over the lazy dog.' });
    const stats = el('dl', { class: 'stats' });
    const history = [];
    const updateStats = () => stats.replaceChildren(...textStats(ta.value).map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v.toLocaleString('ru-RU')))));
    const apply = fn => { history.push(ta.value); ta.value = fn(ta.value); updateStats(); undo.disabled = false; };
    const undo = el('button', { class: 'btn ghost', type: 'button', disabled: true, onclick: () => { if (history.length) ta.value = history.pop(); undo.disabled = !history.length; updateStats(); } }, 'Отменить');
    ta.addEventListener('input', updateStats);
    updateStats();

    root.append(el('div', { class: 'text-tool single' },
      el('label', { for: 'case-text', class: 'block-label' }, 'Ваш текст'),
      ta,
      el('div', { class: 'case-buttons' }, CASES.map(([id, label, fn]) => el('button', { class: 'btn case', type: 'button', onclick: () => apply(fn) }, label))),
      el('div', { class: 'row' },
        copyButton(() => ta.value, ta),
        el('button', { class: 'btn', type: 'button', onclick: () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), 'text.txt') }, 'Скачать .txt'),
        el('button', { class: 'btn', type: 'button', onclick: () => apply(t => t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()) }, 'Убрать лишние пробелы'),
        el('button', { class: 'btn', type: 'button', onclick: () => apply(t => t.replace(/\s*\n+\s*/g, ' ')) }, 'Убрать переносы строк'),
        undo,
        el('button', { class: 'btn ghost', type: 'button', onclick: () => apply(() => '') }, 'Очистить')),
      stats));
  },
});

/* ===================== Обратный транслит и живой набор ===================== */

const LAT2CYR = [
  ['shch', 'щ'], ['sch', 'щ'], ['yo', 'ё'], ['jo', 'ё'], ['yu', 'ю'], ['ju', 'ю'], ['ya', 'я'], ['ja', 'я'], ['ye', 'е'],
  ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ["e'", 'э'], ["''", 'ъ'], ['#', 'ъ'], ["'", 'ь'],
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['w', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'],
  ['y', 'ы'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'],
  ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['x', 'кс'], ['c', 'ц'], ['q', 'к'],
];
const VOWEL = /[aeiouyаеёиоуыэюя]/i;

function lat2cyr(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i).toLowerCase();
    const hit = LAT2CYR.find(([l]) => rest.startsWith(l));
    if (!hit) { out += text[i++]; continue; }
    let [l, c] = hit;
    // «y» после гласной перед согласной или в конце слова — это «й»: kray → край, mayka → майка
    if (l === 'y' && i > 0 && VOWEL.test(text[i - 1]) && !VOWEL.test(text[i + 1] || '')) c = 'й';
    // «ye» в середине слова после согласной обычно «ые»: krasnye → красные
    if (l === 'ye' && i > 0 && /[a-z]/i.test(text[i - 1]) && !VOWEL.test(text[i - 1])) c = 'ые';
    const src = text.slice(i, i + l.length);
    if (src[0] !== src[0].toLowerCase()) c = src.length > 1 && src === src.toUpperCase() && /[A-Z]{2}/.test(src) ? c.toUpperCase() : c[0].toUpperCase() + c.slice(1);
    out += c;
    i += l.length;
  }
  return out;
}

tool({
  id: 'translit-online', cat: 'text', badge: 'Ya→Я', title: 'Транслит онлайн',
  desc: 'Печатайте латиницей — текст сразу превращается в русский. И обратно.',
  render(root) {
    liveTextTool(root, {
      id: 'tro', rows: 9, inLabel: 'Текст', outLabel: 'Результат',
      input: 'Privet! Kak dela? Segodnya otlichnaya pogoda, poydyom gulyat\'.\nShchuka, zhuk, yozh i cherepakha.',
      options: [
        { id: 'dir', label: 'Направление', type: 'select', choices: [['l2c', 'Латиница → кириллица'], ['c2l', 'Кириллица → латиница']] },
        { id: 'system', label: 'Система', type: 'select', choices: Object.entries(TR_SYSTEMS).map(([k, s]) => [k, s.label]), showIf: v => v.dir === 'c2l' },
      ],
      compute: (t, o) => o.dir === 'l2c' ? lat2cyr(t) : translit(t, o.system),
      extra: () => el('details', { class: 'table-details' }, el('summary', {}, 'Как набирать'),
        el('div', { class: 'table-scroll' }, el('table', { class: 'tr-table' }, el('tbody', {},
          [['zh', 'ж'], ['kh, h', 'х'], ['ts, c', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['shch, sch', 'щ'], ['yo, jo', 'ё'], ['yu, ju', 'ю'], ['ya, ja', 'я'], ['j', 'й'], ['y', 'ы (после гласной — й)'], ["e'", 'э'], ["'", 'ь'], ["'' или #", 'ъ']]
            .map(([a, b]) => el('tr', {}, el('td', { class: 'mono' }, a), el('td', {}, b))))))),
    });
  },
});

/* ===================== Раскладка клавиатуры ===================== */

const KB_EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?@#$^&|";
const KB_RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,"№;:?/';
const kbMap = (from, to) => { const m = {}; [...from].forEach((c, i) => (m[c] = to[i])); return m; };
const EN2RU = kbMap(KB_EN, KB_RU), RU2EN = kbMap(KB_RU, KB_EN);

function fixLayout(text, dir) {
  if (dir === 'auto') {
    const lat = (text.match(/[a-z]/gi) || []).length, cyr = (text.match(/[а-яё]/gi) || []).length;
    dir = lat >= cyr ? 'en2ru' : 'ru2en';
  }
  const map = dir === 'en2ru' ? EN2RU : RU2EN;
  return [...text].map(c => map[c] ?? c).join('');
}

tool({
  id: 'keyboard-layout', cat: 'text', badge: 'Ghb', title: 'Исправить раскладку',
  desc: 'Набрали «ghbdtn» вместо «привет»? Верните текст в нужную раскладку.',
  render(root) {
    liveTextTool(root, {
      id: 'kbl', rows: 7, inLabel: 'Текст в неправильной раскладке',
      input: 'Ghbdtn? rfr ltkf? Z yt pfvtnbk? xnj gtxfnf. yf fyukbqcrjv/',
      options: [{ id: 'dir', label: 'Направление', type: 'select', choices: [['auto', 'Определить автоматически'], ['en2ru', 'Английская → русская (ghbdtn → привет)'], ['ru2en', 'Русская → английская (руддщ → hello)']] }],
      compute: (t, o) => fixLayout(t, o.dir),
    });
  },
});

/* ===================== Виртуальная русская клавиатура ===================== */

const VK_ROWS = [
  [['Backquote', 'ё', 'Ё'], ['Digit1', '1', '!'], ['Digit2', '2', '"'], ['Digit3', '3', '№'], ['Digit4', '4', ';'], ['Digit5', '5', '%'], ['Digit6', '6', ':'], ['Digit7', '7', '?'], ['Digit8', '8', '*'], ['Digit9', '9', '('], ['Digit0', '0', ')'], ['Minus', '-', '_'], ['Equal', '=', '+'], ['Backspace', '⌫']],
  [['KeyQ', 'й'], ['KeyW', 'ц'], ['KeyE', 'у'], ['KeyR', 'к'], ['KeyT', 'е'], ['KeyY', 'н'], ['KeyU', 'г'], ['KeyI', 'ш'], ['KeyO', 'щ'], ['KeyP', 'з'], ['BracketLeft', 'х'], ['BracketRight', 'ъ'], ['Backslash', '\\', '/']],
  [['CapsLock', 'Caps'], ['KeyA', 'ф'], ['KeyS', 'ы'], ['KeyD', 'в'], ['KeyF', 'а'], ['KeyG', 'п'], ['KeyH', 'р'], ['KeyJ', 'о'], ['KeyK', 'л'], ['KeyL', 'д'], ['Semicolon', 'ж'], ['Quote', 'э'], ['Enter', '↵']],
  [['ShiftLeft', 'Shift'], ['KeyZ', 'я'], ['KeyX', 'ч'], ['KeyC', 'с'], ['KeyV', 'м'], ['KeyB', 'и'], ['KeyN', 'т'], ['KeyM', 'ь'], ['Comma', 'б'], ['Period', 'ю'], ['Slash', '.', ','], ['ShiftRight', 'Shift']],
  [['Space', 'Пробел']],
];

tool({
  id: 'russian-keyboard', cat: 'text', badge: 'ЙЦУ', title: 'Русская клавиатура',
  desc: 'Виртуальная клавиатура ЙЦУКЕН: печатайте по-русски без русской раскладки.',
  render(root) {
    let shift = false, caps = false;
    const ta = el('textarea', { id: 'vk-text', class: 'text-in vk-text', rows: 6, placeholder: 'Нажимайте на клавиши ниже или печатайте на обычной клавиатуре' });
    const phys = el('input', { type: 'checkbox', id: 'vk-phys', checked: true });
    const keys = {};
    const kb = el('div', { class: 'vk' }, VK_ROWS.map(row => el('div', { class: 'vk-row' }, row.map(([code, lo, up]) => {
      const b = el('button', { class: `vk-key k-${code}`, type: 'button', 'data-code': code, tabindex: -1 }, lo);
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => press(code));
      keys[code] = { b, lo, up };
      return b;
    }))));
    const insert = s => { ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); };
    const charFor = code => {
      const k = keys[code];
      if (!k || k.lo.length > 1 && !['Space'].includes(code)) return null;
      if (code === 'Space') return ' ';
      const letter = /[а-яё]/.test(k.lo);
      const upper = letter ? shift !== caps : shift;
      return upper ? (k.up || k.lo.toUpperCase()) : k.lo;
    };
    const refresh = () => {
      for (const [code, k] of Object.entries(keys)) if (k.lo.length === 1) k.b.textContent = charFor(code);
      keys.ShiftLeft.b.classList.toggle('on', shift); keys.ShiftRight.b.classList.toggle('on', shift); keys.CapsLock.b.classList.toggle('on', caps);
    };
    function press(code) {
      if (code === 'Backspace') {
        const s = ta.selectionStart, e = ta.selectionEnd;
        if (s === e && s > 0) ta.setRangeText('', s - 1, s, 'end'); else ta.setRangeText('', s, e, 'end');
      } else if (code === 'Enter') insert('\n');
      else if (code === 'CapsLock') caps = !caps;
      else if (code.startsWith('Shift')) shift = !shift;
      else { const c = charFor(code); if (c) insert(c); if (shift) shift = false; }
      refresh();
      ta.focus();
    }
    ta.addEventListener('keydown', e => {
      if (!phys.checked || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys[e.code];
      if (!k || k.lo.length > 1) return;
      e.preventDefault();
      const prevShift = shift;
      shift = e.shiftKey;
      caps = e.getModifierState && e.getModifierState('CapsLock');
      insert(charFor(e.code));
      shift = prevShift;
      flash(k.b);
    });
    const flash = b => { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); };
    refresh();
    root.append(el('div', { class: 'text-tool single' },
      ta,
      el('label', { class: 'field check' }, phys, el('span', {}, 'Обычная клавиатура тоже печатает по-русски (по расположению клавиш)')),
      kb,
      el('div', { class: 'row' }, copyButton(() => ta.value, ta), el('button', { class: 'btn ghost', type: 'button', onclick: () => { ta.value = ''; ta.focus(); } }, 'Очистить'))));
  },
});

/* ===================== Типограф ===================== */

function typograf(src, o) {
  let t = src.replace(/\r/g, '');
  let n = 0;
  const rep = (re, to) => { t = t.replace(re, (...a) => { n++; return typeof to === 'function' ? to(...a) : a[0].replace(re, to); }); };
  rep(/[ \t]{2,}/g, ' ');
  rep(/\.{3}/g, '…');
  rep(/\((c|с)\)/gi, '©'); rep(/\(r\)/gi, '®'); rep(/\(tm\)/gi, '™'); rep(/\+-/g, '±');
  if (o.quotes) {
    let depth = 0, out = '';
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c !== '"' && c !== '«' && c !== '»' && c !== '„' && c !== '“') { out += c; continue; }
      const prev = t[i - 1] || ' ';
      const open = c === '«' || c === '„' || (c === '"' || c === '“') && /[\s(\[{—–\-/«„]/.test(prev);
      if (open) { out += depth % 2 ? '„' : '«'; depth++; }
      else { depth = Math.max(0, depth - 1); out += depth % 2 ? '“' : '»'; }
      if (c === '"') n++;
    }
    t = out;
  }
  if (o.dashes) {
    rep(/(^|\n)[-–—] /g, (m, a) => `${a}— `);
    rep(/(\S) +[-–—] +/g, (m, a) => `${a} — `);
    rep(/(?<![\d-])(\d{1,4}) ?[-–] ?(\d{1,4})(?![\d-])/g, (m, a, b) => `${a}–${b}`);
  }
  if (o.nbsp) {
    for (let k = 0; k < 2; k++) rep(/(^|[\s(«„ ])([а-яёa-z]{1,2}) (?=\S)/gim, (m, a, w) => `${a}${w} `);
    rep(/ (же|ли|ль|бы|б|ж)(?=[\s.,!?…;:]|$)/gim, (m, w) => ` ${w}`);
    rep(/(\d) (%|₽|руб\.|р\.|коп\.|тыс\.|млн|млрд|кг|г|т|м|км|см|мм|л|мл|шт\.|°|\$|€|€)/g, (m, d, u) => `${d} ${u}`);
    rep(/(№|§) ?(\d)/g, (m, s, d) => `${s} ${d}`);
    rep(/([А-ЯЁA-Z]\.) ?(?=[А-ЯЁA-Z][.а-яёa-z])/g, (m, a) => `${a} `);
  }
  if (o.entities) {
    const E = { ' ': '&nbsp;', '«': '&laquo;', '»': '&raquo;', '„': '&bdquo;', '“': '&ldquo;', '—': '&mdash;', '–': '&ndash;', '…': '&hellip;', '©': '&copy;', '®': '&reg;', '™': '&trade;', '±': '&plusmn;' };
    t = t.replace(/[ «»„“—–…©®™±]/g, c => E[c]);
  }
  return { text: t, n };
}

tool({
  id: 'typograf', cat: 'text', badge: '«»', title: 'Типограф',
  desc: 'Расставит «ёлочки», длинные тире, неразрывные пробелы и уберёт лишние пробелы.',
  render(root) {
    const info = el('p', { class: 'hint' });
    liveTextTool(root, {
      id: 'typo', rows: 9, inLabel: 'Исходный текст',
      input: 'Компания "Ромашка" - лидер рынка с 2005-2026 гг.  Мы доставим  заказ за 2 часа...\nВ магазине "Мир "Книги"" скидка 15 % на всё (с) 2026',
      options: [
        { id: 'quotes', label: 'Кавычки «ёлочки» и „лапки“', type: 'checkbox', value: true },
        { id: 'dashes', label: 'Тире вместо дефисов', type: 'checkbox', value: true },
        { id: 'nbsp', label: 'Неразрывные пробелы (предлоги, единицы, инициалы)', type: 'checkbox', value: true },
        { id: 'entities', label: 'Вывести HTML-мнемониками (&nbsp; &laquo;)', type: 'checkbox' },
      ],
      compute: (t, o) => { const r = typograf(t, o); info.textContent = `Исправлений: ${r.n}. Неразрывные пробелы невидимы, но сохраняются при копировании.`; return r.text; },
      extra: () => info,
    });
  },
});

/* ===================== Сумма прописью ===================== */

const NW = {
  units: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  unitsF: ['', 'одна', 'две'],
  teens: ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
  tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
  hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
  scales: [[['тысяча', 'тысячи', 'тысяч'], true], [['миллион', 'миллиона', 'миллионов'], false], [['миллиард', 'миллиарда', 'миллиардов'], false], [['триллион', 'триллиона', 'триллионов'], false]],
};

function triadWords(n, fem) {
  const w = [NW.hundreds[Math.floor(n / 100)]];
  const t = n % 100;
  if (t >= 10 && t < 20) w.push(NW.teens[t - 10]);
  else { w.push(NW.tens[Math.floor(t / 10)]); const u = t % 10; w.push(fem && u < 3 ? NW.unitsF[u] : NW.units[u]); }
  return w.filter(Boolean).join(' ');
}

/** Целое число прописью; fem — женский род («одна», «две»). */
function intWords(n, fem = false) {
  n = BigInt(n);
  if (n === 0n) return 'ноль';
  if (n >= 10n ** 15n) throw new Error('Слишком большое число: поддерживается до 999 триллионов.');
  const parts = [];
  let i = -1;
  while (n > 0n) {
    const tr = Number(n % 1000n);
    if (tr) {
      if (i < 0) parts.unshift(triadWords(tr, fem));
      else { const [forms, f] = NW.scales[i]; parts.unshift(`${triadWords(tr, f)} ${plural(tr, forms)}`); }
    }
    n /= 1000n; i++;
  }
  return parts.join(' ');
}

const CURRENCIES = {
  none: null,
  rub: { main: ['рубль', 'рубля', 'рублей'], fem: false, sub: ['копейка', 'копейки', 'копеек'], subFem: true },
  usd: { main: ['доллар США', 'доллара США', 'долларов США'], fem: false, sub: ['цент', 'цента', 'центов'], subFem: false },
  eur: { main: ['евро', 'евро', 'евро'], fem: false, sub: ['цент', 'цента', 'центов'], subFem: false },
  kzt: { main: ['тенге', 'тенге', 'тенге'], fem: false, sub: ['тиын', 'тиына', 'тиынов'], subFem: false },
  byn: { main: ['белорусский рубль', 'белорусских рубля', 'белорусских рублей'], fem: false, sub: ['копейка', 'копейки', 'копеек'], subFem: true },
};

function lastForm(nStr) { return Number(nStr.slice(-2)); }

function amountWords(raw, o) {
  const s = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Введите число, например 1234,56');
  const neg = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  const cur = CURRENCIES[o.currency];
  let text;
  if (!cur) {
    if (!frac) text = intWords(int);
    else {
      const f = frac.slice(0, 6).replace(/0+$/, '') || '0';
      const den = [['десятая', 'десятых', 'десятых'], ['сотая', 'сотых', 'сотых'], ['тысячная', 'тысячных', 'тысячных'], ['десятитысячная', 'десятитысячных', 'десятитысячных'], ['стотысячная', 'стотысячных', 'стотысячных'], ['миллионная', 'миллионных', 'миллионных']][f.length - 1];
      text = `${intWords(int, true)} ${plural(lastForm(int), ['целая', 'целых', 'целых'])} ${intWords(f, true)} ${plural(lastForm(f), den)}`;
    }
  } else {
    const cents = (frac + '00').slice(0, 2);
    const mainWords = intWords(int, cur.fem);
    const mainUnit = plural(lastForm(int), cur.main), subUnit = plural(Number(cents), cur.sub);
    const fmtInt = Number(int).toLocaleString('ru-RU');
    if (o.style === 'mixed') text = `${fmtInt} (${mainWords}) ${mainUnit} ${cents} ${subUnit}`;
    else if (o.style === 'words') text = `${mainWords} ${mainUnit} ${intWords(cents, cur.subFem)} ${subUnit}`;
    else text = `${mainWords} ${mainUnit} ${cents} ${subUnit}`;
  }
  if (neg) text = 'минус ' + text;
  return o.cap ? text[0].toUpperCase() + text.slice(1) : text;
}

tool({
  id: 'number-to-words', cat: 'text', badge: '123', title: 'Сумма прописью',
  desc: 'Число или сумма прописью для договоров, счетов и платёжек: рубли, доллары, евро.',
  render(root) {
    liveTextTool(root, {
      id: 'n2w', rows: 4, inLabel: 'Числа — каждое с новой строки', outLabel: 'Прописью',
      input: '1234,56\n21000\n101,01',
      options: [
        { id: 'currency', label: 'Валюта', type: 'select', choices: [['rub', 'Рубли'], ['usd', 'Доллары США'], ['eur', 'Евро'], ['kzt', 'Тенге'], ['byn', 'Белорусские рубли'], ['none', 'Просто число']] },
        { id: 'style', label: 'Формат', type: 'select', choices: [['plain', 'Сто рублей 50 копеек'], ['mixed', '100 (сто) рублей 50 копеек'], ['words', 'Сто рублей пятьдесят копеек']], showIf: v => v.currency !== 'none' },
        { id: 'cap', label: 'С заглавной буквы', type: 'checkbox', value: true },
      ],
      compute: (t, o) => t.split('\n').map(l => l.trim() ? amountWords(l, o) : '').join('\n'),
    });
  },
});

/* ===================== Частота слов и SEO-анализ ===================== */

const WATER_WORDS = new Set(('а без более бы был была были было быть в вам вас весь во вот все всего всех вы где да даже для до его ее её если есть еще ещё же за здесь и из или им их к как ко когда кто ли либо мне может мы на надо наш не него нее неё нет ни них но ну о об однако он она они оно от очень по под при с со так также такой там те тем то того тоже той только том ты у уже хотя чего чей чем что чтобы чье чья эта эти это я ' +
  'вообще конечно просто именно например действительно наверное возможно поэтому потому почти буквально фактически практически собственно значит вроде якобы самый весьма довольно бывает является являются ' +
  'the a an and or but of to in on at for with by from is are was were be been it this that as not').split(' '));

const RU_ENDINGS = ['ями', 'ами', 'иями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ую', 'юю', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ов', 'ев', 'ия', 'ие', 'ию', 'ть', 'ться', 'ешь', 'ет', 'ют', 'ут', 'ит', 'ат', 'ят', 'ла', 'ли', 'ло', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь'].sort((a, b) => b.length - a.length);
const stem = w => { if (w.length < 5) return w; const e = RU_ENDINGS.find(x => w.endsWith(x) && w.length - x.length >= 3); return e ? w.slice(0, -e.length) : w; };

function wordList(text) { return (text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []); }

function frequency(words, { n = 1, stems = false, skipWater = true, minLen = 1 } = {}) {
  const map = new Map(), forms = new Map();
  for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n);
    if (n === 1 && (g[0].length < minLen || skipWater && WATER_WORDS.has(g[0]))) continue;
    if (n > 1 && skipWater && (WATER_WORDS.has(g[0]) || WATER_WORDS.has(g[n - 1]))) continue;
    const key = (stems ? g.map(stem) : g).join(' ');
    map.set(key, (map.get(key) || 0) + 1);
    if (!forms.has(key)) forms.set(key, g.join(' '));
  }
  return [...map.entries()].map(([k, c]) => ({ key: k, word: forms.get(k), count: c })).sort((a, b) => b.count - a.count);
}

function freqTable(rows, total, limit = 30) {
  if (!rows.length) return el('p', { class: 'hint' }, 'Нет данных.');
  return el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' },
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Слово / фраза'), el('th', {}, 'Кол-во'), el('th', {}, 'Частота'))),
    el('tbody', {}, rows.slice(0, limit).map((r, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, r.word), el('td', { class: 'num' }, r.count), el('td', { class: 'num' }, `${(r.count / total * 100).toFixed(2).replace('.', ',')}%`))))));
}

tool({
  id: 'word-frequency', cat: 'text', badge: 'Σ', title: 'Частота слов',
  desc: 'Посчитайте, какие слова и фразы чаще всего встречаются в тексте.',
  render(root) {
    const ta = el('textarea', { id: 'wf-in', class: 'text-in', rows: 10, value: 'Купить ноутбук недорого можно в нашем магазине. Ноутбук для работы и учёбы: выбирайте ноутбук по цене и характеристикам. Доставка ноутбуков по всей России.' });
    const form = buildForm('wf', [
      { id: 'n', label: 'Считать', type: 'select', choices: [['1', 'Отдельные слова'], ['2', 'Фразы из 2 слов'], ['3', 'Фразы из 3 слов']] },
      { id: 'stems', label: 'Объединять словоформы (ноутбук, ноутбука, ноутбуки)', type: 'checkbox', value: true },
      { id: 'water', label: 'Не учитывать предлоги, союзы и стоп-слова', type: 'checkbox', value: true },
      { id: 'min', label: 'Минимальная длина слова', type: 'number', min: 1, value: 2 },
    ]);
    const out = el('div');
    const update = () => {
      const o = form.values(), words = wordList(ta.value);
      out.replaceChildren(el('p', { class: 'muted' }, `Всего слов: ${words.length}`), freqTable(frequency(words, { n: Number(o.n), stems: o.stems, skipWater: o.water, minLen: o.min }), Math.max(1, words.length), 100));
    };
    ta.addEventListener('input', update); form.el.addEventListener('input', update); form.el.addEventListener('change', update);
    root.append(el('div', { class: 'text-tool' }, el('div', { class: 'text-main' }, el('label', { for: 'wf-in', class: 'block-label' }, 'Текст'), ta, out), el('div', { class: 'ws-side' }, form.el)));
    update();
  },
});

tool({
  id: 'seo-text', cat: 'text', badge: 'SEO', title: 'SEO-анализ текста',
  desc: 'Тошнота, водность, ключевые слова и объём текста — как в Адвего и Текст.ру.',
  render(root) {
    const ta = el('textarea', { id: 'seo-in', class: 'text-in', rows: 12, value: 'Как выбрать ноутбук для работы? Это, конечно, вопрос, который очень часто задают покупатели. Ноутбук для работы должен быть лёгким, а также достаточно мощным. Обычно мы советуем ноутбук с 16 ГБ памяти и SSD-диском. Хороший ноутбук прослужит 5 лет и даже больше.' });
    const out = el('div', { class: 'seo-out' });
    const metric = (label, value, note, state) => el('div', { class: `metric ${state || ''}` }, el('dt', {}, label), el('dd', {}, value), note && el('small', {}, note));
    const update = () => {
      const text = ta.value, words = wordList(text), total = Math.max(1, words.length);
      const water = words.filter(w => WATER_WORDS.has(w)).length / total * 100;
      const freq = frequency(words, { stems: true, skipWater: true, minLen: 3 });
      const top = freq[0]?.count || 0;
      const classic = Math.sqrt(top), academic = top / total * 100;
      const uniq = new Set(words).size;
      const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
      out.replaceChildren(
        el('dl', { class: 'metrics' },
          metric('Символов', [...text].length.toLocaleString('ru-RU')),
          metric('Без пробелов', [...text.replace(/\s/g, '')].length.toLocaleString('ru-RU')),
          metric('Слов', words.length.toLocaleString('ru-RU')),
          metric('Уникальных слов', uniq.toLocaleString('ru-RU')),
          metric('Водность', `${fmt(water)}%`, 'норма до 15%', water > 15 ? 'warn' : 'ok'),
          metric('Классическая тошнота', fmt(classic, 2), 'норма до 4', classic > 4 ? 'warn' : 'ok'),
          metric('Академическая тошнота', `${fmt(academic)}%`, 'норма 7–9%', academic > 9 ? 'warn' : 'ok')),
        el('h2', { class: 'h3' }, 'Семантическое ядро'),
        freqTable(freq, total, 20),
        el('h2', { class: 'h3' }, 'Фразы из двух слов'),
        freqTable(frequency(words, { n: 2, stems: true }).filter(r => r.count > 1), total, 15));
    };
    ta.addEventListener('input', update);
    root.append(el('div', { class: 'text-tool single' }, el('label', { for: 'seo-in', class: 'block-label' }, 'Текст для анализа'), ta, out));
    update();
  },
});

/* ===================== Title и Description ===================== */

function textPx(text, font) {
  const ctx = textPx.ctx || (textPx.ctx = document.createElement('canvas').getContext('2d'));
  ctx.font = font;
  return ctx.measureText(text).width;
}
function cutPx(text, font, max) {
  if (textPx(text, font) <= max) return text;
  let s = text;
  while (s && textPx(s + ' …', font) > max) s = s.slice(0, -1);
  return s.replace(/\s+\S*$/, '') + ' …';
}

tool({
  id: 'serp-preview', cat: 'text', badge: '</>', title: 'Title и Description',
  desc: 'Проверьте длину мета-тегов и посмотрите, как сниппет будет выглядеть в Google и Яндексе.',
  render(root) {
    const form = buildForm('serp', [
      { id: 'title', label: 'Title', value: 'Купить ноутбук для работы недорого — каталог с ценами и доставкой по России' },
      { id: 'desc', label: 'Description', type: 'textarea', rows: 3, value: 'Ноутбуки для работы и учёбы от 29 990 ₽. Подберём модель под задачи, доставим за 1 день, гарантия 2 года. Сравнение характеристик, отзывы покупателей, рассрочка 0%.' },
      { id: 'url', label: 'Адрес страницы', value: 'https://shop.ru/catalog/noutbuki-dlya-raboty/' },
    ]);
    const out = el('div', { class: 'serp-out' });
    const gauge = (label, chars, px, [lo, hi], maxPx) => {
      const state = chars < lo ? 'warn' : chars > hi || px > maxPx ? 'bad' : 'ok';
      return el('div', { class: `metric ${state}` }, el('dt', {}, label), el('dd', {}, `${chars} симв.`),
        el('small', {}, `${Math.round(px)} из ${maxPx} px · рекомендуем ${lo}–${hi} символов`),
        el('span', { class: 'bar' }, el('span', { style: `width:${Math.min(100, px / maxPx * 100)}%` })));
    };
    const update = () => {
      const { title, desc, url } = form.values();
      const tFont = '20px Arial', dFont = '14px Arial';
      let host = url, path = '';
      try { const u = new URL(url); host = u.host; path = u.pathname.split('/').filter(Boolean).join(' › '); } catch { /* адрес без протокола */ }
      out.replaceChildren(
        el('dl', { class: 'metrics' }, gauge('Title', [...title].length, textPx(title, tFont), [30, 60], 600), gauge('Description', [...desc].length, textPx(desc, dFont), [120, 160], 920)),
        el('h2', { class: 'h3' }, 'Google'),
        el('div', { class: 'snippet google' }, el('div', { class: 'sn-url' }, host, path && el('span', {}, ` › ${path}`)), el('div', { class: 'sn-title' }, cutPx(title, tFont, 600)), el('div', { class: 'sn-desc' }, cutPx(desc, dFont, 920))),
        el('h2', { class: 'h3' }, 'Яндекс'),
        el('div', { class: 'snippet yandex' }, el('div', { class: 'sn-title' }, [...title].length > 56 ? [...title].slice(0, 56).join('').replace(/\s+\S*$/, '') + '…' : title), el('div', { class: 'sn-url' }, host), el('div', { class: 'sn-desc' }, [...desc].length > 160 ? [...desc].slice(0, 160).join('').replace(/\s+\S*$/, '') + '…' : desc)));
    };
    form.el.addEventListener('input', update);
    root.append(el('div', { class: 'text-tool' }, el('div', { class: 'text-main' }, out), el('div', { class: 'ws-side' }, form.el)));
    update();
  },
});

/* ===================== Перевернуть, строки, повтор ===================== */

tool({
  id: 'reverse-text', cat: 'text', badge: 'ʇxǝʇ', title: 'Перевернуть текст',
  desc: 'Запишите текст задом наперёд, переставьте слова или строки в обратном порядке.',
  render(root) {
    liveTextTool(root, {
      id: 'rev', rows: 6, input: 'А роза упала на лапу Азора\nПривет, мир!',
      options: [{ id: 'mode', label: 'Что переворачивать', type: 'select', choices: [['chars', 'Весь текст задом наперёд'], ['words', 'Порядок слов'], ['each', 'Каждое слово по отдельности'], ['lines', 'Порядок строк']] }],
      compute: (t, o) => {
        if (o.mode === 'chars') return [...t].reverse().join('');
        if (o.mode === 'lines') return t.split('\n').reverse().join('\n');
        return t.split('\n').map(l => o.mode === 'words' ? l.split(/(\s+)/).reverse().join('') : l.replace(/[^\s]+/g, w => [...w].reverse().join(''))).join('\n');
      },
    });
  },
});

tool({
  id: 'lines-tool', cat: 'text', badge: '≡', title: 'Обработка строк',
  desc: 'Удалите дубли, отсортируйте по алфавиту, перемешайте, пронумеруйте строки.',
  render(root) {
    const info = el('p', { class: 'hint' });
    liveTextTool(root, {
      id: 'lines', rows: 10, inLabel: 'Список — каждый пункт с новой строки',
      input: 'яблоко\nбанан\nЯблоко\nвишня\n\nбанан\nарбуз\nгруша',
      options: [
        { id: 'op', label: 'Действие', type: 'select', choices: [['dedupe', 'Удалить повторяющиеся строки'], ['az', 'Сортировать А → Я'], ['za', 'Сортировать Я → А'], ['len', 'Сортировать по длине'], ['num', 'Сортировать как числа'], ['shuffle', 'Перемешать случайно'], ['empty', 'Удалить пустые строки'], ['trim', 'Убрать пробелы по краям'], ['number', 'Пронумеровать'], ['wrap', 'Добавить текст в начало и конец']] },
        { id: 'ci', label: 'Без учёта регистра', type: 'checkbox', value: true, showIf: v => ['dedupe', 'az', 'za'].includes(v.op) },
        { id: 'prefix', label: 'В начало строки', value: '- ', showIf: v => v.op === 'wrap' },
        { id: 'suffix', label: 'В конец строки', value: ';', showIf: v => v.op === 'wrap' },
        { id: 'skipEmpty', label: 'Убрать пустые строки', type: 'checkbox', value: true },
      ],
      compute: (t, o) => {
        let lines = t.split('\n');
        const before = lines.length;
        if (o.skipEmpty) lines = lines.filter(l => l.trim());
        const key = l => o.ci ? l.toLowerCase() : l;
        const coll = new Intl.Collator('ru', { sensitivity: o.ci ? 'base' : 'variant', numeric: true });
        switch (o.op) {
          case 'dedupe': { const seen = new Set(); lines = lines.filter(l => { const k = key(l.trim()); if (seen.has(k)) return false; seen.add(k); return true; }); break; }
          case 'az': lines.sort(coll.compare); break;
          case 'za': lines.sort((a, b) => coll.compare(b, a)); break;
          case 'len': lines.sort((a, b) => a.length - b.length); break;
          case 'num': lines.sort((a, b) => (parseFloat(a.replace(',', '.')) || 0) - (parseFloat(b.replace(',', '.')) || 0)); break;
          case 'shuffle': for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; } break;
          case 'empty': lines = lines.filter(l => l.trim()); break;
          case 'trim': lines = lines.map(l => l.trim()); break;
          case 'number': lines = lines.map((l, i) => `${i + 1}. ${l}`); break;
          case 'wrap': lines = lines.map(l => o.prefix + l + o.suffix); break;
        }
        info.textContent = `Было строк: ${before}, стало: ${lines.length}.`;
        return lines.join('\n');
      },
      extra: () => info,
    });
  },
});

tool({
  id: 'repeat-text', cat: 'text', badge: '×N', title: 'Повторить текст',
  desc: 'Размножьте слово или фразу нужное количество раз.',
  render(root) {
    liveTextTool(root, {
      id: 'rep', rows: 4, input: 'Привет! ',
      options: [
        { id: 'n', label: 'Сколько раз', type: 'number', min: 1, max: 100000, value: 10 },
        { id: 'sep', label: 'Разделитель', type: 'select', choices: [['', 'Без разделителя'], [' ', 'Пробел'], ['\n', 'С новой строки'], [', ', 'Запятая']] },
        { id: 'num', label: 'Нумеровать', type: 'checkbox' },
      ],
      compute: (t, o) => {
        const n = Math.min(100000, Math.max(1, Math.floor(o.n) || 1));
        if (t.length * n > 5e6) throw new Error('Слишком длинный результат: уменьшите число повторов.');
        return Array.from({ length: n }, (_, i) => (o.num ? `${i + 1}. ` : '') + t).join(o.sep);
      },
    });
  },
});

/* ===================== Красивые шрифты ===================== */

function mathAlpha(upper, lower, digits, exceptions = {}) {
  return t => [...t].map(c => {
    if (exceptions[c]) return exceptions[c];
    const k = c.charCodeAt(0);
    if (k >= 65 && k <= 90 && upper) return String.fromCodePoint(upper + k - 65);
    if (k >= 97 && k <= 122 && lower) return String.fromCodePoint(lower + k - 97);
    if (k >= 48 && k <= 57 && digits) return String.fromCodePoint(digits + k - 48);
    return c;
  }).join('');
}
const charMap = (from, to) => { const f = [...from], tt = [...to], m = {}; f.forEach((c, i) => (m[c] = tt[i])); return t => [...t].map(c => m[c] ?? m[c.toLowerCase()] ?? c).join(''); };
const combining = mark => t => [...t].map(c => /\s/.test(c) ? c : c + mark).join('');
const UPSIDE = charMap(
  'abcdefghijklmnopqrstuvwxyzABCDEFGJLMPTUVWY123456789.,?!()[]{}<>_&\'"абвгдежзийклмнопрстуфхцчшщъыьэюя',
  'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz∀ꓭƆᗡƎℲ⅁ſ˥WԀ┴∩ΛM⅄ƖᄅƐㄣϛ9ㄥ86˙\'¿¡)(][}{><‾⅋,„ɐƍʚ⅃ɓǝжεиņʞvwноudɔɯʎфхǹҺmmqıqqєoıʁ');

const FANCY = [
  ['Жирный', mathAlpha(0x1d400, 0x1d41a, 0x1d7ce)],
  ['Курсив', mathAlpha(0x1d434, 0x1d44e, 0, { h: 'ℎ' })],
  ['Жирный курсив', mathAlpha(0x1d468, 0x1d482)],
  ['Рукописный', mathAlpha(0x1d4d0, 0x1d4ea)],
  ['Готический', mathAlpha(0x1d56c, 0x1d586)],
  ['Двойной контур', mathAlpha(0x1d538, 0x1d552, 0x1d7d8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' })],
  ['Без засечек, жирный', mathAlpha(0x1d5d4, 0x1d5ee, 0x1d7ec)],
  ['Моноширинный', mathAlpha(0x1d670, 0x1d68a, 0x1d7f6)],
  ['Широкий', t => [...t].map(c => c === ' ' ? '　' : c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127 ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c).join('')],
  ['В кружочках', mathAlpha(0x24b6, 0x24d0, 0, { 0: '⓪', 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨' })],
  ['В квадратах', t => mathAlpha(0x1f130, 0x1f130)(t.toUpperCase())],
  ['Капитель', charMap('abcdefghijklmnopqrstuvwxyz', 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ')],
  ['Зачёркнутый', combining('̶')],
  ['Подчёркнутый', combining('̲')],
  ['Двойное подчёркивание', combining('̳')],
  ['Перечёркнутый косой чертой', combining('̸')],
  ['Вверх ногами', t => [...UPSIDE(t)].reverse().join('')],
  ['Зеркальный', t => [...charMap('bdpq()[]{}<>', 'dbqp)(][}{><')(t)].reverse().join('')],
  ['Zalgo (проклятый текст)', t => [...t].map(c => /\s/.test(c) ? c : c + Array.from({ length: 2 + Math.floor(Math.random() * 5) }, () => String.fromCharCode(0x300 + Math.floor(Math.random() * 0x70))).join('')).join('')],
];

tool({
  id: 'fancy-text', cat: 'text', badge: '𝐀𝓪', title: 'Красивые шрифты',
  desc: 'Жирный, курсив, зачёркнутый, перевёрнутый и ещё 15 стилей для Instagram, Telegram и ников.',
  render(root) {
    const ta = el('textarea', { id: 'fancy-in', class: 'text-in', rows: 3, value: 'Hello World 2026' });
    const list = el('div', { class: 'fancy-list' });
    const update = () => list.replaceChildren(...FANCY.map(([name, fn]) => {
      const v = fn(ta.value);
      return el('div', { class: 'fancy-row' }, el('span', { class: 'muted fancy-name' }, name), el('span', { class: 'fancy-val' }, v),
        el('button', { class: 'btn small', type: 'button', onclick: async e => { await copyText(v); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1200); } }, 'Копировать'));
    }));
    ta.addEventListener('input', update);
    root.append(el('div', { class: 'text-tool single' },
      el('label', { for: 'fancy-in', class: 'block-label' }, 'Ваш текст'), ta,
      el('p', { class: 'hint' }, 'Первые 11 стилей — это специальные символы Unicode, они есть только для латиницы и цифр. Зачёркивание, подчёркивание, Zalgo и «вверх ногами» работают и с русским текстом.'),
      list));
    update();
  },
});

/* ===================== Невидимый символ ===================== */

tool({
  id: 'invisible-char', cat: 'text', badge: '␣', title: 'Невидимый символ',
  desc: 'Скопируйте пустой символ для ника, пустого сообщения или отступа.',
  render(root) {
    const CH = [
      ['ㅤ', 'U+3164', 'Хангыль-заполнитель — лучший вариант для ников в играх, Telegram, Instagram'],
      ['⠀', 'U+2800', 'Пустой символ Брайля — работает почти везде, в том числе в пустых сообщениях'],
      ['​', 'U+200B', 'Пробел нулевой ширины — разрывает слово, но не виден'],
      [' ', 'U+00A0', 'Неразрывный пробел'],
      [' ', 'U+2003', 'Широкий пробел (em space)'],
      ['‎', 'U+200E', 'Невидимая метка направления текста'],
    ];
    const count = el('input', { type: 'number', id: 'inv-n', min: 1, max: 1000, value: 5 });
    root.append(el('div', { class: 'text-tool single' },
      el('div', { class: 'inv-list' }, CH.map(([c, code, desc]) => el('div', { class: 'fancy-row' },
        el('span', { class: 'chip mono' }, code), el('span', {}, desc),
        el('button', { class: 'btn small', type: 'button', onclick: async e => { await copyText(c); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1200); } }, 'Копировать')))),
      el('div', { class: 'row' }, el('label', { for: 'inv-n' }, 'Скопировать подряд'), count, el('span', {}, 'символов U+2800'),
        el('button', { class: 'btn primary', type: 'button', onclick: async e => { await copyText('⠀'.repeat(Math.min(1000, Math.max(1, Number(count.value) || 1)))); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1200); } }, 'Копировать'))));
  },
});
