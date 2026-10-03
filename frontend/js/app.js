/* ==========================================================================
   BITMINE APP SHELL — routing, sign-in gate, event delegation, live values,
   and the desktop simulator (device frame + screen gallery) from the
   prototype. On a phone (Capacitor) the simulator chrome is hidden and the
   app runs full-screen (see css/app.css, "Device mode").
   ========================================================================== */

import { auth, post, ApiError } from './api.js';
import { state, subscribe, refresh, ensure, loadKeyed, bootstrap, reset, startPolling, stopPolling, liveBalanceMsat, liveTodayMsat } from './store.js';
import { toast, closeSheet, openSheet, sheetOpen, busy, formData, showFieldError } from './ui.js';
import { icons } from './icons.js';
import { config } from './config.js';
import { isNative, platform, pushToken, onPushTap, onBackButton, onResume, exitApp, setStatusBar, signOutPurchases, openUrl, setBanner } from './native.js';
import { cycleUnit, toggleBalanceHidden, liveBalanceHtml, liveSmallText, moneySub, countdownText } from './screens/parts.js';
import { fmtCountdown } from './format.js';

import * as authScreens from './screens/auth.js';
import * as homeScreens from './screens/home.js';
import * as miningScreens from './screens/mining.js';
import * as walletScreens from './screens/wallet.js';
import * as contentScreens from './screens/content.js';
import * as accountScreens from './screens/account.js';

const modules = [authScreens, homeScreens, miningScreens, walletScreens, contentScreens, accountScreens];
const screens = Object.assign({}, ...modules.map((m) => m.screens ?? {}), {
  update: {
    nav: false,
    dark: true,
    render: () => `
      <div class="auth-screen"><div class="auth-hero"><div class="auth-brand"><div class="auth-logo"><img src="./assets/images/logo.png" alt="BitMine"/></div><span>BitMine</span></div>
        <h1>Update required</h1><p>${state.config?.updateMessage ?? 'A new version of BitMine is available.'}</p></div>
        <div class="auth-card"><p class="bm-hint">Please update to keep mining. Your balance and miners are safe.</p>
        <button class="btn-primary btn-block" data-act="open-store">Update BitMine</button></div></div>`,
  },
});
const actions = Object.assign({}, ...modules.map((m) => m.actions ?? {}));
const forms = Object.assign({}, ...modules.map((m) => m.forms ?? {}));

const AUTH_SCREENS = new Set(['welcome', 'signin', 'signup', 'verify', 'twofa', 'forgot', 'reset', 'update']);
const TABS = ['home', 'wallet', 'miners', 'market', 'profile'];

// ── device id (for the backend's abuse signals; not used for sign-in) ─────
const deviceId = (() => {
  try {
    let id = localStorage.getItem('bitmine.device');
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('bitmine.device', id);
    }
    return id;
  } catch {
    return undefined;
  }
})();

// ── router ────────────────────────────────────────────────────────────────
let current = { id: 'welcome', params: {} };
let history = [];
let renderedDirty = false;

const container = () => document.getElementById('activeScreenContainer');

function scroller() {
  const c = container();
  return c?.querySelector('#homeScrollView') ?? c?.querySelector('.screen-scroll-view, .auth-screen');
}

const ctx = {
  get params() {
    return current.params;
  },
  deviceId,
  go(id, params = {}, opts = {}) {
    if (!screens[id]) return;
    if (!auth.signedIn && !AUTH_SCREENS.has(id)) id = 'welcome';
    if (!opts.replace && current.id !== id) history.push(current);
    if (opts.resetHistory) history = [];
    current = { id, params };
    render({ fresh: true });
  },
  back() {
    if (sheetOpen()) return closeSheet();
    const prev = history.pop();
    if (prev) {
      current = prev;
      render({ fresh: true });
    } else if (auth.signedIn && current.id !== 'home') {
      ctx.go('home', {}, { replace: true });
    } else if (isNative) {
      exitApp();
    }
  },
  rerender() {
    render({ fresh: false });
  },
  refresh: (...keys) => refresh(...keys),
  ensure: (key) => ensure(key),
  ensureKeyed: (kind, id) => (state[kind]?.[id] ? Promise.resolve() : loadKeyed(kind, id)),
  async signedIn(res) {
    auth.set(res);
    state.me = res.user;
    history = [];
    current = { id: 'home', params: {} };
    render({ fresh: true });
    await afterSignIn();
  },
  async signOut({ remote } = { remote: true }) {
    if (remote) {
      const refreshToken = JSON.parse(localStorage.getItem('bitmine.session') || '{}').refreshToken;
      if (refreshToken) await post('/v1/auth/logout', { refreshToken }).catch(() => undefined);
    }
    stopPolling();
    await signOutPurchases();
    // Move to the welcome screen first: clearing the session notifies the
    // "session ended elsewhere" listener, which must see an auth screen here.
    history = [];
    current = { id: 'welcome', params: {} };
    auth.clear();
    reset();
    render({ fresh: true });
  },
};

