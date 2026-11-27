const RESTORE_TIMEOUT_MS = 4000;
const USER_INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'];

export function installWorkspaceScroll(panel, env = window) {
  const positions = new Map();
  let page = '';
  let pendingTop = null;
  let timer;

  function cancelRestore() {
    pendingTop = null;
    env.clearTimeout(timer);
  }

  function applyRestore() {
    if (pendingTop === null || panel.hidden) return;
    env.scrollTo(0, pendingTop);
    if (Math.abs(env.scrollY - pendingTop) <= 1) cancelRestore();
  }

  if (typeof env.ResizeObserver === 'function') {
    new env.ResizeObserver(applyRestore).observe(panel);
  }
  for (const type of USER_INTERACTION_EVENTS) {
    env.addEventListener(type, cancelRestore, { capture: true, passive: true });
  }

  return {
    get page() {
      return page;
    },
    remember() {
      if (page && !panel.hidden) positions.set(page, Math.max(0, env.scrollY));
      cancelRestore();
    },
    restore(nextPage) {
      cancelRestore();
      page = nextPage;
      pendingTop = positions.get(page) || 0;
      applyRestore();
      // Retry when a loading skeleton grows, until the user interacts with the page.
      if (pendingTop !== null) timer = env.setTimeout(cancelRestore, RESTORE_TIMEOUT_MS);
    },
    reset() {
      cancelRestore();
      positions.clear();
      page = '';
      env.scrollTo(0, 0);
    },
  };
}

export function revealActiveWorkspaceTab(menu) {
  if (!menu || menu.scrollWidth <= menu.clientWidth) return;
  const active = menu.querySelector('.nav-tab.active:not([hidden])');
  if (!active) return;

  const left = menu.getBoundingClientRect().left + menu.clientLeft;
  const right = left + menu.clientWidth;
  const tab = active.getBoundingClientRect();
  // Keep the document's vertical scroll position.
  if (tab.left < left) menu.scrollLeft += tab.left - left;
  else if (tab.right > right) menu.scrollLeft += tab.right - right;
}
