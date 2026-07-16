(() => {
  'use strict';

  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  const SERVICE_WORKER_URL = '/sw.js?v=11';
  if (!('serviceWorker' in navigator) || !isSecure) return;

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' });
    } catch (error) {
      console.warn('MZJ PWA registration failed:', error);
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__MZJ_PWA_INSTALL_PROMPT__ = event;
    window.dispatchEvent(new CustomEvent('mzj:pwa-install-ready'));
  });

  window.addEventListener('appinstalled', () => {
    window.__MZJ_PWA_INSTALL_PROMPT__ = null;
  });
})();
