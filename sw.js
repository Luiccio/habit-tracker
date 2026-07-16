'use strict';

// При изменении файлов приложения увеличьте версию — кэш обновится
const CACHE_NAME = 'habit-tracker-v22';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    // cache: 'reload' — качаем с сервера, минуя HTTP-кэш браузера
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Push с сервера напоминаний: показываем уведомление даже при закрытом приложении
self.addEventListener('push', event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Напоминание', {
      body: msg.body || '',
      icon: 'icon.svg',
      badge: 'icon.svg',
      tag: msg.tag || 'habit-push',
    })
  );
});

// Клик по уведомлению: фокусируем открытое приложение или открываем новое окно
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow('./');
    })
  );
});

// Сначала сеть (всегда свежая версия), кэш — только когда офлайн
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok && event.request.url.startsWith(self.location.origin)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
