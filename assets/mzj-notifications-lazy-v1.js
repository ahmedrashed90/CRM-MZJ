(() => {
  'use strict';
  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    import('/assets/mzj-notification-settings-v57.js?v=63').catch(error => {
      loaded = false;
      console.warn('MZJ notification settings lazy load failed:', error);
    });
  };

  if (window.__MZJ_DASHBOARD_DATA_READY__) {
    setTimeout(load, 500);
  } else {
    window.addEventListener('mzj:dashboard-data-ready', () => setTimeout(load, 500), { once: true });
    setTimeout(load, 18000);
  }
})();