function render({ fresh }) {
  const el = container();
  if (!el) return;
  const screen = screens[current.id] ?? screens.home;
  const sv = scroller();
  const keepScroll = !fresh && sv ? sv.scrollTop : 0;

  // Entrance animations play on navigation only, not on data refreshes.
  el.classList.toggle('no-enter', !fresh);
  el.innerHTML = screen.render(ctx);
  renderedDirty = false;
  screen.after?.(el, ctx);

  const nsv = scroller();
  if (nsv && keepScroll) nsv.scrollTop = keepScroll;
  if (fresh && nsv) nsv.scrollTop = 0;
  if (!fresh && current.id === 'home' && keepScroll) nsv?.dispatchEvent(new Event('scroll'));

  // Bottom navigation: only when signed in and the screen wants it.
  const nav = document.getElementById('mainBottomNav');
  const showNav = auth.signedIn && screen.nav !== false;
  if (nav) {
    nav.parentElement.style.display = showNav ? '' : 'none';
    nav.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screen === (screen.tab ?? current.id)));
  }
  const statusBar = document.getElementById('phoneStatusBar');
  statusBar?.classList.toggle('light-text', Boolean(screen.dark));
  statusBar?.classList.toggle('dark-text', !screen.dark);
  setStatusBar(Boolean(screen.dark));
  // Banner ad on the reading screens only (screen.banner), above the bottom navigation.
  setBanner(Boolean(auth.signedIn && screen.banner), { adUnitId: state.config?.adUnits?.[platform]?.banner, testDevices: state.config?.admobTestDevices ?? [], margin: showNav ? 92 : 0 });

  const jumper = document.getElementById('screenJumperSelect');
  if (jumper && [...jumper.options].some((o) => o.value === current.id)) jumper.value = current.id;

  if (fresh && screen.load) {
    Promise.resolve(screen.load(ctx)).catch(() => undefined);
  }
}

