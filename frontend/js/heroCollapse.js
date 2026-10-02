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

  const content = hero.querySelector('#heroCollapsingContent');
  const topBar = hero.querySelector('#heroTopBar');
  const balanceWrapper = hero.querySelector('#heroBalanceWrapper');
  const actionGroup = hero.querySelector('#heroActionGroup');
  const securityCard = hero.querySelector('#heroSecurityCard');
  const liquidLights = hero.querySelector('#heroLiquidLights');
  let isDocked = false;
  let ticking = false;

  // Compositor-only collapse. The prototype shrank the hero's height and
  // border-radius every frame, which re-laid-out and repainted the whole hero
  // (gradient, shadow, blurred orbs) on each scroll step: 80–100 ms frames on
  // Android. Now the hero keeps its size and slides up by the scroll distance
  // while its content slides down by the same amount, so the content stays
  // put and the hero's bottom edge rises exactly as before, using transforms
  // the GPU can move without repainting.
  const applyCollapse = (yScroll) => {
    const y = Math.min(scrollDistance, Math.max(0, yScroll));
    const progress = y / scrollDistance;
    hero.style.transform = `translate3d(0, ${(-y).toFixed(1)}px, 0)`;
    if (content) content.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    if (progress > 0.85 !== isDocked) {
      isDocked = progress > 0.85;
      hero.classList.toggle('navbar-docked', isDocked);
    }

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

  // Touches and wheel pass through the hero to the scroll view (css/app.css:
  // the hero is pointer-events: none except its buttons and cards), so the
  // list scrolls natively with momentum. The prototype moved scrollTop by hand
  // from touchmove, which fought the browser's own scrolling and stuttered.
  // While scrolling, the decorative animations (blurred orbs, floating card)
  // are paused so each frame only moves a few compositor layers.
  let scrollIdle;
  const onScroll = () => {
    if (!hero.classList.contains('is-scrolling')) hero.classList.add('is-scrolling');
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(() => hero.classList.remove('is-scrolling'), 160);
    requestUpdate();
  };
  scrollView.addEventListener('scroll', onScroll, { passive: true });

  applyCollapse(scrollView.scrollTop);

  // Longest stagger is 650 ms delay + 650 ms: hand control to the collapse after that.
  const entered = container.classList.contains('no-enter') ? 0 : 1400;
  const enteredTimer = setTimeout(() => {
    hero.classList.add('entered');
    applyCollapse(scrollView.scrollTop);
  }, entered);

  cleanup = () => {
    clearTimeout(enteredTimer);
    clearTimeout(scrollIdle);
    cleanup = null;
  };
}
