/* ==========================================================================
   MINING — Boost (Start mining + claims), My Miners, Miner Details, Store.
   Claims: the server creates a claim, the phone shows a rewarded ad tagged
   with it, and Google confirms to our server. Purchases: the store sells,
   RevenueCat confirms, the server grants. The app never grants anything.
   ========================================================================== */

import { get, post, ApiError } from '../api.js';
import { esc, header, skeleton, errorCard, emptyState, toast, openSheet, closeSheet } from '../ui.js';
import { icons } from '../icons.js';
import { state, refresh, loadKeyed } from '../store.js';
import { fmtHash, fmtSats, fmtSatsAuto, fmtUsd, fmtDate } from '../format.js';
import { config } from '../config.js';
import { isNative, platform, showRewardedAd, buyProduct, storePrices } from '../native.js';
import { claimTracksHTML, countdownText, minerCard, minerStatus, minerDays } from './parts.js';
import { btcUsd } from '../store.js';

// ── Boost ─────────────────────────────────────────────────────────────────
function boostScreen() {
  const s = state.status;
  if (!s) return `${header('Boost')}<div class="screen-content-padding">${state.errors.status ? errorCard(state.errors.status, 'reload') : skeleton(4)}</div>`;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Boost')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="miner-hero-showcase" style="padding: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span class="badge-status ${s.session ? 'active' : 'inactive'}"><span class="dot"></span> ${s.session ? 'Session active' : 'Not started today'}</span>
            <span class="reset-chip" style="background: rgba(255,255,255,0.12); color: #fff; border-color: rgba(255,255,255,0.2);">${icons.clock}<span data-live="countdown">${countdownText()}</span></span>
          </div>
          <div style="margin-top: 14px; text-align: center;">
            <p style="font-size: 12px; color: rgba(255,255,255,0.7); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px;">Total hashrate</p>
            <h3 style="font-size: 30px; font-weight: 800; margin-top: 4px;" class="live-gh">${fmtHash(s.gh.total)}</h3>
            <p style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">≈ <span data-live="per-day">${fmtSatsAuto(s.msatPerSecond * 86_400)}</span> per day at this rate</p>
          </div>
          ${s.session ? '' : `<button class="btn-white" style="margin-top: 14px; width: 100%; padding: 11px;" data-act="start-mining">Start mining</button>`}
        </div>

        <div class="stat-mini-row">
          <div class="stat-mini"><span>Paid miners</span><strong>${fmtHash(s.gh.paid)}</strong></div>
          <div class="stat-mini"><span>Free claims</span><strong>${fmtHash(s.gh.claim)}</strong></div>
          <div class="stat-mini"><span>Super Miner</span><strong>${fmtHash(s.gh.super)}</strong></div>
        </div>

        <div class="section-header-row"><span class="section-title">Claim tracks</span><span class="section-link" data-go="store">Get more</span></div>
        <div class="stack">${claimTracksHTML({ includeLocked: true })}</div>
        <p class="muted-note">Each claim plays a short video. Claimed hashpower mines until midnight in your time zone (${esc(state.me?.timezone ?? '')}), so claiming earlier earns more.</p>
      </div>
    </div>`;
}

// ── My Miners ─────────────────────────────────────────────────────────────
let minersFilter = 'all';

function minersScreen() {
  const miners = state.miners;
  const active = (miners ?? []).filter((m) => m.status === 'active');
  const ended = (miners ?? []).filter((m) => m.status !== 'active');
  const shown = minersFilter === 'active' ? active : minersFilter === 'inactive' ? ended : miners ?? [];
  const s = state.status;
  return `
    <div class="screen-scroll-view animate-fade-up">
      <div class="screen-header">
        <h2 class="screen-title">My Miners</h2>
        <button class="btn-primary" style="padding: 6px 14px; font-size: 12px;" data-go="store">+ Add Miner</button>
      </div>
      <div class="screen-content-padding" style="gap: 14px;">
        ${s ? `
        <div class="bm-card" data-go="mining" style="padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="icon-box-purple">${icons.bolt}</div>
            <div><h4 style="font-size: 14px; font-weight: 800;">Today's claims</h4><p style="font-size: 12px; color: var(--text-secondary);">${fmtHash(s.gh.claim + s.gh.super)} from ${s.claims.used + s.superTiers.reduce((n, t) => n + t.used, 0)} claims · resets in <span data-live="countdown">${countdownText()}</span></p></div>
          </div>
          <div style="color: var(--color-primary-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
        </div>` : ''}

        <div class="filter-pills-row">
          <button class="filter-pill ${minersFilter === 'all' ? 'active' : ''}" data-act="miners-filter" data-filter="all">All (${miners?.length ?? 0})</button>
          <button class="filter-pill ${minersFilter === 'active' ? 'active' : ''}" data-act="miners-filter" data-filter="active">Active (${active.length})</button>
          <button class="filter-pill ${minersFilter === 'inactive' ? 'active' : ''}" data-act="miners-filter" data-filter="inactive">Ended (${ended.length})</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          ${miners == null
            ? state.errors.miners ? errorCard(state.errors.miners, 'reload') : skeleton(4)
            : shown.length
              ? shown.map((m) => minerCard(m)).join('')
              : emptyState(miners.length ? 'Nothing here' : 'No paid miners yet', miners.length ? 'No miners match this filter.' : `Paid miners add hashpower around the clock for ${minerDays()} days, no claiming needed.`, `<button class="btn-primary" data-go="store">Browse miners</button>`)}
        </div>
      </div>
    </div>`;
}

// ── Miner Details ─────────────────────────────────────────────────────────
function minerDetailsScreen(ctx) {
  const d = state.minerDetail[ctx.params.id];
  const err = state.errors[`minerDetail:${ctx.params.id}`];
  if (!d) return `<div class="screen-scroll-view">${header('Miner Details')}<div class="screen-content-padding">${err ? errorCard(err) : skeleton(5)}</div></div>`;
  const pct = Math.round(d.progress * 100);
  // This miner's own length (older ones were sold with a different one), and what a renewal gives today.
  const days = Math.round((Date.parse(d.endAt) - Date.parse(d.startAt)) / 86_400_000);
  const canRenew = d.source === 'paid' && d.product?.sku && d.status !== 'revoked';
  const renewDays = canRenew ? minerDays(d.product.sku) : 0;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Miner Details')}
      <div class="screen-content-padding" style="gap: 16px;">
        <div class="miner-hero-showcase">
          <div class="miner-showcase-rig"><img src="./assets/images/miner_rig_3d.jpg" alt=""/></div>
          <div style="margin-top: 10px;">
            <div style="margin-bottom: 8px;">${minerStatus(d)}</div>
            <h3 style="font-size: 20px; font-weight: 800;">${esc(d.product?.name ?? 'Miner')}</h3>
            <p style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">${d.status === 'active' ? 'Mining 24/7. Earnings are credited every hour.' : d.status === 'revoked' ? 'This miner stopped when its purchase was refunded.' : `This miner has completed its ${days} days.`}</p>
          </div>
        </div>

        <div class="miner-details-grid">
          <div class="bm-stat-card"><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Hashrate</span><strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">${fmtHash(d.gh)}</strong></div>
          <div class="bm-stat-card"><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Per day</span><strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">${fmtSats(d.status === 'active' ? d.msatPerDay : 0)}</strong></div>
          <div class="bm-stat-card"><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Mined so far</span><strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">${fmtSats(d.earnedMsat)}</strong></div>
          <div class="bm-stat-card"><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Time left</span><strong style="font-size: 18px; font-weight: 800; color: ${d.status === 'active' ? 'var(--color-success)' : 'var(--text-secondary)'};">${d.status === 'active' ? `${d.daysLeft} days` : '—'}</strong></div>
        </div>

        <div class="bm-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="text-sm font-semibold text-primary">Mining period</span><span class="text-sm font-bold text-purple">${pct}%</span>
          </div>
          <div class="bm-progress-track"><div class="bm-progress-fill" style="width: ${pct}%;"></div></div>
          <div class="miner-payout-info" style="margin-top: 8px;"><span>${fmtDate(d.startAt)} → ${fmtDate(d.endAt)}</span><span>Total: <strong>${fmtSats(d.expectedTotalMsat)}</strong></span></div>
        </div>

        <div class="bm-card"><div class="info-rows">
          <div class="info-row"><span>Mined so far (USD)</span><strong>${fmtUsd(d.earnedMsat, btcUsd())}</strong></div>
          <div class="info-row"><span>Expected over ${days} days</span><strong>${fmtSats(d.expectedTotalMsat)}</strong></div>
          <div class="info-row"><span>Started</span><strong>${fmtDate(d.startAt)}</strong></div>
          <div class="info-row"><span>Ends</span><strong>${fmtDate(d.endAt)}</strong></div>
        </div></div>
        ${canRenew ? `
        <button class="btn-primary btn-block" data-act="buy" data-sku="${esc(d.product.sku)}">Renew ${esc(d.product.name)} · ${renewDays} days</button>
        <p class="muted-note">Renewing starts a fresh ${esc(d.product.name)} today for ${renewDays} days.${d.status === 'active' ? ' Until this one ends, both mine together.' : ''}</p>` : ''}
        <p class="muted-note">Estimates use today's mining rate. Figures in sats are what you receive; USD values move with the Bitcoin price.</p>
      </div>
    </div>`;
}

