self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification?.data || {};
  const fcmMessage = notificationData.FCM_MSG || {};
  const fcmData = fcmMessage.data || {};
  const rawTarget =
    notificationData.url ||
    fcmData.url ||
    fcmMessage?.fcmOptions?.link ||
    '/#/dashboard';

  let targetUrl = self.location.origin + '/#/dashboard';
  try {
    targetUrl = new URL(rawTarget, self.location.origin).href;
  } catch {}

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        try {
          if ('navigate' in client && client.url !== targetUrl) {
            await client.navigate(targetUrl);
          }
          client.postMessage({
            type: 'MZJ_PUSH_NOTIFICATION_CLICK',
            data: { ...fcmData, url: targetUrl }
          });
          return client.focus();
        } catch {}
      }
      return clients.openWindow ? clients.openWindow(targetUrl) : null;
    })
  );
});

importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCd2paKL200XRdz2SwFEUzAtfg51xWL5QA',
  authDomain: 'mzj-lead.firebaseapp.com',
  projectId: 'mzj-lead',
  storageBucket: 'mzj-lead.firebasestorage.app',
  messagingSenderId: '470098288857',
  appId: '1:470098288857:web:613125cfc1623b08abdec8',
  measurementId: 'G-981Z1T6Z91'
});

firebase.messaging();

const CACHE_NAME = 'mzj-sales-pwa-v28';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.css?v=26',
  '/assets/app.js?v=26',
  '/assets/mzj-notification-settings-v57.js?v=64',
  '/assets/mzj-chat-scroll-v25.js?v=26',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
