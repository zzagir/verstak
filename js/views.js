'use strict';

/* Разметка страниц строками: одна и та же для сборки статических страниц (build.js) и для работы с диска (#id). */

const V = {};
V.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** lang — 'ru' | 'en'; root — путь до корня сайта; pages — отдельные страницы (true) или #id (false). */
function viewCtx(lang, root, pages) {
  return { lang, root, pages, t: lang === 'en' ? T : s => s };
}

V.base = c => (c.root || './') + (c.lang === 'en' ? 'en/' : '');
V.home = c => c.pages ? V.base(c) : `${c.root}index.html#`;
V.toolUrl = (c, id) => c.pages ? `${V.base(c)}${id}/` : `${c.root}index.html#${id}`;
V.catUrl = (c, cat) => c.pages ? `${V.base(c)}${cat}/` : `${c.root}index.html#${cat}`;
V.pageUrl = (c, p) => c.pages ? `${V.base(c)}${p}/` : `${c.root}index.html#${p}`;
V.contacts = (c, subject) => {
  const S = SITE_CONFIG, links = [];
  if (S.contactEmail) links.push(`<a href="mailto:${S.contactEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}" class="notranslate">${V.esc(S.contactEmail)}</a>`);
  if (S.telegram) links.push(`<a href="${V.esc(S.telegram)}" rel="noopener" target="_blank">Telegram</a>`);
  if (S.github) links.push(`<a href="${V.esc(S.github)}" rel="noopener" target="_blank">GitHub</a>`);
  return links.join('<span aria-hidden="true">·</span>');
};

V.feedback = (c, t) => {
  const S = SITE_CONFIG, title = c.t(t.title);
  const subject = `${V.siteName(c)}: ${title}`;
  return `<aside class="feedback"><div><strong>${V.esc(c.t('Нашли ошибку или есть идея?'))}</strong><p>${V.esc(c.t('Напишите автору — инструменты дорабатываются по вашим отзывам.'))}</p></div>` +
    `<div class="row">${S.contactEmail ? `<a class="btn" href="mailto:${S.contactEmail}?subject=${encodeURIComponent(subject)}">${V.esc(c.t('Написать на почту'))}</a>` : ''}` +
    `${S.repoUrl ? `<a class="btn ghost" href="${V.esc(S.repoUrl)}/issues/new?title=${encodeURIComponent(subject)}" target="_blank" rel="noopener">${V.esc(c.t('Сообщить на GitHub'))}</a>` : ''}` +
    `${S.telegram ? `<a class="btn ghost" href="${V.esc(S.telegram)}" target="_blank" rel="noopener">Telegram</a>` : ''}</div></aside>`;
};

V.siteName = c => c.lang === 'en' ? SITE_CONFIG.nameEn : SITE_CONFIG.name;

V.card = (c, t) => `<a class="tool-card cat-${t.cat}" href="${V.toolUrl(c, t.id)}" data-search="${V.esc(`${c.t(t.title)} ${c.t(t.desc)} ${t.title} ${t.id}`.toLowerCase())}">` +
  `<span class="tool-badge${[...c.t(t.badge)].length > 3 ? ' long' : ''}" aria-hidden="true">${V.esc(c.t(t.badge))}</span>` +
  `<span class="tool-text"><strong>${V.esc(c.t(t.title))}</strong><span>${V.esc(c.t(t.desc))}</span></span></a>`;

V.catTools = cat => TOOLS.filter(t => t.cat === cat);

V.catSection = (c, cat, heading = 'h2') => `<section class="cat-section" id="cat-${cat}"><div class="cat-head">` +
  `<${heading}><a href="${V.catUrl(c, cat)}">${V.esc(c.t(CATS[cat].title))}</a><span class="count">${V.catTools(cat).length}</span></${heading}>` +
  `<p>${V.esc(c.t(CATS[cat].lead))}</p></div><div class="tool-grid">${V.catTools(cat).map(t => V.card(c, t)).join('')}</div></section>`;

V.search = c => `<input type="search" id="tool-search" placeholder="${V.esc(c.t('Найти инструмент: сжать, pdf, транслит…'))}" aria-label="${V.esc(c.t('Поиск инструмента'))}">` +
  `<p class="empty" hidden>${V.esc(c.t('Ничего не нашлось. Попробуйте другое слово, например «jpg» или «объединить».'))}</p>`;

