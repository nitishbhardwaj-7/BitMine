/* ==========================================================================
   STORE — the app's live data. Screens read from `state`; loaders fetch from
   the API, de-duplicate concurrent requests and notify subscribers.
   Mining status is polled every 30 s while the app is open, and the balance
   is animated between polls from the server's msat-per-second rate.
   ========================================================================== */

import { get, publicApi, ApiError } from './api.js';

export const state = {
  me: null,
  config: null,
  status: null,       // /v1/mining/status
  statusAt: 0,        // local time the status arrived
  wallet: null,
  miners: null,
  minerDetail: {},    // id → detail
  market: null,
  daily: null,
  referrals: null,
  notifications: null,
  products: null,
  prices: {},         // store product id → localised price (native only)
  purchases: null,
  withdrawals: null,
  ledger: null,
  tickets: null,
  ticket: {},         // id → ticket
  faqs: null,
  news: {},           // category ('ALL', 'BITCOIN'…) → articles
  lessons: null,
  lesson: {},         // slug → lesson
  errors: {},         // key → message of the last failed load
};

const loaders = {
  me: () => get('/v1/me'),
  config: () => publicApi('GET', '/v1/public/config'),
  status: () => get('/v1/mining/status'),
  wallet: () => get('/v1/wallet'),
  miners: async () => (await get('/v1/miners')).miners,
  market: () => publicApi('GET', '/v1/public/market'),
  daily: async () => (await get('/v1/wallet/daily?days=14')).days,
  referrals: () => get('/v1/referrals'),
  notifications: () => get('/v1/notifications'),
  products: async () => (await get('/v1/store/products')).products,
  purchases: async () => (await get('/v1/store/purchases')).purchases,
  withdrawals: async () => (await get('/v1/withdrawals')).withdrawals,
  ledger: () => get('/v1/wallet/ledger'),
  tickets: async () => (await get('/v1/support/tickets')).tickets,
  faqs: async () => (await publicApi('GET', '/v1/public/faqs')).faqs,
  lessons: async () => (await publicApi('GET', '/v1/public/academy')).lessons,
};

const inflight = new Map();
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

let notifyQueued = false;
function notify(keys) {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    subscribers.forEach((fn) => fn(keys));
  });
}

/** Loads one key (or returns the running request for it). */
export function load(key) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await loaders[key]();
      state[key] = value;
      if (key === 'status') state.statusAt = Date.now();
      delete state.errors[key];
      return value;
    } catch (err) {
      state.errors[key] = err instanceof ApiError ? err.message : 'Something went wrong.';
      throw err;
    } finally {
      inflight.delete(key);
      notify([key]);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Loads several keys; failures are recorded in state.errors, not thrown. */
export function refresh(...keys) {
  return Promise.allSettled(keys.map(load));
}

/** Loads `key` only if it hasn't been loaded yet. */
export function ensure(key) {
  return state[key] == null && !state.errors[key] ? load(key).catch(() => undefined) : Promise.resolve(state[key]);
}

export async function loadKeyed(kind, id) {
  const cacheKey = `${kind}:${id}`;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const url = {
    minerDetail: `/v1/miners/${encodeURIComponent(id)}`,
    ticket: `/v1/support/tickets/${encodeURIComponent(id)}`,
    lesson: `/v1/public/academy/${encodeURIComponent(id)}`,
    news: `/v1/public/news${id === 'ALL' ? '' : `?category=${encodeURIComponent(id)}`}`,
  }[kind];
  const p = (async () => {
    try {
      const data = kind === 'lesson' || kind === 'news' ? await publicApi('GET', url) : await get(url);
      state[kind][id] = kind === 'news' ? data.articles : data;
      delete state.errors[cacheKey];
    } catch (err) {
      state.errors[cacheKey] = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      inflight.delete(cacheKey);
      notify([kind]);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}

/** Everything the main tabs need right after sign-in. */
export function bootstrap() {
  return refresh('me', 'config', 'status', 'wallet', 'market', 'miners', 'daily', 'referrals', 'notifications', 'products');
}

export function reset() {
  for (const k of Object.keys(state)) {
    state[k] = ['minerDetail', 'ticket', 'news', 'lesson', 'prices', 'errors'].includes(k) ? {} : k === 'statusAt' ? 0 : null;
  }
}

// ── live balance ──────────────────────────────────────────────────────────
/** Balance right now: last server value plus what's been mined since (msat). */
export function liveBalanceMsat() {
  const s = state.status;
  if (!s) return 0;
  return s.balance.displayMsat + ((Date.now() - state.statusAt) / 1000) * s.msatPerSecond;
}

/** Mined today (credited + still unsettled), estimated live. */
export function liveTodayMsat() {
  const today = new Date().toISOString().slice(0, 10);
  const day = state.daily?.find((d) => d.date === today);
  const credited = day ? day.miningMsat + day.referralMsat : 0;
  const s = state.status;
  const unsettled = s ? s.balance.unsettledMsat + ((Date.now() - state.statusAt) / 1000) * s.msatPerSecond : 0;
  return credited + unsettled;
}

export const btcUsd = () => state.market?.btcUsd ?? null;

let pollTimer;
export function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh('status');
  }, 30_000);
}
export function stopPolling() {
  clearInterval(pollTimer);
}
