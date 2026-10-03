/* ==========================================================================
   SHARED PIECES — markup reused by several screens, built on the
   prototype's classes so every screen looks the same.
   ========================================================================== */

import { esc, emptyState } from '../ui.js';
import { icons } from '../icons.js';
import { state, btcUsd, liveBalanceMsat } from '../store.js';
import { platform } from '../native.js';
import { fmtSats, fmtSatsPrecise, fmtUsd, fmtBtc, fmtBtcParts, fmtHash, fmtPrice, fmtPct, fmtDay, fmtCountdown, timeAgo } from '../format.js';

// ── balance units (BTC / sats / USD), remembered on the device ────────────
// BTC is the default: it's what people recognise, and the live counter shows
// the extra digits ticking. Tapping the balance switches to sats, then USD.
const UNIT_KEY = 'bitmine.unit';
export function unit() {
  try {
    return localStorage.getItem(UNIT_KEY) || 'btc';
  } catch {
    return 'btc';
  }
}
export function cycleUnit() {
  const next = { btc: 'sats', sats: 'usd', usd: 'btc' }[unit()] ?? 'btc';
  try {
    localStorage.setItem(UNIT_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
export function money(msat, u = unit()) {
  if (u === 'usd') return fmtUsd(msat, btcUsd());
  if (u === 'btc') return fmtBtc(msat);
  return fmtSats(msat);
}
/** The "other" representation shown under a balance. */
export function moneySub(msat, u = unit()) {
  return u === 'usd' ? `≈ ${fmtSats(msat)}` : `≈ ${fmtUsd(msat, btcUsd())}`;
}

// ── balance privacy (eye toggle), remembered on the device ────────────────
const HIDE_KEY = 'bitmine.hideBalance';
export const balanceHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};
export function toggleBalanceHidden() {
  const v = !balanceHidden();
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
  return v;
}
/** Live balance as text (used where markup isn't possible). */
export const liveBalanceText = () => {
  if (balanceHidden()) return '••••••••';
  const msat = liveBalanceMsat();
  return unit() === 'sats' ? fmtSatsPrecise(msat) : unit() === 'btc' ? fmtBtc(msat, 12) : money(msat);
};

/**
 * Live balance as markup: in BTC, 8 normal decimals plus 4 smaller "micro"
 * digits that tick in real time with the hashrate (1 msat = 0.00000000001 BTC).
 */
export function liveBalanceHtml() {
  if (balanceHidden()) return '••••••••';
  const msat = liveBalanceMsat();
  const u = unit();
  if (u === 'btc') {
    const { main, micro } = fmtBtcParts(msat);
    return `<span class="bal-main">${main}</span><span class="bal-micro">${micro}</span><span class="bal-unit">BTC</span>`;
  }
  return `<span class="bal-main">${u === 'sats' ? fmtSatsPrecise(msat) : money(msat)}</span>`;
}

/** A small live amount (e.g. "today") in the chosen unit. */
export function liveSmallText(msat) {
  const u = unit();
  if (u === 'btc') return fmtBtc(msat, 10);
  if (u === 'usd') return fmtUsd(msat, btcUsd());
  return fmtSatsPrecise(msat);
}

// ── coins ─────────────────────────────────────────────────────────────────
const COINS = {
  bitcoin: { color: '#F7931A', glyph: '₿' },
  ethereum: { color: '#627EEA', glyph: 'Ξ' },
  solana: { color: '#14F195', glyph: 'S', dark: true },
  tether: { color: '#26A17B', glyph: '₮' },
  binancecoin: { color: '#F3BA2F', glyph: 'B', dark: true },
  ripple: { color: '#23292F', glyph: 'X' },
  cardano: { color: '#0033AD', glyph: 'A' },
  dogecoin: { color: '#C2A633', glyph: 'Ð', dark: true },
  tron: { color: '#EF0027', glyph: 'T' },
};
export const coinMeta = (id) => COINS[id] ?? { color: '#6D35F5', glyph: '•' };

export function coinBadge(coin, cls = 'asset-icon-circle', style = '') {
  const m = coinMeta(coin.id);
  return `<div class="${cls}" style="background: ${m.color}; ${m.dark ? 'color: #000;' : ''} ${style}">${m.glyph}</div>`;
}

export function sparkPath(points) {
  if (!points?.length) return 'M0,12 L48,12';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * 48).toFixed(1)},${(21 - ((p - min) / range) * 18).toFixed(1)}`)
    .join(' ');
}

export function tickerHTML() {
  const coins = state.market?.coins ?? [];
  if (!coins.length) return '';
  return `
    <div class="crypto-ticker-scroll">
      ${coins
        .filter((c) => c.id !== 'tether')
        .slice(0, 6)
        .map(
          (c) => `
        <div class="crypto-ticker-item" data-go="market">
          ${coinBadge(c, 'coin-mini-icon')}
          <span style="font-size: 12px; font-weight: 700;">${esc(c.symbol)}</span>
          <span style="font-size: 12px; font-weight: 700; color: #171622;">${fmtPrice(c.priceUsd)}</span>
          <span class="pct-pill ${c.change24h >= 0 ? 'gain' : 'loss'}" style="padding: 1px 5px; font-size: 10px;">${fmtPct(c.change24h)}</span>
        </div>`,
        )
        .join('')}
    </div>`;
}

// ── starting the day ──────────────────────────────────────────────────────
/** Start videos still owed today (0 when a tap is enough or the day is already on). */
export function startVideosLeft() {
  const s = state.status;
  if (!s?.dailyStartRequired) return 0;
  if (s.session) return s.session.active ? 0 : Math.max(0, s.session.adsRequired - s.session.adsWatched);
  // Per user: owners of a paid miner may start with one tap.
  return s.startAdsRequired ?? state.config?.economics?.startAds ?? 0;
}
/** One line explaining what Start does right now. */
export function startHint() {
  const s = state.status;
  if (!s?.dailyStartRequired) return `Unlock ${s?.claims.cap ?? 60} free claims until midnight.`;
  const n = startVideosLeft();
  if (n === 0) return 'Switch your miners on until midnight.';
  if (s.session?.adsWatched) return `${n} more video${n === 1 ? '' : 's'} to switch your miners on.`;
  return `Watch ${n} short video${n === 1 ? '' : 's'} to switch your miners on until midnight.`;
}
export const startLabel = () => (state.status?.session && !state.status.session.active && state.status.session.adsWatched ? 'Continue' : 'Start');

// ── miners ────────────────────────────────────────────────────────────────
/** How long a paid miner runs (from the catalog; 30 days unless an admin changes it). */
export const minerDays = (sku) =>
  (sku ? state.products?.find((p) => p.sku === sku) : state.products?.find((p) => p.kind === 'miner'))?.durationDays ?? 30;

export function minerStatus(m) {
  return m.status === 'active'
    ? `<span class="badge-status active"><span class="dot"></span> Active</span>`
    : m.status === 'revoked'
      ? `<span class="badge-status inactive"><span class="dot"></span> Refunded</span>`
      : `<span class="badge-status inactive"><span class="dot"></span> Ended</span>`;
}

export function minerCard(m, compact = false) {
  const start = Date.parse(m.startAt);
  const end = Date.parse(m.endAt);
  const pct = Math.round(Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) * 100);
  const name = m.product?.name ?? (m.source === 'admin_grant' ? 'Bonus miner' : 'Miner');
  const days = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
  // Renewing = buying the same pack again; offered when the miner has ended or is about to.
  const renew = m.source === 'paid' && m.product?.sku && m.status !== 'revoked' && (m.status !== 'active' || days <= 5);
  return `
    <div class="miner-card-item" data-go="miner-details" data-id="${esc(m.id)}" data-status="${m.status === 'active' ? 'active' : 'inactive'}" ${compact ? 'style="padding: 14px;"' : ''}>
      <div class="miner-card-header">
        <div class="miner-id-title">
          ${compact ? '' : `<div class="icon-box-purple sm">${icons.miner}</div>`}
          <div>
            <h4>${esc(name)}</h4>
            <p>${m.status === 'active' ? `${state.status?.dailyStartRequired ? (state.status.mining ? "Mining now" : "Not started today") : "Mining 24/7"} · ends ${new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `Ran ${new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</p>
          </div>
        </div>
        ${minerStatus(m)}
      </div>
      <div class="miner-body-grid">
        <div class="miner-chassis-preview" ${compact ? 'style="width: 88px; height: 76px;"' : ''}>
          <img src="./assets/images/miner_rig_3d.jpg" alt="" style="${m.status === 'active' ? '' : 'filter: grayscale(0.8) opacity(0.7);'}"/>
        </div>
        <div class="miner-stats-col">
          <div class="miner-stat-row">
            <div class="icon-box-purple sm" style="width: 26px; height: 26px; border-radius: 6px;">${icons.pulse}</div>
            <div class="miner-stat-text"><span>Hashrate</span><strong>${fmtHash(m.gh)}</strong></div>
          </div>
          <div class="miner-stat-row">
            <div class="icon-box-purple sm" style="width: 26px; height: 26px; border-radius: 6px;">${icons.clock}</div>
            <div class="miner-stat-text"><span>${m.status === 'active' ? 'Time left' : 'Status'}</span><strong>${m.status === 'active' ? `${days} day${days === 1 ? '' : 's'}` : m.status === 'revoked' ? 'Refunded' : 'Completed'}</strong></div>
          </div>
        </div>
      </div>
      ${m.status === 'active' ? `
        <div>
          <div class="bm-progress-track"><div class="bm-progress-fill" style="width: ${pct}%;"></div></div>
          <div class="miner-payout-info"><span>Paid out every hour</span><span style="font-weight: 700; color: var(--color-primary-purple);">${pct}% complete</span></div>
        </div>` : ''}
      ${renew ? `<button class="btn-soft btn-block" style="margin-top: 10px;" data-act="buy" data-sku="${esc(m.product.sku)}">${m.status === 'active' ? `Ends in ${days} day${days === 1 ? '' : 's'} · Renew` : `Renew ${esc(name)}`}</button>` : ''}
    </div>`;
}

// ── claims ────────────────────────────────────────────────────────────────
export function claimTrack({ title, sub, used, cap, gh, kind, tier, locked, sessionActive }) {
  const pct = cap ? Math.round((used / cap) * 100) : 0;
  const done = used >= cap;
  const disabled = locked || !sessionActive || done;
  const label = done ? 'All claimed' : !sessionActive ? 'Start first' : `Claim +${gh} GH/s`;
  return `
    <div class="claim-track ${locked ? 'locked' : ''}">
      <div class="claim-track-row">
        <div><div class="claim-track-title">${esc(title)}</div><div class="claim-track-sub">${esc(sub)}</div></div>
        <span class="claim-count">${used}/${cap}</span>
      </div>
      <div class="bm-progress-track" style="height: 6px;"><div class="bm-progress-fill" style="width: ${pct}%;"></div></div>
      <div class="claim-track-row">
        <span class="claim-track-sub">${fmtHash(used * gh)} of ${fmtHash(cap * gh)} today</span>
        ${locked
          ? `<button class="btn-soft claim-btn" data-go="store">Unlock</button>`
          : `<button class="btn-primary claim-btn" data-act="claim" data-kind="${kind}" ${tier ? `data-tier="${esc(tier)}"` : ''} ${disabled ? 'disabled' : ''}>${icons.bolt} ${label}</button>`}
      </div>
    </div>`;
}

export function claimTracksHTML({ includeLocked = false } = {}) {
  const s = state.status;
  if (!s) return '';
  const active = Boolean(s.session?.active);
  const tracks = [
    claimTrack({ title: 'Free claims', sub: `Watch a short video · +${s.claims.gh} GH/s until midnight`, used: s.claims.used, cap: s.claims.cap, gh: s.claims.gh, kind: 'regular', sessionActive: active }),
    ...s.superTiers.map((t) =>
      claimTrack({ title: t.name, sub: `Active until ${new Date(t.activeUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, used: t.used, cap: t.cap, gh: t.gh, kind: 'super', tier: t.sku, sessionActive: active }),
    ),
  ];
  if (includeLocked) {
    const owned = new Set(s.superTiers.map((t) => t.sku));
    for (const p of (state.products ?? []).filter((p) => p.kind === 'super_miner' && !owned.has(p.sku))) {
      tracks.push(claimTrack({ title: p.name, sub: `${p.claimsPerDay} claims a day · ${fmtHash(p.maxGhPerDay)} max`, used: 0, cap: p.claimsPerDay, gh: p.claimGh, locked: true }));
    }
  }
  return tracks.join('');
}