V.homeMain = c => {
  const n = TOOLS.length;
  const lead = c.lang === 'en'
    ? `${n} free tools that run right in your browser. Files never leave your device, so it is fast and safe even for contracts and passport scans.`
    : `${n} ${plural(n, ['бесплатный инструмент', 'бесплатных инструмента', 'бесплатных инструментов'])}, которые работают прямо в браузере. Файлы не покидают ваш компьютер, поэтому это быстро и безопасно даже для договоров и сканов паспорта.`;
  const cats = Object.keys(CATS);
  return `<section class="hero"><h1>${V.esc(c.t('PDF, картинки и текст — '))}<em>${V.esc(c.t('без загрузки на сервер'))}</em></h1>` +
    `<p class="lead">${V.esc(lead)}</p>${V.search(c)}</section>` +
    cats.map((cat, i) => V.catSection(c, cat) + (i === 0 ? '<div class="ad-slot" data-slot="home"></div>' : '')).join('');
};

V.crumbs = (c, items) => `<nav class="crumbs" aria-label="${V.esc(c.t('Навигация'))}">` +
  items.map(([href, label]) => href ? `<a href="${href}">${V.esc(label)}</a>` : `<span>${V.esc(label)}</span>`).join('<span aria-hidden="true">/</span>') + '</nav>';

V.catMain = (c, cat) => V.crumbs(c, [[V.home(c), c.t('Все инструменты')], [null, c.t(CATS[cat].title)]]) +
  `<section class="hero compact"><h1>${V.esc(c.lang === 'en' ? `${T(CATS[cat].title)} tools online` : `Инструменты: ${CATS[cat].title}`)}</h1><p class="lead">${V.esc(c.t(CATS[cat].lead))}</p>${V.search(c)}</section>` +
  `<div class="tool-grid">${V.catTools(cat).map(t => V.card(c, t)).join('')}</div>` +
  Object.keys(CATS).filter(k => k !== cat).map(k => V.catSection(c, k)).join('');

/* ---------- SEO-описание инструмента ---------- */

const SPECIAL_UI = new Set(['organize-pdf', 'edit-pdf', 'sign-pdf', 'fill-pdf-form', 'compare-pdf', 'crop-image', 'meme-generator', 'photo-editor', 'blur-faces', 'color-picker', 'doc-photo', 'image-base64', 'qr-scanner']);

function seoData(c, t) {
  const en = c.lang === 'en', title = c.t(t.title), desc = c.t(t.desc);
  const fileTool = !!t.accept || SPECIAL_UI.has(t.id);
  const action = c.t(t.action || (en ? 'Process' : 'Обработать'));
  const steps = fileTool
    ? (en ? [`Choose a file or drag it into the window.`, t.options ? 'Adjust the settings if needed — sensible defaults are already selected.' : 'Make your changes right on the page.', t.accept ? `Click “${action}” and download the result.` : 'Save the result with the button on the page.']
      : ['Выберите файл или перетащите его в окно.', t.options ? 'При необходимости настройте параметры — удобные значения уже выбраны.' : 'Внесите нужные изменения прямо на странице.', t.accept ? `Нажмите «${action}» и скачайте результат.` : 'Сохраните результат кнопкой на странице.'])
    : (en ? ['Type or paste your text into the field.', 'Choose the options — the result updates instantly.', 'Copy the result or save it as a file.']
      : ['Введите или вставьте текст в поле.', 'Выберите параметры — результат обновляется сразу.', 'Скопируйте результат или сохраните его файлом.']);
  const faq = en ? [
    ['Is it free?', `Yes. “${title}” and every other ${SITE_CONFIG.nameEn} tool is free, with no sign-up, watermarks or limits on the number of files.`],
    fileTool && ['Are my files uploaded anywhere?', 'No. Everything is processed in your browser on your own device and nothing is sent to a server. That is why it is safe for confidential documents.'],
    fileTool && ['Is there a file size limit?', 'There is no fixed limit — it depends on your device memory. Files up to 100–200 MB usually work fine on a computer; on a phone, smaller files are better.'],
    ['Does it work on a phone?', 'Yes, in any modern browser on Android, iPhone, Windows, macOS and Linux. Nothing to install. You can also add the site to your home screen as an app.'],
  ] : [
    ['Это бесплатно?', `Да. «${title}» и остальные инструменты ${SITE_CONFIG.name}а бесплатны, без регистрации, водяных знаков и ограничений по количеству файлов.`],
    fileTool && ['Мои файлы куда-нибудь загружаются?', 'Нет. Всё обрабатывается в браузере на вашем устройстве, файлы не отправляются на сервер. Поэтому инструментом безопасно пользоваться даже для конфиденциальных документов.'],
    fileTool && ['Есть ли ограничение на размер файла?', 'Жёсткого лимита нет — всё зависит от памяти устройства. На компьютере файлы до 100–200 МБ обычно обрабатываются без проблем, на телефоне лучше работать с файлами поменьше.'],
    ['Работает ли на телефоне?', 'Да, в любом современном браузере на Android, iPhone, Windows, macOS и Linux. Ничего устанавливать не нужно, а сайт можно добавить на главный экран как приложение.'],
  ];
  const about = en
    ? `${desc} ${title} online works for free and without registration: open the page, add your data and get the result in a few seconds.`
    : `${desc} «${title}» онлайн работает бесплатно и без регистрации: откройте страницу, добавьте данные и получите результат за несколько секунд.`;
  return { title, desc, steps, faq: faq.filter(Boolean), about, note: t.note && c.t(t.note) };
}

