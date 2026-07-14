const CACHE_NAME = 'mzj-sales-pwa-v35';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.css?v=26',
  '/assets/app.js?v=28',
  '/assets/mzj-mobile-push-v1.js?v=4',
  '/assets/mzj-notifications-lazy-v1.js?v=1',
  '/assets/mzj-chat-scroll-v25.js?v=26',
  '/assets/mzj-pwa-install-v27.js?v=28',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

const PUSH_SW_VERSION = 'mzj-push-sw-v8';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return String(value ?? '').trim();
}

function parsePushPayload(event) {
  if (!event.data) return {};

  try {
    return asObject(event.data.json());
  } catch {}

  try {
    const text = event.data.text();
    return asObject(JSON.parse(text));
  } catch {}

  return {};
}

function buildNotification(payload) {
  const root = asObject(payload);
  const wrapped = asObject(root.FCM_MSG);
  const message = Object.keys(wrapped).length ? wrapped : root;
  const data = {
    ...asObject(root.data),
    ...asObject(message.data)
  };
  const notification = {
    ...asObject(root.notification),
    ...asObject(message.notification)
  };
  const fcmOptions = {
    ...asObject(root.fcmOptions),
    ...asObject(message.fcmOptions)
  };

  const title = clean(data.title || notification.title || root.title || 'MZJ CRM');
  const body = clean(data.body || notification.body || root.body || 'إشعار جديد');
  const targetUrl = clean(
    data.url ||
    notification.click_action ||
    fcmOptions.link ||
    '/#/dashboard'
  );
  const eventId = clean(
    data.eventId ||
    data.notificationId ||
    message.messageId ||
    root.messageId ||
    `mzj_${Date.now()}`
  );

  const icon = clean(data.icon || notification.icon || '/assets/icons/icon-192.png');
  const badge = clean(data.badge || notification.badge || '/assets/icons/icon-96.png');
  const image = clean(data.image || notification.image || '');

  const options = {
    body,
    icon,
    badge,
    dir: 'rtl',
    lang: 'ar',
    tag: eventId,
    renotify: true,
    silent: false,
    vibrate: [250, 100, 250],
    timestamp: Date.now(),
    data: {
      ...data,
      eventId,
      url: targetUrl,
      swVersion: PUSH_SW_VERSION
    }
  };

  if (image) options.image = image;

  return { title, options };
}

/*
  استقبال Push مباشرة من المتصفح بدون الاعتماد على تحميل Firebase SDK
  داخل الـ Service Worker. هذا يضمن استدعاء showNotification داخل
  event.waitUntil ويمنع إشعار Chrome العام:
  "This site has been updated in the background".
*/
self.addEventListener('push', event => {
  const payload = parsePushPayload(event);
  const { title, options } = buildNotification(payload);

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const notificationData = asObject(event.notification?.data);
  const fcmMessage = asObject(notificationData.FCM_MSG);
  const fcmData = {
    ...notificationData,
    ...asObject(fcmMessage.data)
  };
  const rawTarget = clean(
    notificationData.url ||
    fcmData.url ||
    asObject(fcmMessage.fcmOptions).link ||
    '/#/dashboard'
  );

  let targetUrl = self.location.origin + '/#/dashboard';
  try {
    targetUrl = new URL(rawTarget, self.location.origin).href;
  } catch {}

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