// ── Store ─────────────────────────────────────────────────────────────────
function priceOf(p) {
  const id = platform === 'ios' ? p.storeIds?.apple : p.storeIds?.google;
  return state.prices[id] ?? `$${p.priceDisplayUsd.toFixed(2)}`;
}

function storeScreen() {
  const products = state.products;
  const owned = new Map((state.status?.superTiers ?? []).map((t) => [t.sku, t]));
  const rate = state.config?.economics?.rateMsatPerGhDay ?? 48; // estimate only; the server decides actual earnings
  const miners = (products ?? []).filter((p) => p.kind === 'miner');
  const supers = (products ?? []).filter((p) => p.kind === 'super_miner');
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Store')}
      <div class="screen-content-padding" style="gap: 14px;">
        ${products == null ? (state.errors.products ? errorCard(state.errors.products, 'reload') : skeleton(5)) : `
        <div class="section-header-row"><span class="section-title">Paid miners</span><span class="text-xs text-muted" style="font-weight: 600;">${minerDays()} days · 24/7 · renewable</span></div>
        ${miners.map((p, i) => `
          <div class="product-card ${i === miners.length - 1 ? 'featured' : ''}">
            <div class="product-head">
              <div style="display: flex; gap: 12px; align-items: center;">
                <div class="promo-miner-thumb" style="width: 48px; height: 48px;"><img src="./assets/images/miner_rig_3d.jpg" alt=""/></div>
                <div><h4>${esc(p.name)}</h4><p>${fmtHash(p.gh)} · mines around the clock</p></div>
              </div>
              <span class="product-price">${esc(priceOf(p))}</span>
            </div>
            <div class="product-facts">
              <span class="product-fact">≈ ${fmtSats(p.gh * rate)} / day</span>
              <span class="product-fact">${p.durationDays} days</span>
              <span class="product-fact">Stacks with other miners</span>
            </div>
            <button class="btn-primary btn-block" data-act="buy" data-sku="${esc(p.sku)}">Buy ${esc(p.name)}</button>
          </div>`).join('')}

        <div class="section-header-row" style="margin-top: 6px;"><span class="section-title">Super Miner</span><span class="text-xs text-muted" style="font-weight: 600;">Extra daily claims</span></div>
        ${supers.map((p) => {
          const o = owned.get(p.sku);
          return `
          <div class="product-card featured">
            <div class="product-head">
              <div style="display: flex; gap: 12px; align-items: center;">
                <div class="icon-box-purple">${icons.rocket}</div>
                <div><h4>${esc(p.name)}</h4><p>${p.claimsPerDay} claims a day × ${fmtHash(p.claimGh)}</p></div>
              </div>
              <span class="product-price">${esc(priceOf(p))}</span>
            </div>
            <div class="product-facts">
              <span class="product-fact">Up to ${fmtHash(p.maxGhPerDay)} a day</span>
              <span class="product-fact">${p.durationDays} days</span>
              ${o ? `<span class="owned-chip">Active until ${fmtDate(o.activeUntil)}</span>` : ''}
            </div>
            <button class="btn-primary btn-block" data-act="buy" data-sku="${esc(p.sku)}">${o ? `Extend ${p.durationDays} days` : `Unlock ${esc(p.name)}`}</button>
          </div>`;
        }).join('')}

        <button class="btn-soft btn-block" data-act="restore-purchases">Restore purchases</button>
        <p class="muted-note">Earnings shown are estimates at today's mining rate and are paid in sats. Purchases are processed by ${platform === 'ios' ? 'the App Store' : 'Google Play'} and confirmed by our server before anything is added.</p>`}
      </div>
    </div>`;
}

export const screens = {
  mining: { tab: 'home', keys: ['status', 'products', 'me'], load: (ctx) => ctx.ensure('products'), render: boostScreen },
  miners: { tab: 'miners', keys: ['miners', 'status', 'products'], load: (ctx) => { ctx.ensure('products'); return ctx.refresh('miners'); }, render: minersScreen },
  'miner-details': {
    tab: 'miners',
    dark: false,
    keys: ['minerDetail', 'products'],
    load: (ctx) => { ctx.ensure('products'); return loadKeyed('minerDetail', ctx.params.id); },
    render: minerDetailsScreen,
  },
  store: {
    tab: 'home',
    keys: ['products', 'status', 'prices'],
    load: async (ctx) => {
      await ctx.ensure('products');
      if (isNative && state.products && state.me) {
        const ids = state.products.map((p) => (platform === 'ios' ? p.storeIds?.apple : p.storeIds?.google)).filter(Boolean);
        state.prices = await storePrices(state.me.id, ids);
        ctx.rerender();
      }
    },
    render: storeScreen,
  },
};

// ── actions ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForClaim(claimId) {
  for (let i = 0; i < 12; i++) {
    const c = await get(`/v1/claims/${claimId}`);
    if (c.status !== 'pending') return c.status;
    await sleep(1000);
  }
  return 'pending';
}

export const actions = {
  async 'start-mining'() {
    await post('/v1/mining/start');
    await refresh('status');
    toast('Mining started. Your claims are unlocked until midnight.');
  },

  async claim(el) {
    const kind = el.dataset.kind;
    const tier = el.dataset.tier;
    const intent = await post('/v1/claims', kind === 'super' ? { kind, tier } : { kind });

    // A claim that doesn't end in a watched ad is handed back, so it doesn't
    // block the user's next attempt (the server allows 3 open claims).
    const giveBack = () => post(`/v1/claims/${intent.claimId}/cancel`).catch(() => undefined);

    if (isNative) {
      const adUnitId = state.config?.adUnits?.[platform]?.rewarded;
      if (!adUnitId) {
        await giveBack();
        throw new ApiError(0, 'ads_unavailable', 'Videos are unavailable right now. Please try again later.');
      }
      let watched = false;
      try {
        watched = await showRewardedAd({ adUnitId, userId: state.me.id, claimId: intent.claimId, testDevices: state.config?.admobTestDevices ?? [] });
      } catch (err) {
        await giveBack();
        throw new ApiError(0, 'ad_failed', 'No video is available right now. Please try again in a moment.');
      }
      if (!watched) {
        await giveBack();
        return toast('Watch the whole video to claim.', 'error');
      }
      // Development phone builds: Google's callback can't reach a PC on the local
      // network, so the dev shortcut confirms the watched ad instead.
      if (config.devShortcuts) await post(`/v1/dev/claims/${intent.claimId}/complete`).catch(() => undefined);
    } else if (config.devShortcuts) {
      openSheet('Test video', `<div class="stack text-center"><div class="bm-spinner" style="margin: 10px auto; border-color: var(--color-lavender-border); border-top-color: var(--color-primary-purple); width: 28px; height: 28px;"></div><p class="bm-hint">Browser test mode: simulating a finished rewarded video.</p></div>`);
      await sleep(1200);
      closeSheet();
      await post(`/v1/dev/claims/${intent.claimId}/complete`);
    } else {
      return toast('Claims work in the BitMine phone app.', 'error');
    }

    const status = await waitForClaim(intent.claimId);
    await refresh('status');
    if (status === 'verified') toast(`+${intent.gh} GH/s added until midnight.`);
    else if (status === 'pending') toast("Still confirming your video. It'll appear in a moment.");
    else toast("That video couldn't be confirmed. Please try again.", 'error');
  },

  'miners-filter'(el, ctx) {
    minersFilter = el.dataset.filter;
    ctx.rerender();
  },

  async buy(el, ctx) {
    if (!state.products) await ctx.ensure('products');
    const product = state.products?.find((p) => p.sku === el.dataset.sku);
    if (!product) return;
    if (isNative) {
      const storeId = platform === 'ios' ? product.storeIds?.apple : product.storeIds?.google;
      const done = await buyProduct(state.me.id, storeId);
      if (!done) return;
      const r = await post('/v1/store/sync');
      await refresh('status', 'miners', 'products');
      toast(r.granted?.length ? `${product.name} is active. Happy mining!` : "Purchase received. It'll appear within a few minutes.");
    } else if (config.devShortcuts) {
      await post('/v1/dev/purchase', { sku: product.sku });
      await refresh('status', 'miners');
      toast(`${product.name} added (browser test mode).`);
    } else {
      toast('Purchases work in the BitMine phone app.', 'error');
    }
  },

  async 'restore-purchases'() {
    if (!isNative) return toast('Restoring purchases works in the phone app.', 'error');
    const r = await post('/v1/store/sync');
    await refresh('status', 'miners');
    toast(r.granted?.length ? `Restored ${r.granted.length} purchase(s).` : 'Everything is already up to date.');
  },
};