V.seo = (c, t) => {
  const s = seoData(c, t);
  return `<section class="seo-block"><div class="seo-col"><h2>${V.esc(c.lang === 'en' ? `How to use “${s.title}”` : `Как пользоваться инструментом «${s.title}»`)}</h2>` +
    `<p>${V.esc(s.about)}</p><ol class="steps">${s.steps.map(x => `<li>${V.esc(x)}</li>`).join('')}</ol>${s.note ? `<p class="hint">${V.esc(s.note)}</p>` : ''}</div>` +
    `<div class="seo-col"><h2>${V.esc(c.t('Вопросы и ответы'))}</h2>${s.faq.map(([q, a]) => `<details class="faq"><summary>${V.esc(q)}</summary><p>${V.esc(a)}</p></details>`).join('')}</div></section>`;
};

V.toolMain = (c, t) => {
  const related = TOOLS.filter(x => x.cat === t.cat && x.id !== t.id);
  return V.crumbs(c, [[V.home(c), c.t('Все инструменты')], [V.catUrl(c, t.cat), c.t(CATS[t.cat].title)]]) +
    `<header class="tool-head cat-${t.cat}"><span class="tool-badge big" aria-hidden="true">${V.esc(c.t(t.badge))}</span>` +
    `<div><h1>${V.esc(c.t(t.title))}</h1><p>${V.esc(c.t(t.desc))}</p></div></header>` +
    '<div class="ad-slot" data-slot="top"></div>' +
    `<div id="tool-root" class="tool-root" data-tool="${t.id}"><noscript><p class="status-msg error">${V.esc(c.t('Для работы инструмента включите JavaScript.'))}</p></noscript></div>` +
    V.feedback(c, t) +
    '<div class="ad-slot" data-slot="bottom"></div>' +
    V.seo(c, t) +
    (related.length ? `<section class="related"><h2>${V.esc(c.lang === 'en' ? `More ${({ pdf: 'PDF', image: 'image', text: 'text', dev: 'utility' })[t.cat]} tools` : `Ещё инструменты: ${CATS[t.cat].title}`)}</h2><div class="tool-grid compact">${related.map(x => V.card(c, x)).join('')}</div></section>` : '');
};

/* ---------- Служебные страницы ---------- */

V.aboutMain = c => c.lang === 'en'
  ? `${V.crumbs(c, [[V.home(c), 'All tools'], [null, 'About']])}<article class="prose"><h1>About ${SITE_CONFIG.nameEn}</h1>
<p>${SITE_CONFIG.nameEn} is a set of ${TOOLS.length} free online tools for PDF files, images and text. Merge and compress PDFs, convert documents and e-books, crop photos, remove backgrounds, make transliterated URLs, generate QR codes and much more.</p>
<h2>Why it is safe</h2><p>All processing happens in your browser. Files are not uploaded to a server, are not stored and are not visible to anyone — including us. You can even use the site offline after the first visit.</p>
<h2>Contact</h2><p>Author: <span class="notranslate">${V.esc(SITE_CONFIG.author)}</span>. Ideas, bugs and partnership: ${V.contacts(c, SITE_CONFIG.nameEn)}</p>${SITE_CONFIG.repoUrl ? `<p>The source code is open: <a href="${V.esc(SITE_CONFIG.repoUrl)}" target="_blank" rel="noopener">${V.esc(SITE_CONFIG.repoUrl.replace('https://', ''))}</a></p>` : ''}</article>`
  : `${V.crumbs(c, [[V.home(c), 'Все инструменты'], [null, 'О сервисе']])}<article class="prose"><h1>О сервисе ${SITE_CONFIG.name}</h1>
<p>${SITE_CONFIG.name} — это ${TOOLS.length} бесплатных онлайн-инструментов для PDF, изображений и текста. Объединяйте и сжимайте PDF, конвертируйте документы и электронные книги, обрезайте фото, удаляйте фон, делайте транслит для ЧПУ, создавайте QR-коды и многое другое.</p>
<h2>Почему это безопасно</h2><p>Вся обработка происходит в вашем браузере. Файлы не загружаются на сервер, не хранятся и никому не видны — даже нам. После первого посещения сайтом можно пользоваться даже без интернета.</p>
<h2>Контакты</h2><p>Автор: <span class="notranslate">${V.esc(SITE_CONFIG.author)}</span>. Идеи, ошибки и сотрудничество: ${V.contacts(c, SITE_CONFIG.name)}</p>${SITE_CONFIG.repoUrl ? `<p>Исходный код открыт: <a href="${V.esc(SITE_CONFIG.repoUrl)}" target="_blank" rel="noopener">${V.esc(SITE_CONFIG.repoUrl.replace('https://', ''))}</a></p>` : ''}</article>`;

