/* ==========================================================================
   HOME HERO — pinned behind the content sheet.
   The hero sits inside the Home scroll view with `position: sticky; top: 0`
   (css/app.css) and the content sheet comes after it with a higher z-index,
   so as you scroll the sheet simply wipes over the hero, the way native
   collapsing headers do. Nothing in the hero shrinks, scales or fades, and
   no style is written per frame, which is what keeps it smooth.

   This module only:
     - marks the fixed top bar `docked` once the hero is fully covered
       (adds a shadow line under it)
     - pauses the hero's decorative animations while the list is moving
     - adds `entered` after the entrance stagger so re-renders don't replay it
   ========================================================================== */

let cleanup = null;

export function initHeroScrollCollapse(container) {
  cleanup?.();
  const hero = container.querySelector('#homeHero');
  const scrollView = container.querySelector('#homeScrollView');
  const topBar = container.querySelector('#homeTopBar');
  if (!hero || !scrollView) return;

  let docked = false;
  let ticking = false;
  let idle;
  // Read the hero height once (and on resize), never on a scroll frame.
  let threshold = hero.offsetHeight - 8;
  const onResize = () => { threshold = hero.offsetHeight - 8; };
  window.addEventListener('resize', onResize);

  const update = () => {
    ticking = false;
    const covered = scrollView.scrollTop >= threshold;
    if (covered !== docked) {
      docked = covered;
      topBar?.classList.toggle('docked', docked);
    }
  };
  const onScroll = () => {
    if (!hero.classList.contains('is-scrolling')) hero.classList.add('is-scrolling');
    clearTimeout(idle);
    idle = setTimeout(() => hero.classList.remove('is-scrolling'), 160);
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  scrollView.addEventListener('scroll', onScroll, { passive: true });
  update();

  // Longest stagger is 650 ms delay + 650 ms.
  const entered = container.classList.contains('no-enter') ? 0 : 1400;
  const enteredTimer = setTimeout(() => hero.classList.add('entered'), entered);

  cleanup = () => {
    clearTimeout(enteredTimer);
    clearTimeout(idle);
    window.removeEventListener('resize', onResize);
    cleanup = null;
  };
}
