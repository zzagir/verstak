'use strict';

const LANG = document.documentElement.lang === 'en' ? 'en' : 'ru';
const PAGE = document.body.dataset.page || '';

/* ---------- Тема оформления: системная → светлая → тёмная ---------- */

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

function applyTheme(mode) {
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const btn = $('.theme-toggle');
  if (btn) {
    const label = LANG === 'en' ? T(THEME_LABEL[mode]) : THEME_LABEL[mode];
    btn.dataset.mode = mode; btn.title = label; btn.setAttribute('aria-label', label);
  }
}
function initTheme() {
  let mode = 'system';
  try { mode = localStorage.getItem('theme') || 'system'; } catch { /* приватный режим */ }
  applyTheme(THEMES.includes(mode) ? mode : 'system');
  document.addEventListener('click', e => {
    const btn = e.target.closest('.theme-toggle');
    if (!btn) return;
    const next = THEMES[(THEMES.indexOf(btn.dataset.mode || 'system') + 1) % THEMES.length];
    applyTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* не сохраняем */ }
  });
}

/* ---------- Аналитика и реклама из js/config.js ---------- */

function injectHtml(target, html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  for (const node of [...box.childNodes]) {
    if (node.nodeName === 'SCRIPT') {
      const s = document.createElement('script');
      for (const a of node.attributes) s.setAttribute(a.name, a.value);
      s.textContent = node.textContent;
      target.append(s);
    } else target.append(node);
  }
}

function initAnalytics() {
  const { yandexMetrikaId: ym, googleAnalyticsId: ga } = SITE_CONFIG;
  if (ym) injectHtml(document.head, `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${Number(ym)},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});</script>`);
  if (ga) injectHtml(document.head, `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga)});</script>`);
}

function fillAds() {
  document.querySelectorAll('.ad-slot').forEach(slot => {
    const code = SITE_CONFIG.ads[slot.dataset.slot];
    if (code && !slot.dataset.filled) { slot.dataset.filled = '1'; injectHtml(slot, code); slot.classList.add('on'); }
  });
}

/* ---------- Поиск по инструментам ---------- */

function bindSearch(main) {
  const search = $('#tool-search', main);
  if (!search) return;
  const empty = $('.empty', main);
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    main.querySelectorAll('.tool-card').forEach(card => { card.hidden = !!q && !card.dataset.search.includes(q); any = any || !card.hidden; });
    main.querySelectorAll('.cat-section').forEach(s => (s.hidden = ![...s.querySelectorAll('.tool-card')].some(cd => !cd.hidden)));
    if (empty) empty.hidden = any;
  });
}

function mountTool(t) {
  const root = $('#tool-root');
  if (!root || !t) return;
  root.replaceChildren();
  try { t.render(root); } catch (e) {
    console.error(e);
    root.append(el('p', { class: 'status-msg error' }, 'Инструмент не запустился. Обновите страницу.'));
  }
}

function markNav(cat) {
  document.querySelectorAll('.site-nav a').forEach(a => a.classList.toggle('active', a.dataset.cat === cat));
}

/* ---------- Режим без сервера: всё на одной странице, адреса через # ---------- */

function routeHash() {
  const c = viewCtx(LANG, ROOT, false);
  const id = decodeURIComponent(location.hash.slice(1));
  const t = TOOLS.find(x => x.id === id);
  const main = $('#main');
  window.scrollTo(0, 0);
  if (t) main.innerHTML = V.toolMain(c, t);
  else if (CATS[id]) main.innerHTML = V.catMain(c, id);
  else if (id === 'about') main.innerHTML = V.aboutMain(c);
  else if (id === 'privacy') main.innerHTML = V.privacyMain(c);
  else main.innerHTML = V.homeMain(c);
  mountTool(t);
  bindSearch(main);
  fillAds();
  markNav(t ? t.cat : CATS[id] ? id : '');
  const name = V.siteName(c);
  document.title = t ? `${c.t(t.title)} — ${name}` : CATS[id] ? `${c.t(CATS[id].title)} — ${name}` : `${name} — ${c.t('инструменты для PDF, изображений и текста')}`;
}

/* ---------- Запуск ---------- */

initTheme();
if (LANG === 'en') startDomTranslation();
initAnalytics();

if (USE_PAGES) {
  mountTool(TOOLS.find(t => t.id === document.body.dataset.tool));
  bindSearch($('#main'));
  fillAds();
  markNav(document.body.dataset.cat || '');
} else {
  const c = viewCtx(LANG, ROOT, false);
  $('#site-header').innerHTML = V.header(c);
  $('#site-footer').innerHTML = V.footer(c);
  applyTheme(document.documentElement.dataset.theme || 'system');
  window.addEventListener('hashchange', routeHash);
  routeHash();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register(ROOT + 'sw.js').catch(() => { /* офлайн-режим недоступен */ });
}
