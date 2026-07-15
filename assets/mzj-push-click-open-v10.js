(() => {
  'use strict';

  const STORAGE_KEY = 'mzj_open_lead_request';
  const CLICK_MESSAGE_TYPE = 'MZJ_PUSH_NOTIFICATION_CLICK';
  const RETRY_DELAYS = [0, 180, 650, 1500, 3200, 6500, 11000];
  let lastFingerprint = '';

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function clean(value) {
    return String(value ?? '').trim();
  }

  function normalizePayload(value) {
    const root = asObject(value);
    const fcmMessage = asObject(root.FCM_MSG);
    const merged = {
      ...root,
      ...asObject(root.data),
      ...asObject(fcmMessage.data)
    };

    const leadId = clean(merged.leadId || merged.customerId || merged.docId || merged.id);
    const conversationId = clean(
      merged.conversationId || merged.convId || merged.chatId || merged.waConversationId
    );
    const phone = clean(
      merged.phone || merged.phoneNormalized || merged.mobile || merged.phoneNumber || merged.customerPhone
    );
    const customerName = clean(
      merged.customerName || merged.displayName || merged.fullName || merged.name || merged.leadName
    );

    if (!leadId && !conversationId && !phone && !customerName) return null;

    return {
      id: leadId || conversationId,
      docId: leadId,
      leadId,
      conversationId,
      convId: conversationId,
      phone,
      phoneNormalized: phone,
      customerPhone: phone,
      customerName,
      displayName: customerName,
      department: clean(merged.department || merged.departmentKey || merged.section || merged.serviceKey),
      sourceName: clean(merged.sourceName || merged.source || merged.channel || merged.platform),
      type: clean(merged.type || merged.eventType),
      messageId: clean(merged.messageId),
      eventId: clean(merged.eventId || merged.notificationId),
      url: clean(merged.url)
    };
  }

  function payloadFromCurrentUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('mzjPush') !== '1') return null;

      return normalizePayload({
        type: url.searchParams.get('type'),
        leadId: url.searchParams.get('leadId'),
        conversationId: url.searchParams.get('conversationId'),
        phone: url.searchParams.get('phone'),
        customerName: url.searchParams.get('customerName'),
        department: url.searchParams.get('department'),
        sourceName: url.searchParams.get('sourceName'),
        messageId: url.searchParams.get('messageId'),
        eventId: url.searchParams.get('eventId'),
        url: window.location.href
      });
    } catch {
      return null;
    }
  }

  function readPendingPayload() {
    try {
      return normalizePayload(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
      return null;
    }
  }

  function savePendingPayload(payload) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function cleanPushParamsFromUrl() {
    try {
      const url = new URL(window.location.href);
      const keys = [
        'mzjPush',
        'type',
        'leadId',
        'conversationId',
        'phone',
        'customerName',
        'department',
        'sourceName',
        'messageId',
        'eventId'
      ];
      keys.forEach(key => url.searchParams.delete(key));
      const cleanUrl = `${url.pathname}${url.search}${url.hash || '#/dashboard'}`;
      window.history.replaceState(window.history.state, '', cleanUrl);
    } catch {}
  }

  function ensureDashboardRoute() {
    const currentHash = clean(window.location.hash);
    if (currentHash === '#/dashboard' || currentHash.startsWith('#/dashboard?')) return;
    window.location.hash = '#/dashboard';
  }

  function dispatchOpenLead(payload) {
    try {
      window.dispatchEvent(new CustomEvent('mzj:open-lead', { detail: payload }));
    } catch {}
  }

  function scheduleOpen(payload) {
    const normalized = normalizePayload(payload);
    if (!normalized) return;

    const fingerprint = [
      normalized.eventId,
      normalized.leadId,
      normalized.conversationId,
      normalized.phone,
      normalized.customerName
    ].join('|');

    savePendingPayload(normalized);
    ensureDashboardRoute();

    if (fingerprint && fingerprint !== lastFingerprint) lastFingerprint = fingerprint;

    RETRY_DELAYS.forEach(delay => {
      window.setTimeout(() => {
        const pending = readPendingPayload();
        if (!pending) return;
        dispatchOpenLead(pending);
      }, delay);
    });
  }

  function handleServiceWorkerMessage(event) {
    const message = asObject(event?.data);
    if (message.type !== CLICK_MESSAGE_TYPE) return;
    scheduleOpen(message.data);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  }

  window.addEventListener('mzj:dashboard-data-ready', () => {
    const pending = readPendingPayload();
    if (pending) scheduleOpen(pending);
  });

  window.addEventListener('mzj:auth-state', event => {
    if (!event?.detail?.user) return;
    const pending = readPendingPayload();
    if (pending) scheduleOpen(pending);
  });

  const urlPayload = payloadFromCurrentUrl();
  if (urlPayload) {
    savePendingPayload(urlPayload);
    cleanPushParamsFromUrl();
    scheduleOpen(urlPayload);
  } else {
    const pending = readPendingPayload();
    if (pending) scheduleOpen(pending);
  }
})();
