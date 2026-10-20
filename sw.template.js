'use strict';
/* Офлайн-режим. Не редактируйте sw.js — он создаётся из этого файла командой node build.js. */
const VERSION = '__VERSION__';
const CACHE = `verstak-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('verstak-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  const fonts = url.host.endsWith('fonts.gstatic.com') || url.host.endsWith('fonts.googleapis.com');
  if (req.method !== 'GET' || (url.origin !== location.origin && !fonts)) return;
  const put = res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  // Библиотеки и шрифты не меняются между версиями: из кеша, иначе из сети.
  if (fonts || url.pathname.includes('/vendor/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(put)));
    return;
  }
  // Страницы, скрипты и стили сайта: всегда свежие из сети, кеш — только без интернета.
  // Иначе после обновления старый скрипт из кеша может встретиться с новым и сломать страницу.
  e.respondWith(fetch(req).then(put).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./') : undefined))));
});
