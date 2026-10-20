#!/usr/bin/env node
'use strict';
/* Сборка статических страниц: node build.js
   Создаёт отдельную страницу для каждого инструмента и раздела (RU и EN), sitemap.xml, robots.txt и sw.js. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const SCRIPTS = ['config.js', 'core.js', 'i18n.js', 'i18n-en.js', 'pdf-tools.js', 'pdf-extra.js', 'pdf-editor.js', 'image-tools.js', 'text-tools.js', 'dev-tools.js', 'viewers.js', 'views.js', 'app.js'];

const ctx = vm.createContext({ console, URL, Intl, TextEncoder, TextDecoder });
for (const f of SCRIPTS.filter(f => f !== 'app.js')) vm.runInContext(fs.readFileSync(path.join(DIR, 'js', f), 'utf8'), ctx, { filename: f });
const { TOOLS, CATS, V, SITE_CONFIG, viewCtx, seoData, T } = vm.runInContext('({ TOOLS, CATS, V, SITE_CONFIG, viewCtx, seoData, T })', ctx);

const SITE = SITE_CONFIG.siteUrl.replace(/\/$/, '');
const esc = V.esc;
const written = [];

function pagePath(lang, slug) { return (lang === 'en' ? '/en/' : '/') + (slug ? `${slug}/` : ''); }

function write(lang, slug, { title, desc, main, bodyData = {}, jsonld = [] }) {
  const depth = (lang === 'en' ? 1 : 0) + (slug ? 1 : 0);
  const root = '../'.repeat(depth);
  const c = viewCtx(lang, root, true);
  const other = lang === 'en' ? 'ru' : 'en';
  const altHref = root + (other === 'en' ? 'en/' : '') + (slug ? `${slug}/` : '');
  const url = SITE + pagePath(lang, slug);
  const scripts = SCRIPTS.filter(f => f !== 'i18n-en.js' || lang === 'en');
  const attrs = Object.entries({ root, page: bodyData.page || 'home', ...bodyData }).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="author" content="${esc(SITE_CONFIG.author)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="ru" href="${SITE + pagePath('ru', slug)}">
<link rel="alternate" hreflang="en" href="${SITE + pagePath('en', slug)}">
<link rel="alternate" hreflang="x-default" href="${SITE + pagePath('ru', slug)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/icons/og.png">
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'ru_RU'}">
<meta name="theme-color" content="#1d2a4a">
<link rel="manifest" href="${root}manifest.webmanifest">
<link rel="icon" href="${root}icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}icons/icon-192.png">
<script>try{var m=localStorage.getItem('theme');if(m==='light'||m==='dark')document.documentElement.dataset.theme=m}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Unbounded:wght@500;700&family=JetBrains+Mono:wght@400;600&family=Oswald:wght@700&family=Caveat:wght@400&family=Marck+Script&display=swap">
<link rel="stylesheet" href="${root}css/style.css">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body${attrs}>
<header class="site-header" id="site-header">${V.header(c, altHref)}</header>
<main id="main" class="wrap">${main(c)}</main>
<footer class="site-footer" id="site-footer">${V.footer(c)}</footer>
${scripts.map(f => `<script src="${root}js/${f}"></script>`).join('\n')}
</body>
</html>
`;
  const out = path.join(DIR, lang === 'en' ? 'en' : '', slug || '', 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  written.push(pagePath(lang, slug));
}

for (const lang of ['ru', 'en']) {
  const t = lang === 'en' ? T : s => s;
  const name = lang === 'en' ? SITE_CONFIG.nameEn : SITE_CONFIG.name;
  const home = SITE + pagePath(lang, '');

  write(lang, '', {
    title: lang === 'en' ? `${name} — free online PDF, image and text tools` : `${name} — бесплатные онлайн-инструменты для PDF, изображений и текста`,
    desc: lang === 'en'
      ? `${TOOLS.length} free tools: merge, split and compress PDF, convert PDF to Word and JPG, compress and crop images, remove backgrounds, QR codes. Files never leave your device.`
      : `${TOOLS.length} бесплатных инструментов: объединить, разделить и сжать PDF, PDF в Word и JPG, сжать и обрезать фото, удалить фон, транслит для ЧПУ, QR-коды. Файлы не загружаются на сервер.`,
    main: c => V.homeMain(c),
    bodyData: { page: 'home' },
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name, url: home, inLanguage: lang, author: { '@type': 'Person', name: SITE_CONFIG.author, email: SITE_CONFIG.contactEmail, url: SITE_CONFIG.github } }],
  });

  for (const cat of Object.keys(CATS)) {
    write(lang, cat, {
      title: lang === 'en' ? `${t(CATS[cat].title)} tools online — ${name}` : `${CATS[cat].title}: онлайн-инструменты — ${name}`,
      desc: t(CATS[cat].lead),
      main: c => V.catMain(c, cat),
      bodyData: { page: 'cat', cat },
    });
  }

  for (const tl of TOOLS) {
    const c = viewCtx(lang, '', true);
    const s = seoData(c, tl);
    const url = SITE + pagePath(lang, tl.id);
    write(lang, tl.id, {
      title: lang === 'en' ? `${s.title} online — free | ${name}` : `${s.title} онлайн бесплатно — ${name}`,
      desc: `${s.desc} ${lang === 'en' ? 'Free, no sign-up, files stay on your device.' : 'Бесплатно, без регистрации, файлы не покидают ваше устройство.'}`,
      main: cc => V.toolMain(cc, tl),
      bodyData: { page: 'tool', tool: tl.id, cat: tl.cat },
      jsonld: [
        { '@context': 'https://schema.org', '@type': 'WebApplication', name: s.title, description: s.desc, url, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', author: { '@type': 'Person', name: SITE_CONFIG.author, email: SITE_CONFIG.contactEmail, url: SITE_CONFIG.github }, browserRequirements: 'Requires JavaScript', inLanguage: lang, offers: { '@type': 'Offer', price: '0', priceCurrency: lang === 'en' ? 'USD' : 'RUB' } },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: s.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [[name, home], [t(CATS[tl.cat].title), SITE + pagePath(lang, tl.cat)], [s.title, url]].map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: u })) },
      ],
    });
  }

  write(lang, 'about', { title: lang === 'en' ? `About — ${name}` : `О сервисе — ${name}`, desc: lang === 'en' ? `${name}: free private online tools for PDF, images and text.` : `${name}: бесплатные приватные онлайн-инструменты для PDF, изображений и текста.`, main: c => V.aboutMain(c), bodyData: { page: 'about' } });
  write(lang, 'privacy', { title: lang === 'en' ? `Privacy policy — ${name}` : `Политика конфиденциальности — ${name}`, desc: lang === 'en' ? 'Your files never leave your device.' : 'Ваши файлы не покидают ваше устройство.', main: c => V.privacyMain(c), bodyData: { page: 'privacy' } });
}

/* sitemap.xml и robots.txt */
const ruPaths = written.filter(p => !p.startsWith('/en/'));
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${ruPaths.flatMap(p => ['ru', 'en'].map(lang => {
  const loc = SITE + (lang === 'en' ? '/en' + p : p);
  return `<url><loc>${loc}</loc><lastmod>${today}</lastmod><xhtml:link rel="alternate" hreflang="ru" href="${SITE + p}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}/en${p}"/></url>`;
})).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* Service worker: версия меняется при каждой сборке, чтобы посетители получили новые файлы */
const PRECACHE = ['./', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', ...SCRIPTS.map(f => `js/${f}`),
  'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jszip.min.js'];
const sw = fs.readFileSync(path.join(DIR, 'sw.template.js'), 'utf8')
  .replace('__VERSION__', Date.now().toString(36))
  .replace('__PRECACHE__', JSON.stringify(PRECACHE));
fs.writeFileSync(path.join(DIR, 'sw.js'), sw);

console.log(`Готово: ${written.length} страниц, ${TOOLS.length} инструментов, sitemap.xml, robots.txt, sw.js`);
