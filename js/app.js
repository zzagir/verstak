'use strict';

const LANG = document.documentElement.lang === 'en' ? 'en' : 'ru';
const PAGE = document.body.dataset.page || '';

/* ---------- Тема оформления: светлая ⇄ тёмная (по умолчанию — как в системе) ---------- */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  const btn = $('.theme-toggle');
  if (!btn) return;
  const now = effectiveTheme();
  const label = now === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  btn.dataset.mode = now;
  btn.title = LANG === 'en' ? T(label) : label;
  btn.setAttribute('aria-label', btn.title);
}
function initTheme() {
  let mode = null;
  try { mode = localStorage.getItem('theme'); } catch { /* приватный режим */ }
  applyTheme(mode);
  darkQuery.addEventListener?.('change', () => applyTheme(document.documentElement.dataset.theme));
  document.addEventListener('click', e => {
    if (!e.target.closest('.theme-toggle')) return;
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* не сохраняем */ }
  });
}

/* ---------- Избранное и недавние ---------- */

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* не сохраняем */ } },
};

function rememberTool(id) {
  store.set('recent', [id, ...store.get('recent').filter(x => x !== id)].slice(0, 8));
}

const isFav = id => store.get('favorites').includes(id);
function toggleFav(id) {
  const favs = store.get('favorites');
  store.set('favorites', favs.includes(id) ? favs.filter(x => x !== id) : [id, ...favs]);
  syncFavs();
}
/** Обновляет все звёздочки, счётчик в шапке и блок «Избранное» на главной. */
function syncStars() {
  const favs = store.get('favorites');
  document.querySelectorAll('.star').forEach(b => {
    const on = favs.includes(b.dataset.id);
    const glyph = on ? '★' : '☆';
    if (b.textContent !== glyph) b.textContent = glyph;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    const label = on ? 'Убрать из избранного' : 'Добавить в избранное';
    b.title = LANG === 'en' ? T(label) : label;
    b.setAttribute('aria-label', b.title);
  });
}
function syncFavs() {
  const favs = store.get('favorites');
  document.querySelectorAll('.fav-btn').forEach(b => { const on = favs.includes(b.dataset.id); b.classList.toggle('on', on); b.textContent = on ? '★ В избранном' : '☆ В избранное'; });
  const cnt = $('.fav-count');
  if (cnt) cnt.textContent = favs.length ? String(favs.length) : '';
  const main = $('#main');
  if (main && $('.hero', main) && !$('.tool-head', main)) { main.querySelectorAll('.personal').forEach(n => n.remove()); personalSections(main); }
  syncStars();
}

function favPopover() {
  const btn = $('.fav-toggle'), pop = $('.fav-pop');
  if (!btn || !pop) return;
  const c = viewCtx(LANG, ROOT, USE_PAGES);
  const render = () => {
    const ids = store.get('favorites').filter(id => TOOLS.some(t => t.id === id));
    pop.innerHTML = ids.length
      ? `<p class="fav-pop-title">${V.esc(c.t('Избранное'))}</p>` + ids.map(id => { const t = TOOLS.find(x => x.id === id); return `<a href="${V.toolUrl(c, id)}" class="cat-${t.cat}"><span class="tool-badge" aria-hidden="true">${V.esc(c.t(t.badge))}</span>${V.esc(c.t(t.title))}</a>`; }).join('')
      : `<p class="hint">${V.esc(c.t('Нажмите ☆ на карточке любого инструмента, чтобы он появился здесь.'))}</p>`;
  };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = pop.hidden;
    if (open) render();
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.fav-menu')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });
}

document.addEventListener('click', e => {
  const star = e.target.closest('.star');
  if (!star) return;
  e.preventDefault();
  toggleFav(star.dataset.id);
});

function favButton(id) {
  const btn = el('button', { class: 'fav-btn', type: 'button', 'data-id': id, onclick: () => toggleFav(id) });
  btn.textContent = isFav(id) ? '★ В избранном' : '☆ В избранное';
  btn.classList.toggle('on', isFav(id));
  return btn;
}

function personalSections(main) {
  const hero = $('.hero', main);
  if (!hero || $('.personal', main)) return;
  const c = viewCtx(LANG, ROOT, USE_PAGES);
  const block = (key, title) => {
    const ids = store.get(key).filter(id => TOOLS.some(t => t.id === id));
    if (!ids.length) return '';
    return `<section class="cat-section personal"><div class="cat-head"><h2>${V.esc(c.t(title))}</h2>` +
      (key === 'recent' ? `<button class="btn small ghost clear-recent" type="button">${V.esc(c.t('Очистить'))}</button>` : '') +
      `</div><div class="tool-grid compact">${ids.map(id => V.card(c, TOOLS.find(t => t.id === id))).join('')}</div></section>`;
  };
  hero.insertAdjacentHTML('afterend', block('favorites', 'Избранное') + block('recent', 'Недавние'));
  $('.clear-recent', main)?.addEventListener('click', e => { store.set('recent', []); e.target.closest('section').remove(); });
}

/* ---------- Вставка файлов из буфера и передача между инструментами ---------- */

function activeDropzone() {
  const root = $('#tool-root');
  if (!root) return null;
  const zones = [...root.querySelectorAll('.dz')];
  return zones.find(z => z.offsetParent !== null) || zones.find(z => z.dataset.multi) || null;
}

document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  const dz = activeDropzone();
  if (!dz) return;
  e.preventDefault();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  dz.take(files.map(f => f.name && f.name !== 'image.png' ? f : new File([f], `вставка-${stamp}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
});

async function applyHandoff() {
  const files = await takeHandoff();
  if (!files) return;
  const dz = activeDropzone();
  if (dz) dz.take(files);
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
    main.querySelectorAll('.card-wrap').forEach(w => { w.hidden = !!q && !w.querySelector('.tool-card').dataset.search.includes(q); any = any || !w.hidden; });
    main.querySelectorAll('.cat-section').forEach(s => (s.hidden = ![...s.querySelectorAll('.card-wrap')].some(cd => !cd.hidden)));
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
  rememberTool(t.id);
  $('.tool-head > div')?.append(favButton(t.id));
  applyHandoff();
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
  if (!t && !CATS[id]) personalSections(main);
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
  if (PAGE === 'home') personalSections($('#main'));
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

favPopover();
syncFavs();
// Звёздочки на карточках, которые появляются позже (смена страницы в режиме #, «Похожие»)
new MutationObserver(() => { clearTimeout(syncStars.t); syncStars.t = setTimeout(syncStars, 50); }).observe($('#main'), { childList: true, subtree: true });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register(ROOT + 'sw.js').catch(() => { /* офлайн-режим недоступен */ });
}
