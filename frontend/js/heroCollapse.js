/* ==========================================================================
   HOME HERO SCROLL COLLAPSE — the prototype's collapsing dark hero,
   unchanged in behaviour (430 px → 98 px), moved into its own module.
   Fix: the prototype called an undefined updateCollapse() at the end, which
   threw on every Home render.
   ========================================================================== */

let cleanup = null;

export function initHeroScrollCollapse(container) {
  cleanup?.();
  const hero = container.querySelector('#homeHero');
  const scrollView = container.querySelector('#homeScrollView');
  const spacer = container.querySelector('#heroScrollSpacer');
  if (!hero || !scrollView || !spacer) return;

  const expandedH = 430;
  const collapsedH = 98;
  const scrollDistance = expandedH - collapsedH;
  spacer.style.height = `${expandedH}px`;
  hero.style.height = `${expandedH}px`;

  const topBar = hero.querySelector('#heroTopBar');
  const balanceWrapper = hero.querySelector('#heroBalanceWrapper');
  const actionGroup = hero.querySelector('#heroActionGroup');
  const securityCard = hero.querySelector('#heroSecurityCard');
  const liquidLights = hero.querySelector('#heroLiquidLights');
  let isDocked = false;
  let ticking = false;

  const applyCollapse = (yScroll) => {
    const y = Math.max(0, yScroll);
    const progress = Math.min(1, Math.max(0, y / scrollDistance));
    hero.style.height = `${Math.max(collapsedH, expandedH - y).toFixed(1)}px`;
    const radius = Math.max(0, 26 - progress * 26);
    hero.style.borderRadius = `0 0 ${radius.toFixed(1)}px ${radius.toFixed(1)}px`;
    if (progress > 0.85 !== isDocked) {
      isDocked = progress > 0.85;
      hero.classList.toggle('navbar-docked', isDocked);
    }
    if (topBar) topBar.style.transform = 'translate3d(0, 0, 0)';

    if (balanceWrapper) {
      let t = 'translate3d(0, 0, 0) scale(1)';
      let o = 1;
      let pe = 'auto';
      if (progress >= 0.25 && progress < 0.55) {
        const sp = (progress - 0.25) / 0.3;
        t = `translate3d(0, -${(sp * 32).toFixed(1)}px, 0) scale(${(1 - sp * 0.08).toFixed(3)})`;
      } else if (progress >= 0.55 && progress < 0.85) {
        const sp = (progress - 0.55) / 0.3;
        t = `translate3d(0, -${(32 + sp * 50).toFixed(1)}px, 0) scale(${(0.92 - sp * 0.15).toFixed(3)})`;
        o = 1 - sp * 0.98;
        pe = 'none';
      } else if (progress >= 0.85) {
        t = 'translate3d(0, -85px, 0) scale(0.77)';
        o = 0;
        pe = 'none';
      }
      balanceWrapper.style.transform = t;
      balanceWrapper.style.opacity = o.toFixed(2);
      balanceWrapper.style.pointerEvents = pe;
    }

    if (actionGroup) {
      if (progress < 0.15) {
        actionGroup.style.transform = 'translate3d(0, 0, 0)';
        actionGroup.style.opacity = '1';
        actionGroup.style.pointerEvents = 'auto';
      } else if (progress < 0.48) {
        const sp = (progress - 0.15) / 0.33;
        actionGroup.style.transform = `translate3d(0, -${(sp * 40).toFixed(1)}px, 0)`;
        actionGroup.style.opacity = (1 - sp).toFixed(2);
        actionGroup.style.pointerEvents = 'auto';
      } else {
        actionGroup.style.transform = 'translate3d(0, -45px, 0)';
        actionGroup.style.opacity = '0';
        actionGroup.style.pointerEvents = 'none';
      }
    }

    if (securityCard) {
      if (progress < 0.26) {
        const sp = progress / 0.26;
        securityCard.style.transform = `translate3d(0, -${(sp * 25).toFixed(1)}px, 0)`;
        securityCard.style.opacity = (1 - sp).toFixed(2);
        securityCard.style.pointerEvents = 'auto';
      } else {
        securityCard.style.transform = 'translate3d(0, -30px, 0)';
        securityCard.style.opacity = '0';
        securityCard.style.pointerEvents = 'none';
      }
    }

    if (liquidLights) {
      liquidLights.style.transform = `translate3d(0, -${(progress * 20).toFixed(1)}px, 0) scale(${(1 - progress * 0.15).toFixed(3)})`;
      liquidLights.style.opacity = (1 - progress * 0.35).toFixed(2);
    }
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      applyCollapse(scrollView.scrollTop);
      ticking = false;
    });
  };

  // Forward gestures on the hero to the scroll view (the hero sits above it).
  const onWheel = (e) => {
    scrollView.scrollTop += e.deltaY;
    requestUpdate();
  };
  let touchStartY = 0;
  let initialScrollTop = 0;
  const onTouchStart = (e) => {
    touchStartY = e.touches[0].clientY;
    initialScrollTop = scrollView.scrollTop;
  };
  const onTouchMove = (e) => {
    scrollView.scrollTop = initialScrollTop + (touchStartY - e.touches[0].clientY);
    requestUpdate();
  };
  let dragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;
  const onMouseDown = (e) => {
    if (e.target.closest('button, .action-shortcut-item, [data-go], [data-act]')) return;
    dragging = true;
    dragStartY = e.clientY;
    dragStartScroll = scrollView.scrollTop;
    hero.style.cursor = 'grabbing';
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    scrollView.scrollTop = dragStartScroll + (dragStartY - e.clientY);
    requestUpdate();
  };
  const onMouseUp = () => {
    dragging = false;
    hero.style.cursor = '';
  };

  scrollView.addEventListener('scroll', requestUpdate, { passive: true });
  hero.addEventListener('wheel', onWheel, { passive: true });
  hero.addEventListener('touchstart', onTouchStart, { passive: true });
  hero.addEventListener('touchmove', onTouchMove, { passive: true });
  hero.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  applyCollapse(scrollView.scrollTop);

  // Longest stagger is 650 ms delay + 650 ms: hand control to the collapse after that.
  const entered = container.classList.contains('no-enter') ? 0 : 1400;
  const enteredTimer = setTimeout(() => {
    hero.classList.add('entered');
    applyCollapse(scrollView.scrollTop);
  }, entered);

  cleanup = () => {
    clearTimeout(enteredTimer);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    cleanup = null;
  };
}