// ── Super Miner packs (extra daily claims, sold in the store) ─────────────
/** Store price when the phone has loaded it, else our list price. */
export function productPrice(p) {
  const id = platform === 'ios' ? p.storeIds?.apple : p.storeIds?.google;
  return state.prices?.[id] ?? `$${p.priceDisplayUsd.toFixed(2)}`;
}
const superPacks = () => (state.products ?? []).filter((p) => p.kind === 'super_miner');
const packLength = (days) => (days >= 365 ? `${Math.round(days / 365)} year${days >= 730 ? 's' : ''}` : `${days} days`);
/** The middle pack is the one we steer people to; the others get their own hook. */
const packTag = (i, n) => (n >= 3 && i === 1 ? 'Recommended deal' : i === 0 ? 'Best to start' : i === n - 1 ? 'Maximum power' : '');

/** Shown under the claim tracks once today's free claims are used up: the next pack to unlock. */
export function superUpsellHTML() {
  const s = state.status;
  if (!s || s.claims.used < s.claims.cap) return '';
  const owned = new Set(s.superTiers.map((t) => t.sku));
  const p = superPacks().find((x) => !owned.has(x.sku));
  if (!p) return '';
  return `
    <div class="super-upsell" data-go="store" data-id="super">
      <div class="super-upsell-icon">${icons.rocket}</div>
      <div class="super-upsell-text">
        <h4>${owned.size ? 'Want even more?' : 'Free claims done. Keep going!'}</h4>
        <p>Claim +${p.claimGh} GH/s <strong>${p.claimsPerDay} more times</strong> every day with ${esc(p.name)}, just <strong>${esc(productPrice(p))}</strong>.</p>
      </div>
      <button class="btn-white claim-btn">${icons.bolt} Claim +${p.claimGh} GH/s</button>
    </div>`;
}

