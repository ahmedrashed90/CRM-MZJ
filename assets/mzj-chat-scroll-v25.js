/* MZJ CRM v25 - keep the conversation at its current position when changing status.
   UI behavior only. No Firebase paths, customer data, statuses, or send logic are changed. */
(() => {
  'use strict';

  const SELECTOR = '.messages-list';
  const STATUS_SELECTOR = '.dashboard-chat-quick-status select';
  const initialized = new WeakSet();
  const state = new WeakMap();
  let pendingRestore = null;

  function isNearBottom(element, threshold = 120) {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
  }

  function scrollToBottom(element, behavior = 'auto') {
    if (!element || !element.isConnected) return;
    try {
      element.scrollTo({ top: element.scrollHeight, behavior });
    } catch {
      element.scrollTop = element.scrollHeight;
    }
  }

  function settleAtBottom(element) {
    const delays = [0, 50, 140, 320, 700];
    delays.forEach((delay) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(() => scrollToBottom(element, 'auto'));
      }, delay);
    });
  }

  function captureCurrentPosition() {
    const element = document.querySelector(SELECTOR);
    if (!element) return null;
    return {
      nearBottom: isNearBottom(element, 180),
      scrollTop: element.scrollTop,
      distanceFromBottom: Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight),
      capturedAt: Date.now()
    };
  }

  function restorePosition(element, snapshot) {
    if (!element || !element.isConnected || !snapshot) return;
    if (snapshot.nearBottom) {
      scrollToBottom(element, 'auto');
      return;
    }
    const target = Math.max(0, element.scrollHeight - element.clientHeight - snapshot.distanceFromBottom);
    try {
      element.scrollTo({ top: target, behavior: 'auto' });
    } catch {
      element.scrollTop = target;
    }
  }

  function schedulePositionRestore(snapshot) {
    if (!snapshot) return;
    pendingRestore = snapshot;
    const delays = [0, 30, 80, 160, 300, 520, 850, 1300];
    delays.forEach((delay, index) => {
      window.setTimeout(() => {
        const element = document.querySelector(SELECTOR);
        if (!element || !pendingRestore) return;
        window.requestAnimationFrame(() => restorePosition(element, pendingRestore));
        if (index === delays.length - 1) pendingRestore = null;
      }, delay);
    });
  }

  function bindMedia(element) {
    element.querySelectorAll('img, video, audio').forEach((media) => {
      if (media.dataset.mzjChatScrollBound === '1') return;
      media.dataset.mzjChatScrollBound = '1';
      const eventName = media.tagName === 'IMG' ? 'load' : 'loadedmetadata';
      media.addEventListener(eventName, () => {
        if (pendingRestore) {
          restorePosition(element, pendingRestore);
          return;
        }
        const current = state.get(element);
        if (!current || current.keepAtBottom || isNearBottom(element)) {
          scrollToBottom(element, 'auto');
        }
      }, { once: true });
    });
  }

  function initializeMessagesList(element) {
    if (initialized.has(element)) {
      if (pendingRestore) restorePosition(element, pendingRestore);
      return;
    }
    initialized.add(element);

    const current = { keepAtBottom: true, initialDone: false };
    state.set(element, current);

    const performInitialScroll = () => {
      const hasMessages = Boolean(element.querySelector('.message-bubble'));
      if (!hasMessages) return false;
      if (pendingRestore) {
        restorePosition(element, pendingRestore);
      } else {
        settleAtBottom(element);
      }
      bindMedia(element);
      current.initialDone = true;
      window.setTimeout(() => {
        current.keepAtBottom = isNearBottom(element, 160);
      }, 850);
      return true;
    };

    element.addEventListener('scroll', () => {
      if (!current.initialDone) return;
      current.keepAtBottom = isNearBottom(element, 120);
    }, { passive: true });

    const messagesObserver = new MutationObserver((mutations) => {
      bindMedia(element);

      if (pendingRestore) {
        restorePosition(element, pendingRestore);
      }

      if (!current.initialDone) {
        performInitialScroll();
        return;
      }

      const addedMessage = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some((node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches?.('.message-bubble') || node.querySelector?.('.message-bubble'))
        )
      );

      if (addedMessage && current.keepAtBottom && !pendingRestore) {
        window.requestAnimationFrame(() => scrollToBottom(element, 'smooth'));
      }
    });

    messagesObserver.observe(element, { childList: true, subtree: true });

    if (!performInitialScroll()) {
      window.setTimeout(performInitialScroll, 80);
      window.setTimeout(performInitialScroll, 250);
    }
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(SELECTOR)) {
      initializeMessagesList(root);
    }
    root.querySelectorAll?.(SELECTOR).forEach(initializeMessagesList);
  }

  function start() {
    scan();

    document.addEventListener('change', (event) => {
      const select = event.target?.closest?.(STATUS_SELECTOR);
      if (!select) return;
      const snapshot = captureCurrentPosition();
      schedulePositionRestore(snapshot);
    }, true);

    const pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }
      }
      if (pendingRestore) {
        const element = document.querySelector(SELECTOR);
        if (element) restorePosition(element, pendingRestore);
      }
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
