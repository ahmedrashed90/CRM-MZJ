(() => {
  'use strict';

  const STORAGE_KEY = 'mzj_open_lead_request_v11';
  const LEGACY_STORAGE_KEYS = ['mzj_open_lead_request'];
  const SESSION_KEY = 'mzj_open_lead_request';
  const CLICK_MESSAGE_TYPE = 'MZJ_PUSH_NOTIFICATION_CLICK';
  const CONSUMED_EVENT = 'mzj:open-lead-consumed';
  const RETRY_DELAYS = [0, 180, 650, 1500, 3200, 6500, 11000];
  const MAX_PENDING_AGE_MS = 15 * 60 * 1000;

  let scheduleGeneration = 0;

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

    const requestedAt = Number(merged.requestedAt || merged.openRequestedAt || 0);

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
      url: clean(merged.url),
      requestedAt: Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : 0
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
        url: window.location.href,
        requestedAt: Date.now()
      });
    } catch {
      return null;
    }
  }

  function clearPendingPayload() {
    scheduleGeneration += 1;

    try {
      localStorage.removeItem(STORAGE_KEY);
      LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    } catch {}

    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function readPendingPayload() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const payload = normalizePayload(raw);
      if (!payload) return null;

      /*
        Older versions stored the customer forever without a timestamp.
        Such stale requests are removed once v12 loads so refresh/open cannot
        reopen the same conversation again.
      */
      if (!payload.requestedAt) {
        clearPendingPayload();
        return null;
      }

      if (Date.now() - payload.requestedAt > MAX_PENDING_AGE_MS) {
        clearPendingPayload();
        return null;
      }

      return payload;
    } catch {
      clearPendingPayload();
      return null;
    }
  }

  function savePendingPayload(payload) {
    const normalized = normalizePayload(payload);
    if (!normalized) return null;

    const stored = {
      ...normalized,
      requestedAt: normalized.requestedAt || Date.now()
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {}

    return stored;
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

  function scheduleOpen(payload, options = {}) {
    const persist = options.persist !== false;
    const normalized = persist ? savePendingPayload(payload) : normalizePayload(payload);
    if (!normalized) return;

    ensureDashboardRoute();

    const generation = ++scheduleGeneration;
    const fingerprint = [
      normalized.eventId,
      normalized.leadId,
      normalized.conversationId,
      normalized.phone,
      normalized.customerName
    ].join('|');

    RETRY_DELAYS.forEach(delay => {
      window.setTimeout(() => {
        if (generation !== scheduleGeneration) return;

        const pending = readPendingPayload();
        if (!pending) return;

        const pendingFingerprint = [
          pending.eventId,
          pending.leadId,
          pending.conversationId,
          pending.phone,
          pending.customerName
        ].join('|');

        if (fingerprint && pendingFingerprint && fingerprint !== pendingFingerprint) return;
        dispatchOpenLead(pending);
      }, delay);
    });
  }

  function resumePendingOpen() {
    const pending = readPendingPayload();
    if (pending) scheduleOpen(pending, { persist: false });
  }

  function handleServiceWorkerMessage(event) {
    const message = asObject(event?.data);
    if (message.type !== CLICK_MESSAGE_TYPE) return;
    scheduleOpen({ ...asObject(message.data), requestedAt: Date.now() });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  }

  window.addEventListener(CONSUMED_EVENT, clearPendingPayload);
  window.addEventListener('mzj:dashboard-data-ready', resumePendingOpen);
  window.addEventListener('mzj:auth-state', event => {
    if (event?.detail?.user) resumePendingOpen();
  });
  window.addEventListener('pageshow', resumePendingOpen);
  window.addEventListener('focus', resumePendingOpen);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumePendingOpen();
  });

  const urlPayload = payloadFromCurrentUrl();
  if (urlPayload) {
    cleanPushParamsFromUrl();
    scheduleOpen(urlPayload);
  } else {
    resumePendingOpen();
  }
})();
