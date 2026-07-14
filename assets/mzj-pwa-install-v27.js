(() => {
  'use strict';

  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!('serviceWorker' in navigator) || !isSecure) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      registration.update().catch(() => {});
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
