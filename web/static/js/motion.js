/* Motion system: one navigation layer and one scroll engine.
   Entry: deceleration; exit: acceleration; hover: asymmetric ease-in-out.
   Works with ordinary Flask page loads (no SPA/framework required). */
(() => {
  'use strict';
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const EXIT_MS = 175;
  let navigating = false;

  // Called by inventory rows as well as by the link interceptor.
  function navigateTo(href) {
    const destination = new URL(href, window.location.href);
    if (navigating || destination.href === window.location.href) return;
    if (destination.origin !== window.location.origin || reducedMotion.matches) {
      window.location.assign(destination.href);
      return;
    }
    navigating = true;
    try {
      sessionStorage.setItem('snmp-route', JSON.stringify({
        pathname: destination.pathname, search: destination.search, ts: Date.now(),
      }));
    } catch (_) { /* fallback remains a regular page navigation */ }
    root.classList.add('route-exiting');
    // Navigate after the curtain reached full opacity; never rely on an
    // animationend event that may not fire for a hidden/reduced-motion tab.
    window.setTimeout(() => window.location.assign(destination.href), EXIT_MS);
  }
  window.navigateTo = navigateTo;

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target : event.target?.parentElement;
    const anchor = element?.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')) return;
    const destination = new URL(anchor.href);
    if (destination.origin !== location.origin) return;
    if (destination.pathname === location.pathname && destination.search === location.search) {
      if (!destination.hash) return; // ya estamos aquí
      const id = decodeURIComponent(destination.hash.slice(1));
      const section = document.getElementById(id);
      if (!section) return;
      event.preventDefault();
      history.pushState(null, '', destination.href);
      section.scrollIntoView({
        behavior: reducedMotion.matches ? 'instant' : 'smooth',
        block: 'start',
      });
      return;
    }
    event.preventDefault();
    navigateTo(destination.href);
  });

  const curtain = document.querySelector('.route-curtain');
  const completeArrival = () => {
    if (!root.classList.contains('route-entering')) return;
    // Allow both initial opaque paint and the transition to the revealed state.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('route-ready')));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', completeArrival, { once: true });
  } else completeArrival();
  curtain?.addEventListener('transitionend', event => {
    if (event.propertyName === 'opacity' && root.classList.contains('route-ready')) {
      root.classList.remove('route-entering', 'route-ready');
    }
  });
  window.addEventListener('pageshow', event => {
    // A restored page can still have its exiting class in the back/forward cache.
    navigating = false;
    root.classList.remove('route-exiting');
    if (event.persisted) root.classList.remove('route-entering', 'route-ready');
  });

  /* Wheel inertia: handle document scrolling even when hovering tables/cards.
     scroll-behavior CSS affects anchor jumps, not wheel events. No native/JS
     smoothing mix; avoid touch, keyboard and scrollable modal descendants. */
  const scroller = document.scrollingElement || document.documentElement;
  let target = scroller.scrollTop;
  let animationFrame = 0;
  let previousFrame = 0;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const maximum = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);

  function advance(time) {
    const dt = previousFrame ? clamp(time - previousFrame, 1, 40) : 16;
    previousFrame = time;
    target = clamp(target, 0, maximum());
    const remaining = target - scroller.scrollTop;
    // 150 ms time constant: frame-rate independent, no snapping/overshoot.
    const gain = 1 - Math.exp(-dt / 150);
    if (Math.abs(remaining) < .6) {
      scroller.scrollTop = target;
      animationFrame = 0;
      previousFrame = 0;
      return;
    }
    scroller.scrollTop += remaining * gain;
    animationFrame = requestAnimationFrame(advance);
  }

  function nestedCanScroll(targetEl, delta) {
    let element = targetEl instanceof Element ? targetEl : targetEl?.parentElement;
    for (; element && element !== document.body && element !== document.documentElement;
      element = element.parentElement) {
      const style = getComputedStyle(element);
      if (!/(auto|scroll)/.test(style.overflowY)) continue;
      if (element.scrollHeight <= element.clientHeight + 2) continue;
      // If the nested scroller is at its edge, allow smooth page scrolling.
      if (delta < 0 && element.scrollTop > 1) return true;
      if (delta > 0 && element.scrollTop < element.scrollHeight - element.clientHeight - 1) return true;
    }
    return false;
  }

  function onWheel(event) {
    if (event.defaultPrevented || !event.cancelable || reducedMotion.matches ||
        navigating || root.classList.contains('route-exiting') ||
        event.ctrlKey || event.metaKey || event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const source = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!source || source.closest('.modal.show, select, textarea, [data-native-scroll]')) return;
    const dy = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 19 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * window.innerHeight : event.deltaY;
    if (!Number.isFinite(dy) || Math.abs(dy) < .01 || nestedCanScroll(source, dy)) return;
    const limit = maximum();
    if (limit < 1) return;
    event.preventDefault();
    // Every wheel tick, including very small increments, goes through the same
    // damping function. Consecutive ticks accumulate without stopping the motion.
    if (!animationFrame) target = scroller.scrollTop;
    target = clamp(target + clamp(dy * 1.12, -680, 680), 0, limit);
    if (!animationFrame) animationFrame = requestAnimationFrame(advance);
  }
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });

  function stop() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrame = 0;
    target = scroller.scrollTop;
  }
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('keydown', stop);
  window.addEventListener('pointerdown', stop, { passive: true });
  reducedMotion.addEventListener?.('change', stop);
})();
