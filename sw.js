const CACHE_NAME = 'mzj-sales-pwa-v40-dashboard-open-once';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.css?v=29',
  '/assets/app.js?v=30',
  '/assets/mzj-mobile-push-v1.js?v=6',
  '/assets/mzj-push-click-open-v12.js?v=12',
  '/assets/mzj-notifications-lazy-v1.js?v=1',
  '/assets/mzj-chat-scroll-v25.js?v=26',
  '/assets/mzj-pwa-install-v27.js?v=29',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

const PUSH_SW_VERSION = 'mzj-push-sw-v12';
const CLICK_MESSAGE_TYPE = 'MZJ_PUSH_NOTIFICATION_CLICK';

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

self.addEventListener('push', event => {
  const payload = parsePushPayload(event);
  const { title, options } = buildNotification(payload);

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

function buildNotificationClickUrl(rawTarget, data) {
  let url;
  try {
    url = new URL(clean(rawTarget) || '/#/dashboard', self.location.origin);
  } catch {
    url = new URL('/#/dashboard', self.location.origin);
  }

  const values = {
    mzjPush: '1',
    type: clean(data.type || data.eventType),
    leadId: clean(data.leadId || data.customerId || data.docId || data.id),
    conversationId: clean(data.conversationId || data.convId || data.chatId || data.waConversationId),
    phone: clean(data.phone || data.phoneNormalized || data.mobile || data.phoneNumber || data.customerPhone),
    customerName: clean(data.customerName || data.displayName || data.fullName || data.name || data.leadName),
    department: clean(data.department || data.departmentKey || data.section || data.serviceKey),
    sourceName: clean(data.sourceName || data.source || data.channel || data.platform),
    messageId: clean(data.messageId),
    eventId: clean(data.eventId || data.notificationId)
  };

  for (const [key, value] of Object.entries(values)) {
    if (value && !url.searchParams.get(key)) url.searchParams.set(key, value);
  }

  if (!url.hash) url.hash = '#/dashboard';
  return url.href;
}

function notificationClickMessage(data, targetUrl) {
  return {
    type: CLICK_MESSAGE_TYPE,
    data: { ...data, url: targetUrl }
  };
}

function isSameOriginClient(client) {
  try {
    return new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

async function postClickMessage(client, data, targetUrl) {
  if (!client) return;
  try {
    client.postMessage(notificationClickMessage(data, targetUrl));
  } catch {}
}

async function focusThenNavigate(client, data, targetUrl) {
  if (!client) return null;

  /*
    focus() is deliberately called before navigate(). On Android, awaiting a
    navigation first can consume the notification-click user activation and
    leave the standalone PWA hidden. Focusing immediately brings the app to
    the foreground, then the URL and the selected conversation are applied.
  */
  let activeClient = client;
  try {
    activeClient = (await client.focus()) || client;
  } catch {}

  await postClickMessage(activeClient, data, targetUrl);

  if ('navigate' in activeClient && activeClient.url !== targetUrl) {
    try {
      const navigatedClient = await activeClient.navigate(targetUrl);
      if (navigatedClient) {
        activeClient = navigatedClient;
        await postClickMessage(activeClient, data, targetUrl);
      }
    } catch {}
  }

  return activeClient;
}

async function openOrFocusNotificationTarget(data, targetUrl) {
  const allClients = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  const appClients = allClients.filter(isSameOriginClient);
  const visibleClient = appClients.find(client => client.visibilityState === 'visible');
  const focusedClient = appClients.find(client => client.focused === true);

  if (visibleClient || focusedClient) {
    return focusThenNavigate(visibleClient || focusedClient, data, targetUrl);
  }

  /*
    When the installed app is closed/backgrounded, launch the URL first instead
    of navigating a hidden stale client. This makes Android open the standalone
    PWA immediately. The URL carries all lead/conversation identifiers, so the
    page can open the correct conversation after authentication and data load.
  */
  if (clients.openWindow) {
    try {
      const openedClient = await clients.openWindow(targetUrl);
      if (openedClient) {
        await postClickMessage(openedClient, data, targetUrl);
        return openedClient;
      }
    } catch {}
  }

  if (appClients.length) {
    return focusThenNavigate(appClients[0], data, targetUrl);
  }

  return null;
}

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

  const targetUrl = buildNotificationClickUrl(rawTarget, fcmData);

  event.waitUntil(
    openOrFocusNotificationTarget(fcmData, targetUrl)
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