V.privacyMain = c => c.lang === 'en'
  ? `${V.crumbs(c, [[V.home(c), 'All tools'], [null, 'Privacy policy']])}<article class="prose"><h1>Privacy policy</h1>
<p>Files and text you process with ${SITE_CONFIG.nameEn} never leave your device: all tools run locally in your browser and do not send your data to our servers.</p>
<h2>What we may collect</h2><p>If web analytics (Yandex Metrica, Google Analytics) is enabled on the site, anonymous technical data is collected: pages visited, browser type, approximate region. It is used only to improve the service.</p>
<h2>Advertising</h2><p>Ad networks shown on the site may use cookies according to their own policies. You can disable cookies in your browser settings.</p>
<h2>Local storage</h2><p>The site stores your theme choice and caches its own files in the browser so it works faster and offline. You can clear this data in your browser settings at any time.</p></article>`
  : `${V.crumbs(c, [[V.home(c), 'Все инструменты'], [null, 'Политика конфиденциальности']])}<article class="prose"><h1>Политика конфиденциальности</h1>
<p>Файлы и тексты, которые вы обрабатываете в ${SITE_CONFIG.name}е, не покидают ваше устройство: все инструменты работают локально в браузере и не отправляют данные на наши серверы.</p>
<h2>Что может собираться</h2><p>Если на сайте подключена веб-аналитика (Яндекс.Метрика, Google Analytics), собираются обезличенные технические данные: посещённые страницы, тип браузера, примерный регион. Они нужны только для улучшения сервиса.</p>
<h2>Реклама</h2><p>Рекламные сети, блоки которых показываются на сайте, могут использовать cookie по своим правилам. Отключить cookie можно в настройках браузера.</p>
<h2>Локальное хранилище</h2><p>Сайт запоминает выбранную тему оформления и сохраняет свои файлы в кеше браузера, чтобы работать быстрее и без интернета. Эти данные можно удалить в настройках браузера в любой момент.</p></article>`;

/* ---------- Шапка и подвал ---------- */

V.header = (c, altHref) => `<div class="wrap header-row">
<a class="logo" href="${V.home(c)}"><span class="logo-mark" aria-hidden="true"></span>${V.esc(V.siteName(c))}</a>
<nav class="site-nav" aria-label="${V.esc(c.t('Разделы'))}">${Object.keys(CATS).map(cat => `<a href="${V.catUrl(c, cat)}" data-cat="${cat}">${V.esc(c.t(CATS[cat].short || CATS[cat].title))}</a>`).join('')}</nav>
<div class="header-tools">${altHref ? `<a class="lang-switch" href="${altHref}" hreflang="${c.lang === 'en' ? 'ru' : 'en'}">${c.lang === 'en' ? 'RU' : 'EN'}</a>` : ''}<button class="theme-toggle" type="button" aria-label="${V.esc(c.t('Тема оформления'))}" title="${V.esc(c.t('Тема оформления'))}"></button></div>
</div>`;

V.footer = c => `<div class="wrap footer-row"><div class="footer-info"><p>${V.esc(c.t('Все файлы обрабатываются на вашем устройстве и никуда не отправляются.'))}</p>
<p class="footer-author">${V.esc(c.t('Автор'))}: <span class="notranslate">${V.esc(SITE_CONFIG.author)}</span> <span aria-hidden="true">·</span> ${V.contacts(c, V.siteName(c))}</p></div>
<nav aria-label="${V.esc(c.t('Сервис'))}"><a href="${V.pageUrl(c, 'about')}">${V.esc(c.t('О сервисе'))}</a><a href="${V.pageUrl(c, 'privacy')}">${V.esc(c.t('Конфиденциальность'))}</a>${SITE_CONFIG.repoUrl ? `<a href="${V.esc(SITE_CONFIG.repoUrl)}" target="_blank" rel="noopener">${V.esc(c.t('Исходный код'))}</a>` : ''}</nav></div>`;
