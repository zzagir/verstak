'use strict';

/* Перевод интерфейса. Словарь EN_DICT (js/i18n-en.js): ключ — русская строка из кода, значение — перевод.
   Ключи с ${…} — шаблоны: в переводе {1}, {2} — подставленные значения по порядку. */

const I18N = { map: null, pats: null };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function i18nCompile() {
  if (I18N.map) return;
  I18N.map = new Map();
  I18N.pats = [];
  const dict = typeof EN_DICT !== 'undefined' ? EN_DICT : {};
  for (const [k, v] of Object.entries(dict)) {
    if (!k.includes('${')) { I18N.map.set(k, v); continue; }
    const parts = k.split(/\$\{[^}]*\}/);
    if (!/[а-яё]/i.test(parts.join(''))) continue;
    I18N.pats.push([new RegExp('^' + parts.map(escRe).join('([\\s\\S]+?)') + '$'), v, parts.join('').length]);
  }
  I18N.pats.sort((a, b) => b[2] - a[2]);
}

/** Перевод строки на английский; непереведённое возвращается как есть. */
function T(s) {
  if (s == null) return s;
  const str = String(s);
  if (!/[а-яё]/i.test(str)) return str;
  i18nCompile();
  const m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  let r = I18N.map.get(core);
  if (r == null) {
    for (const [re, v] of I18N.pats) {
      const mm = core.match(re);
      if (mm) { r = v.replace(/\{(\d)\}/g, (_, i) => T(mm[Number(i)])); break; }
    }
  }
  if (r == null) {
    // Короткие строки с числами («1,9 КБ», «3 файла»): переводим отдельные слова
    const words = core.match(/[а-яё]+/gi) || [];
    if (words.length <= 3) {
      const out = core.replace(/[а-яё]+/gi, w => I18N.map.get(w) ?? w);
      if (out !== core) r = out;
    }
  }
  return r == null ? str : m[1] + r + m[3];
}

const NO_TRANSLATE = 'textarea, [contenteditable], .notranslate, script, style, code';

function translateTree(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (p && !p.closest(NO_TRANSLATE) && /[а-яё]/i.test(node.nodeValue)) {
      const t = T(node.nodeValue);
      if (t !== node.nodeValue) node.nodeValue = t;
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const field = node.tagName === 'TEXTAREA';
  if (!field && node.closest(NO_TRANSLATE)) return;
  for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
    const v = node.getAttribute(a);
    if (v && /[а-яё]/i.test(v)) node.setAttribute(a, T(v));
  }
  if (field) return;
  for (const child of node.childNodes) translateTree(child);
}

function startDomTranslation() {
  translateTree(document.body);
  document.title = T(document.title);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree);
      else translateTree(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
}