/** Home row of Super Miner packs; every card leads to the store's Super Miner section. */
export function superPacksHTML() {
  const packs = superPacks();
  if (!packs.length) return '';
  const owned = new Map((state.status?.superTiers ?? []).map((t) => [t.sku, t]));
  return `
    <div>
      <div class="section-header-row"><span class="section-title">Super Miner</span><span class="section-link" data-go="store" data-id="super">See packs</span></div>
      <div class="super-pack-row">
        ${packs.map((p, i) => `
          <div class="super-pack tone-${i % 3} ${packs.length >= 3 && i === 1 ? 'recommended' : ''}" data-go="store" data-id="super">
            <div class="super-pack-top">
              <div class="super-pack-icon">${icons.rocket}</div>
              ${owned.has(p.sku) ? '<span class="super-pack-tag">Active</span>' : packTag(i, packs.length) ? `<span class="super-pack-tag ${i === 1 ? 'hot' : ''}">${packTag(i, packs.length)}</span>` : ''}
            </div>
            <h4>${esc(p.name)}</h4>
            <div class="super-pack-big"><small>Up to</small> ${fmtHash(p.maxGhPerDay)} <small>daily</small></div>
            <div class="super-pack-length">for ${packLength(p.durationDays)}</div>
            <p>${p.claimsPerDay} extra claims every day · +${p.claimGh} GH/s each</p>
            <div class="super-pack-foot">
              <span class="super-pack-price">${esc(productPrice(p))}<small> / ${packLength(p.durationDays)}</small></span>
              <button class="btn-white claim-btn">${icons.bolt} Claim</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

export function countdownText() {
  const s = state.status;
  return s ? fmtCountdown(Date.parse(s.nextMidnight) - Date.now()) : '–';
}

// ── news & lessons ────────────────────────────────────────────────────────
const IMAGES = ['bitcoin_news_hero', 'btc_cloud_hero', 'miner_rig_3d', 'rocket_rewards'];
const fallbackImg = (i) => `./assets/images/${IMAGES[i % IMAGES.length]}.jpg`;
export const lessonImg = (name) => `./assets/images/${esc(name || 'btc_cloud_hero')}.jpg`;

export function featuredNews(a, i = 0, compact = false) {
  return `
    <div class="featured-news-card" data-act="open-article" data-url="${esc(a.url)}">
      <div class="featured-news-thumb" ${compact ? 'style="height: 150px;"' : ''}>
        <img src="${esc(a.imageUrl || fallbackImg(i))}" alt="" loading="lazy" onerror="this.src='${fallbackImg(i)}'"/>
      </div>
      <div class="featured-news-body" ${compact ? 'style="padding: 14px;"' : ''}>
        <span class="badge-status lavender" style="align-self: flex-start; ${compact ? 'font-size: 10px;' : ''}">${esc(a.category)}</span>
        <h3 ${compact ? 'style="font-size: 14px; line-height: 1.35;"' : ''}>${esc(a.title)}</h3>
        ${a.summary ? `<p ${compact ? 'style="font-size: 12px;"' : ''}>${esc(a.summary)}</p>` : ''}
        <div class="news-meta-row" ${compact ? 'style="font-size: 11px;"' : ''}><span>${esc(a.source)}</span><span>•</span><span>${timeAgo(a.publishedAt)}</span></div>
      </div>
    </div>`;
}

export function newsRow(a, i = 1) {
  return `
    <div class="bm-card" data-act="open-article" data-url="${esc(a.url)}" style="padding: 12px; display: flex; gap: 12px; align-items: center; cursor: pointer;">
      <div style="width: 72px; height: 72px; border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; background: #0B0A18;">
        <img src="${esc(a.imageUrl || fallbackImg(i))}" alt="" loading="lazy" onerror="this.src='${fallbackImg(i)}'" style="width: 100%; height: 100%; object-fit: cover;"/>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
        <span class="badge-status lavender" style="font-size: 10px; padding: 1px 6px; align-self: flex-start;">${esc(a.category)}</span>
        <h4 style="font-size: 13px; font-weight: 700; line-height: 1.3; color: var(--text-primary);">${esc(a.title)}</h4>
        <div class="news-meta-row" style="font-size: 11px;"><span>${esc(a.source)}</span><span>•</span><span>${timeAgo(a.publishedAt)}</span></div>
      </div>
    </div>`;
}

export function lessonRow(l, compact = false) {
  return `
    <div class="lesson-list-item" data-go="lesson" data-id="${esc(l.slug)}" ${compact ? 'style="padding: 12px;"' : ''}>
      <div class="lesson-left">
        <div class="lesson-thumb" ${compact ? 'style="width: 42px; height: 42px;"' : ''}><img src="${lessonImg(l.image)}" alt=""/></div>
        <div>
          <h4 style="font-size: ${compact ? 13 : 13.5}px; font-weight: 700; color: var(--text-primary); ${compact ? '' : 'margin-bottom: 2px;'}">${esc(l.title)}</h4>
          ${compact
            ? `<p style="font-size: 11px; color: var(--text-secondary); margin-top: 1px;">${l.minutes} min • ${esc(l.level)}</p>`
            : `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">${esc(l.summary)}</p>
               <span style="font-size: 10.5px; font-weight: 600; color: var(--color-primary-purple);">${l.minutes} min • ${esc(l.level)}</span>`}
        </div>
      </div>
      <div class="play-circle-btn">${icons.play}</div>
    </div>`;
}

// ── earnings history ──────────────────────────────────────────────────────
export function settlementRows(days, limit = 5) {
  if (!days?.length) return emptyState('No earnings yet', 'Start mining and your hourly earnings will show up here, grouped by day.');
  return days
    .slice(0, limit)
    .map((d) => {
      const rows = [];
      if (d.miningMsat > 0) rows.push({ title: 'Mining rewards', amount: d.miningMsat, referral: false });
      if (d.referralMsat > 0) rows.push({ title: 'Referral bonus', amount: d.referralMsat, referral: true });
      return rows
        .map(
          (r) => `
        <div class="settlement-row">
          <div class="settlement-left">
            <div class="settlement-icon-circle" ${r.referral ? 'style="background: rgba(109, 53, 245, 0.1); color: var(--color-primary-purple);"' : ''}>${r.referral ? icons.user : icons.check}</div>
            <div><div class="settlement-title">${r.title}</div><div class="settlement-time">${fmtDay(d.date)} • Credited hourly</div></div>
          </div>
          <div class="settlement-right">
            <span class="settlement-amount" ${r.referral ? 'style="color: var(--color-primary-purple);"' : ''}>+${fmtSats(r.amount)}</span>
            <span class="settlement-fiat">≈ ${fmtUsd(r.amount, btcUsd())}</span>
          </div>
        </div>`,
        )
        .join('');
    })
    .join('');
}