// Re-render the visible screen when data it depends on arrives — unless the
// user is typing into a form on it.
subscribe((keys) => {
  const screen = screens[current.id];
  if (!screen?.keys?.some((k) => keys.includes(k))) return;
  if (screen.static && renderedDirty) return;
  const active = document.activeElement;
  if (active && container()?.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  render({ fresh: false });
});

// ── live values (balance, today, countdown) ───────────────────────────────
let lastCountdownRefresh = 0;
setInterval(() => {
  if (!state.status) return;
  const c = container();
  if (!c) return;
  // Not while the Home list is scrolling: those frames belong to the scroll.
  if (c.querySelector('.home-hero.is-scrolling')) return;
  c.querySelectorAll('[data-live="balance"]').forEach((e) => (e.innerHTML = liveBalanceHtml()));
  c.querySelectorAll('[data-live="balance-sub"]').forEach((e) => (e.textContent = moneySub(liveBalanceMsat())));
  c.querySelectorAll('[data-live="today"]').forEach((e) => (e.textContent = liveSmallText(liveTodayMsat())));
  c.querySelectorAll('[data-live="countdown"]').forEach((e) => (e.textContent = countdownText()));
  document.querySelectorAll('[data-until]').forEach((e) => (e.textContent = fmtCountdown(Date.parse(e.dataset.until) - Date.now())));
  // Midnight passed: claims reset, fetch the new day's status once.
  if (Date.parse(state.status.nextMidnight) <= Date.now() && Date.now() - lastCountdownRefresh > 60_000) {
    lastCountdownRefresh = Date.now();
    refresh('status', 'daily');
  }
}, 100);

// ── events ────────────────────────────────────────────────────────────────
async function runAction(name, el) {
  const fn = actions[name];
  if (!fn) return;
  const button = el.tagName === 'BUTTON' ? el : null;
  try {
    if (button && !button.classList.contains('star-favorite-btn') && !el.dataset.noBusy) await busy(button, () => fn(el, ctx));
    else await fn(el, ctx);
  } catch (err) {
    toast(err instanceof ApiError ? err.message : err?.message || 'Something went wrong. Please try again.', 'error');
  }
}

Object.assign(actions, {
  reload() {
    render({ fresh: true });
  },
  'cycle-unit'() {
    const u = cycleUnit();
    toast(`Showing balances in ${u === 'sats' ? 'sats' : u === 'btc' ? 'BTC' : 'USD'}`);
    render({ fresh: false });
  },
  'toggle-balance'() {
    const hidden = toggleBalanceHidden();
    toast(hidden ? 'Balances hidden' : 'Balances visible');
    render({ fresh: false });
  },
  'close-and-go'(el) {
    closeSheet();
    ctx.go(el.dataset.to);
  },
  more() {
    const item = (to, icon, label) => `<div class="grouped-list-item" data-act="close-and-go" data-to="${to}"><div class="grouped-item-left"><div class="grouped-item-icon">${icon}</div><span class="grouped-item-title">${label}</span></div></div>`;
    openSheet('More', `<div class="grouped-list-section">
      ${item('rewards', icons.gift, 'Invite friends')}${item('transactions', icons.list, 'Transactions')}${item('academy', icons.play, 'Academy')}
      ${item('news', icons.trend, 'News')}${item('support', icons.help, 'Help & Support')}${item('faq', icons.question, 'FAQ')}</div>`);
  },
  'open-store'() {
    const urls = state.config?.storeUrls ?? {};
    const url = platform === 'ios' ? urls.ios : urls.android;
    if (url) openUrl(url);
  },
});

function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const backBtn = t.closest('.back-btn-circle');
    if (backBtn) return ctx.back();

    const navItem = t.closest('.nav-item[data-screen]');
    if (navItem) {
      const tab = navItem.dataset.screen;
      history = [];
      current = { id: 'home', params: {} };
      return tab === 'home' ? render({ fresh: true }) : ctx.go(tab);
    }

    const act = t.closest('[data-act]');
    if (act && !act.disabled) {
      e.preventDefault();
      return runAction(act.dataset.act, act);
    }

    const go = t.closest('[data-go]');
    if (go) {
      closeSheet();
      return ctx.go(go.dataset.go, go.dataset.id ? { id: go.dataset.id } : {}, { replace: go.dataset.replace === '1' });
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form];
    if (!fn) return;
    showFieldError(form, '');
    const button = form.querySelector('button[type="submit"]');
    try {
      await busy(button, () => fn(form, formData(form), ctx));
    } catch (err) {
      showFieldError(form, err instanceof ApiError ? err.message : err?.message || 'Something went wrong. Please try again.');
    }
  });

  document.addEventListener('input', (e) => {
    if (container()?.contains(e.target)) renderedDirty = true;
  });

  document.addEventListener('change', (e) => {
    const pref = e.target.closest('input[data-pref]');
    if (pref) runAction('pref', pref);
  });

  document.getElementById('sheetBackdrop')?.addEventListener('click', closeSheet);
  document.getElementById('sheetCloseBtn')?.addEventListener('click', closeSheet);
  document.getElementById('sheetDragHandle')?.addEventListener('click', closeSheet);

  // Desktop simulator controls.
  document.getElementById('btnModeSingle')?.addEventListener('click', () => switchViewMode('single'));
  document.getElementById('btnModeGallery')?.addEventListener('click', () => switchViewMode('gallery'));
  document.getElementById('screenJumperSelect')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (['miner-details', 'lesson', 'ticket'].includes(id)) {
      const first = id === 'miner-details' ? state.miners?.[0]?.id : id === 'lesson' ? state.lessons?.[0]?.slug : state.tickets?.[0]?.id;
      if (!first) return toast('Nothing to show here yet.', 'error');
      ctx.go(id, { id: first });
    } else ctx.go(id);
    switchViewMode('single');
  });

  onBackButton(() => ctx.back());
  onResume(() => {
    if (auth.signedIn) refresh('status', 'wallet', 'notifications');
  });
  onPushTap((data) => {
    if (!auth.signedIn) return;
    if (data.ticketId) ctx.go('ticket', { id: data.ticketId });
    else if (data.withdrawalId) ctx.go('wallet');
    else if (data.minerId) ctx.go('miner-details', { id: data.minerId });
    else ctx.go('notifications');
  });

  // Session ended elsewhere (refresh token expired or revoked).
  auth.onChange((signedIn) => {
    if (!signedIn && !AUTH_SCREENS.has(current.id)) {
      stopPolling();
      reset();
      history = [];
      current = { id: 'signin', params: {} };
      render({ fresh: true });
      toast('Your session has ended. Please sign in again.', 'error');
    }
  });
}

