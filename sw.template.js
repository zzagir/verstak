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
  if (req.method !== 'GET' || (url.origin !== location.origin && !url.host.endsWith('fonts.gstatic.com') && !url.host.endsWith('fonts.googleapis.com'))) return;
  // Страницы: сначала сеть, чтобы сразу видеть обновления; без сети — из кеша.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./'))));
    return;
  }
  // Скрипты, стили, шрифты, модели: из кеша, в фоне обновляем.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; });
    return hit || net;
  }));
});
