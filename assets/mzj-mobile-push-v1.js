(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCd2paKL200XRdz2SwFEUzAtfg51xWL5QA',
    authDomain: 'mzj-lead.firebaseapp.com',
    projectId: 'mzj-lead',
    storageBucket: 'mzj-lead.firebasestorage.app',
    messagingSenderId: '470098288857',
    appId: '1:470098288857:web:613125cfc1623b08abdec8',
    measurementId: 'G-981Z1T6Z91'
  };

  const PUSH_SETTINGS_COLLECTION = 'settings_sources';
  const PUSH_SETTINGS_DOC = 'push_notifications';
  const DEFAULT_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions';
  const DEVICE_ID_KEY = 'mzj_push_device_id_v3';
  const LAST_SUCCESS_KEY = 'mzj_push_last_success_v4';
  const SERVICE_WORKER_URL = '/sw.js?v=10';

  let currentStatus = { ok: false, state: 'idle', reason: 'not_started' };
  let runningPromise = null;
  let interactionArmed = false;
  let automaticStarted = false;
  let dashboardReady = Boolean(window.__MZJ_DASHBOARD_DATA_READY__);
  let foregroundMessageHandlerReady = false;

  function clean(value) {
    return String(value ?? '').trim();
  }

  function safeId(value) {
    return clean(value).replace(/[^0-9A-Za-z_-]/g, '_').slice(0, 190);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getAuthUser() {
    const appUser = window.__MZJ_CURRENT_USER__ || null;
    const authUser = window.__MZJ_FIREBASE_AUTH__?.currentUser || null;
    if (!appUser || !authUser) return null;
    return clean(appUser.uid) && clean(appUser.uid) === clean(authUser.uid) ? authUser : null;
  }

  function getFirestoreApi() {
    const db = window.__MZJ_FIRESTORE_DB__;
    const doc = window.__MZJ_FIRESTORE_DOC__;
    const getDoc = window.__MZJ_FIRESTORE_GETDOC__;
    const setDoc = window.__MZJ_FIRESTORE_SETDOC__;
    if (!db || !doc || !getDoc || !setDoc) return null;
    return { db, doc, getDoc, setDoc };
  }

  function isIos() {
    const ua = String(navigator.userAgent || '');
    const platform = String(navigator.platform || '');
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true;
  }

  function getDeviceId() {
    try {
      let id = clean(localStorage.getItem(DEVICE_ID_KEY));
      if (!id) {
        id = clean(globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`)
          .replace(/[^0-9A-Za-z_-]/g, '_');
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch {
      return safeId(`session_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    }
  }

  async function sha256Short(value) {
    try {
      const bytes = new TextEncoder().encode(String(value || ''));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch {
      return safeId(String(value || '').slice(-32));
    }
  }

  async function waitForSharedFirebase(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const user = getAuthUser();
      const fs = getFirestoreApi();
      if (user && fs) return { user, fs };
      await sleep(200);
    }
    return { user: getAuthUser(), fs: getFirestoreApi() };
  }

  async function readPushSettings(fs) {
    const ref = fs.doc(fs.db, PUSH_SETTINGS_COLLECTION, PUSH_SETTINGS_DOC);
    const snap = await fs.getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const nested = data.pushNotifications && typeof data.pushNotifications === 'object'
      ? data.pushNotifications
      : {};
    const config = { ...data, ...nested };
    return {
      enabled: config.enabled !== false,
      appName: clean(config.appName || 'MZJ CRM - Sales'),
      vapidKey: clean(config.vapidKey || config.vapid_key),
      subscriptionCollection: clean(
        config.subscriptionCollection ||
        config.subscription_collection ||
        DEFAULT_SUBSCRIPTIONS_COLLECTION
      ) || DEFAULT_SUBSCRIPTIONS_COLLECTION
    };
  }

  function friendlyReason(reason) {
    const value = clean(reason);
    if (value.includes('permission-denied')) return 'تعذر حفظ اشتراك الجهاز. انتظر اكتمال تسجيل الدخول ثم افتح التطبيق مرة أخرى.';
    if (value.includes('notification_permission_denied')) return 'إشعارات التطبيق محظورة من إعدادات الهاتف.';
    if (value.includes('missing_vapid_key')) return 'مفتاح VAPID غير موجود في إعدادات الإشعارات.';
    if (value.includes('firebase_messaging_not_supported')) return 'هذا المتصفح لا يدعم Firebase Messaging.';
    if (value.includes('empty_fcm_token')) return 'تعذر إنشاء رمز إشعارات لهذا الجهاز.';
    return value || 'تعذر تسجيل جهاز الإشعارات';
  }

  function publishStatus(status) {
    currentStatus = { ...status, at: new Date().toISOString() };
    try {
      localStorage.setItem('mzj_push_registration_status_v3', JSON.stringify(currentStatus));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('mzj:push-registration-status', { detail: currentStatus }));
    } catch {}
    return currentStatus;
  }

  function showFailure(reason) {
    if (!getAuthUser() || !(dashboardReady || window.__MZJ_DASHBOARD_DATA_READY__)) return;
    const notify = window.MZJNotifications?.showToast;
    if (typeof notify === 'function') {
      notify({
        type: 'important',
        title: 'تعذر تفعيل إشعارات الجهاز',
        body: friendlyReason(reason),
        sound: 'urgent-double'
      });
    }
  }

  function showSuccessOnce(subscriptionId) {
    const successKey = `${LAST_SUCCESS_KEY}_${safeId(subscriptionId || 'device')}`;
    try {
      if (localStorage.getItem(successKey) === '1') return;
      localStorage.setItem(successKey, '1');
    } catch {}
    const notify = window.MZJNotifications?.showToast;
    if (typeof notify === 'function') {
      notify({
        type: 'message',
        title: 'تم تفعيل الإشعارات',
        body: 'تم تسجيل هذا الجهاز بنجاح لاستقبال إشعارات MZJ CRM.',
        sound: 'success'
      });
    }
  }

  function armUserInteraction() {
    if (interactionArmed || !getAuthUser() || !(dashboardReady || window.__MZJ_DASHBOARD_DATA_READY__)) return;
    interactionArmed = true;
    const retry = () => {
      interactionArmed = false;
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('touchend', retry, true);
      window.removeEventListener('keydown', retry, true);
      register({ requestPermission: true, reason: 'user_interaction' }).catch(() => {});
    };
    window.addEventListener('pointerdown', retry, { once: true, capture: true });
    window.addEventListener('touchend', retry, { once: true, capture: true });
    window.addEventListener('keydown', retry, { once: true, capture: true });
  }

  async function saveSubscriptionWithRetry(fs, subscriptionRef, data, user) {
    try {
      await fs.setDoc(subscriptionRef, data, { merge: true });
    } catch (error) {
      if (!clean(error?.code || error?.message).includes('permission-denied')) throw error;
      await user.getIdToken?.(true).catch(() => null);
      await sleep(700);
      const stableUser = getAuthUser();
      if (!stableUser || stableUser.uid !== user.uid) throw error;
      await fs.setDoc(subscriptionRef, data, { merge: true });
    }
  }

  async function register(options = {}) {
    if (runningPromise) return runningPromise;

    runningPromise = (async () => {
      const { user, fs } = await waitForSharedFirebase();
      if (!user) return publishStatus({ ok: false, state: 'waiting', reason: 'no_authenticated_user' });
      if (!fs) return publishStatus({ ok: false, state: 'waiting', reason: 'shared_firestore_not_ready' });
      if (!(dashboardReady || window.__MZJ_DASHBOARD_DATA_READY__)) {
        return publishStatus({ ok: false, state: 'waiting', reason: 'dashboard_not_ready' });
      }

      if (!globalThis.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in globalThis)) {
        return publishStatus({ ok: false, state: 'unsupported', reason: 'push_not_supported' });
      }

      if (isIos() && !isStandalone()) {
        armUserInteraction();
        return publishStatus({ ok: false, state: 'installation_required', reason: 'ios_requires_home_screen_app' });
      }

      let permission = Notification.permission;
      if (permission === 'default') {
        if (options.requestPermission !== true) {
          armUserInteraction();
          return publishStatus({ ok: false, state: 'permission_required', reason: 'tap_inside_app_to_allow_notifications' });
        }
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        if (permission === 'default') armUserInteraction();
        return publishStatus({ ok: false, state: 'permission_required', reason: `notification_permission_${permission}` });
      }

      await user.getIdToken?.().catch(() => null);

      let pushSettings;
      try {
        pushSettings = await readPushSettings(fs);
      } catch (error) {
        if (!clean(error?.code || error?.message).includes('permission-denied')) throw error;
        await user.getIdToken?.(true).catch(() => null);
        await sleep(700);
        pushSettings = await readPushSettings(fs);
      }

      if (!pushSettings.enabled) {
        return publishStatus({ ok: false, state: 'disabled', reason: 'push_disabled_in_settings' });
      }
      if (!pushSettings.vapidKey) {
        return publishStatus({ ok: false, state: 'missing_config', reason: 'missing_vapid_key' });
      }

      const pushRegistration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: '/',
        updateViaCache: 'none'
      });
      const readyRegistration = await navigator.serviceWorker.ready;

      const [{ initializeApp, getApps }, messagingSdk] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js')
      ]);

      const appName = 'mzj-mobile-push';
      const messagingApp = getApps().find(item => item.name === appName) || initializeApp(FIREBASE_CONFIG, appName);
      const supported = await messagingSdk.isSupported().catch(() => false);
      if (!supported) {
        return publishStatus({ ok: false, state: 'unsupported', reason: 'firebase_messaging_not_supported' });
      }

      const messaging = messagingSdk.getMessaging(messagingApp);

      if (!foregroundMessageHandlerReady) {
        foregroundMessageHandlerReady = true;
        messagingSdk.onMessage(messaging, payload => {
          try {
            const data = payload?.data || {};
            const notification = payload?.notification || {};
            const title = clean(data.title || notification.title || 'MZJ CRM');
            const body = clean(data.body || notification.body || 'إشعار جديد');
            const targetUrl = clean(data.url || '/#/dashboard');
            const tag = clean(data.eventId || data.notificationId) || `mzj_${Date.now()}`;

            readyRegistration.showNotification(title, {
              body,
              icon: '/assets/icons/icon-192.png',
              badge: '/assets/icons/icon-96.png',
              dir: 'rtl',
              lang: 'ar',
              tag,
              renotify: true,
              silent: false,
              vibrate: [250, 100, 250],
              timestamp: Date.now(),
              data: { ...data, url: targetUrl }
            }).catch(error => {
              console.warn('MZJ foreground system notification failed:', error);
            });

            window.MZJNotifications?.showToast?.({
              type: data.type === 'new_lead' ? 'newLead' : 'message',
              title,
              body,
              sound: data.type === 'new_lead' ? 'urgent-double' : 'message'
            });
          } catch (error) {
            console.warn('MZJ foreground push handler failed:', error);
          }
        });
      }

      const token = await messagingSdk.getToken(messaging, {
        vapidKey: pushSettings.vapidKey,
        serviceWorkerRegistration: readyRegistration
      });

      if (!token) {
        return publishStatus({ ok: false, state: 'failed', reason: 'empty_fcm_token' });
      }

      const tokenHash = await sha256Short(token);
      const deviceId = getDeviceId();
      const subscriptionId = safeId(`web_${user.uid}_${tokenHash || deviceId}`);
      const subscriptionRef = fs.doc(fs.db, pushSettings.subscriptionCollection, subscriptionId);
      const now = new Date().toISOString();

      await saveSubscriptionWithRetry(fs, subscriptionRef, {
        id: subscriptionId,
        uid: user.uid,
        userUid: user.uid,
        authUid: user.uid,
        email: clean(user.email),
        name: clean(user.displayName || user.email || user.uid),
        displayName: clean(user.displayName || user.email || user.uid),
        token,
        active: true,
        appName: pushSettings.appName,
        platform: isIos() ? 'ios-pwa' : 'android-pwa',
        deviceId,
        tokenHash,
        permission: 'granted',
        origin: location.origin,
        serviceWorkerScope: readyRegistration.scope,
        userAgent: navigator.userAgent,
        updatedAt: now,
        updatedAtMs: Date.now(),
        lastSeenAt: now,
        lastSeenAtMs: Date.now()
      }, user);

      showSuccessOnce(subscriptionId);
      return publishStatus({
        ok: true,
        state: 'registered',
        reason: 'subscription_saved',
        collection: pushSettings.subscriptionCollection,
        subscriptionId,
        uid: user.uid
      });
    })().catch(error => {
      const reason = clean(error?.code || error?.message || error || 'push_registration_failed');
      console.error('MZJ mobile push registration failed:', error);
      const result = publishStatus({ ok: false, state: 'failed', reason });
      showFailure(reason);
      if (getAuthUser() && (dashboardReady || window.__MZJ_DASHBOARD_DATA_READY__)) armUserInteraction();
      return result;
    }).finally(() => {
      runningPromise = null;
    });

    return runningPromise;
  }

  function scheduleAutomaticRegistration() {
    if (automaticStarted) return;
    const user = getAuthUser();
    if (!user) return;
    if (!(dashboardReady || window.__MZJ_DASHBOARD_DATA_READY__)) return;
    automaticStarted = true;

    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    if (permission === 'granted') {
      setTimeout(() => register({ requestPermission: false, reason: 'automatic_granted' }).catch(() => {}), 1200);
    } else {
      armUserInteraction();
      publishStatus({ ok: false, state: 'permission_required', reason: 'tap_inside_app_to_allow_notifications' });
    }
  }

  window.MZJPushRegistration = {
    register: () => register({ requestPermission: true, reason: 'manual' }),
    retry: () => register({ requestPermission: true, reason: 'retry' }),
    getStatus: () => ({ ...currentStatus }),
    testLocal: async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification('اختبار إشعارات MZJ CRM', {
        body: 'هذا اختبار محلي من نفس الجهاز.',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-96.png',
        dir: 'rtl',
        lang: 'ar',
        tag: `mzj_local_${Date.now()}`,
        renotify: true,
        silent: false,
        vibrate: [250, 100, 250],
        timestamp: Date.now(),
        data: { url: '/#/dashboard', swVersion: 'mzj-push-sw-v10' }
      });
      return { ok: true };
    }
  };

  window.addEventListener('mzj:dashboard-data-ready', () => {
    dashboardReady = true;
    automaticStarted = false;
    scheduleAutomaticRegistration();
  });

  window.addEventListener('mzj:auth-state', event => {
    if (event?.detail?.user) {
      automaticStarted = false;
      scheduleAutomaticRegistration();
    } else {
      automaticStarted = false;
    }
  });

  window.addEventListener('mzj:firebase-ready', () => {
    scheduleAutomaticRegistration();
  });

  if (getAuthUser() && dashboardReady) scheduleAutomaticRegistration();
})();