// ── gallery view (desktop design review) ─────────────────────────────────
function switchViewMode(mode) {
  const single = document.getElementById('singleSimulatorStage');
  const gallery = document.getElementById('multiGalleryStage');
  if (!single || !gallery) return;
  document.getElementById('btnModeSingle')?.classList.toggle('active', mode === 'single');
  document.getElementById('btnModeGallery')?.classList.toggle('active', mode === 'gallery');
  single.style.display = mode === 'single' ? 'flex' : 'none';
  gallery.classList.toggle('active', mode === 'gallery');
  if (mode === 'gallery') renderGallery();
}

function renderGallery() {
  const grid = document.getElementById('screensGridContainer');
  if (!grid) return;
  const list = auth.signedIn
    ? ['home', 'wallet', 'miners', 'market', 'profile', 'mining', 'store', 'rewards', 'news', 'academy', 'notifications', 'settings']
    : ['welcome', 'signin', 'signup', 'forgot'];
  const saved = current;
  grid.innerHTML = list
    .map((id, i) => {
      current = { id, params: {} };
      const s = screens[id];
      const body = s.render(ctx);
      return `
      <div class="gallery-screen-card">
        <div class="gallery-screen-title"><span class="screen-num-pill">${i + 1}</span><span>${id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}</span></div>
        <div class="gallery-phone-frame" data-gallery-jump="${id}">
          <div class="phone-screen-inner" style="position: relative;">${body}<div class="phone-home-indicator"></div></div>
        </div>
      </div>`;
    })
    .join('');
  current = saved;
  grid.querySelectorAll('[data-gallery-jump]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.go(el.dataset.galleryJump);
      switchViewMode('single');
    }),
  );
}

// ── start ─────────────────────────────────────────────────────────────────
function versionBelow(v, min) {
  const a = String(v).split('.').map(Number);
  const b = String(min || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

/**
 * Subscribed miners renew in the store; the server normally hears about it from the
 * store's webhook. As a safety net, anyone who has had a paid miner asks the server
 * to check once a day, so a missed notification can't leave a paid month ungranted.
 */
function syncSubscriptions() {
  if (!(state.miners ?? []).some((m) => m.source === 'paid')) return;
  const today = new Date().toDateString();
  try {
    if (localStorage.getItem('bitmine.storeSync') === today) return;
    localStorage.setItem('bitmine.storeSync', today);
  } catch {
    return;
  }
  post('/v1/store/sync')
    .then((r) => r.granted?.length && refresh('status', 'miners'))
    .catch(() => undefined);
}

let registeredPushToken = null;
async function afterSignIn() {
  await bootstrap();
  startPolling();
  if (isNative) {
    syncSubscriptions();
    const token = await pushToken();
    if (token && token !== registeredPushToken) {
      await post('/v1/push-tokens', { token, platform }).catch(() => undefined);
      registeredPushToken = token;
    }
  }
}

async function start() {
  bindEvents();
  refresh('config').then(() => {
    const min = state.config?.minVersion?.[platform === 'ios' ? 'ios' : 'android'];
    if (isNative && min && versionBelow(config.appVersion, min)) {
      history = [];
      current = { id: 'update', params: {} };
      render({ fresh: true });
    }
  });
  if (auth.signedIn) {
    state.me = auth.user;
    current = { id: 'home', params: {} };
    render({ fresh: true });
    await afterSignIn();
  } else {
    current = { id: 'welcome', params: {} };
    render({ fresh: true });
  }
}

document.addEventListener('DOMContentLoaded', start);
window.bitmineApp = { ctx, state };
