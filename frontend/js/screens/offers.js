/* ==========================================================================
   OFFERS — everything that nudges towards a purchase or a daily return:
   the starter offer, sale banner, streak, boost video, earnings comparison
   and the upsell sheets. All numbers come from the server (status, config,
   products); nothing here grants anything.
   ========================================================================== */

import { esc, openSheet, sheetOpen } from '../ui.js';
import { icons } from '../icons.js';
import { state } from '../store.js';
import { fmtHash, fmtSats, fmtCountdown } from '../format.js';
import { productPrice, subscribedTo } from './parts.js';

/** The biggest paid miner the user can still take (a subscription can't be bought twice). */
const topMiner = () => (state.products ?? []).filter((p) => p.kind === 'miner' && !(p.billing === 'subscription' && subscribedTo(p.sku))).pop();

const product = (sku) => (state.products ?? []).find((p) => p.sku === sku);
const rate = () => state.config?.economics?.rateMsatPerGhDay ?? 48; // msat per GH/s per day
const perDay = (gh) => fmtSats(gh * rate());
/** A countdown the live loop keeps current (app.js updates every [data-until]). */
const until = (iso) => `<span data-until="${esc(iso)}">${fmtCountdown(Date.parse(iso) - Date.now())}</span>`;
const ownedSupers = () => new Set((state.status?.superTiers ?? []).map((t) => t.sku));

// ── prices ────────────────────────────────────────────────────────────────
const savePct = (p) => (p.listPriceUsd > p.priceDisplayUsd ? Math.round((1 - p.priceDisplayUsd / p.listPriceUsd) * 100) : 0);

/** Price with the struck-through "was" price and the billing period, when there is one. */
export function priceHTML(p) {
  const was = savePct(p) ? `<s class="was-price">$${p.listPriceUsd.toFixed(2)}</s>` : '';
  return `${was}${esc(productPrice(p))}${p.billing === 'subscription' ? '<small class="price-per"> / month</small>' : ''}`;
}

/** Chip on the product the current sale is for (or on anything with a "was" price). */
export function saleChipHTML(p) {
  const promo = state.config?.promo;
  const onSale = promo && promo.sku === p.sku && Date.parse(promo.endsAt) > Date.now();
  const save = savePct(p);
  if (!onSale && !save) return '';
  return `<span class="sale-chip">${onSale && promo.badge ? esc(promo.badge) : `Save ${save}%`}${onSale ? ` · ends in ${until(promo.endsAt)}` : ''}</span>`;
}

// ── sale banner (admin → FAQs & app → Sale banner) ────────────────────────
export function promoHTML() {
  const promo = state.config?.promo;
  if (!promo || Date.parse(promo.endsAt) <= Date.now()) return '';
  const p = promo.sku ? product(promo.sku) : null;
  return `
    <div class="promo-banner" data-go="store" ${p?.kind === 'super_miner' ? 'data-id="super"' : ''}>
      <div class="promo-banner-main">
        <div class="promo-banner-top">${promo.badge ? `<span class="promo-badge">${esc(promo.badge)}</span>` : ''}<span class="promo-timer">${icons.clock} Ends in ${until(promo.endsAt)}</span></div>
        <h4>${esc(promo.title)}</h4>
        ${promo.body ? `<p>${esc(promo.body)}</p>` : ''}
      </div>
      <button class="btn-white claim-btn">Shop now</button>
    </div>`;
}

// ── starter offer (new accounts, first purchase) ──────────────────────────
function offerBody(p, offer) {
  const inc = p.includes;
  const save = savePct(p);
  return `
    <div class="offer-top"><span class="promo-badge">Welcome offer${save ? ` · save ${save}%` : ''}</span><span class="promo-timer">${icons.clock} ${until(offer.endsAt)} left</span></div>
    <h4>${esc(p.name)}</h4>
    <ul class="offer-list">
      ${p.gh ? `<li>${icons.miner} A ${fmtHash(p.gh)} miner for ${p.durationDays} days</li>` : ''}
      ${inc ? `<li>${icons.rocket} ${esc(inc.name)}: ${inc.claimsPerDay} extra claims every day</li>` : ''}
      ${state.status?.perks?.paidSkipStartAds ? `<li>${icons.bolt} Start mining with one tap, no videos</li>` : ''}
    </ul>
    <div class="offer-foot">
      <span class="offer-price">${priceHTML(p)}</span>
      <button class="btn-white claim-btn" data-act="buy" data-sku="${esc(p.sku)}">Get the pack</button>
    </div>`;
}

export function offerHTML() {
  const offer = state.status?.offer;
  const p = offer && product(offer.sku);
  if (!p || Date.parse(offer.endsAt) <= Date.now()) return '';
  return `<div class="offer-card">${offerBody(p, offer)}</div>`;
}

/** The offer as a popup: once a day while it runs, the first time Home shows it. */
let offerTimer = null;
export function maybeOpenOfferSheet() {
  // Home renders several times while the app starts (and start-up navigation closes
  // sheets), so wait until it has settled and is still the screen on show.
  clearTimeout(offerTimer);
  offerTimer = setTimeout(() => {
    if (document.getElementById('homeScreenContainer')) openOfferSheet();
  }, 1500);
}

function openOfferSheet() {
  const offer = state.status?.offer;
  const p = offer && product(offer.sku);
  if (!p || Date.parse(offer.endsAt) <= Date.now() || sheetOpen()) return;
  const today = new Date().toDateString();
  try {
    if (localStorage.getItem('bitmine.offerSeen') === today) return;
    localStorage.setItem('bitmine.offerSeen', today);
  } catch {
    return; // no storage: the card on Home is enough
  }
  openSheet('A welcome gift for you', `<div class="stack"><div class="offer-card">${offerBody(p, offer)}</div><p class="bm-hint text-center">New miners only. You can also find it on Home until it ends.</p></div>`);
}

// ── daily streak ──────────────────────────────────────────────────────────
export function streakHTML() {
  const k = state.status?.streak;
  if (!k) return '';
  const dots = Array.from({ length: Math.min(k.target, 10) }, (_, i) => {
    const last = i === Math.min(k.target, 10) - 1;
    return `<span class="streak-dot ${i < k.progress ? 'on' : ''} ${last ? 'bonus' : ''}">${last ? icons.gift : i < k.progress ? '✓' : i + 1}</span>`;
  }).join('');
  const left = k.target - k.progress;
  const line = k.bonusToday
    ? `Bonus day! +${k.bonusGh} GH/s is mining for you until midnight.`
    : k.doneToday
      ? `Come back ${left === 1 ? 'tomorrow' : `${left} more days in a row`} for +${k.bonusGh} GH/s.`
      : k.count
        ? `Start mining today to keep your streak. Day ${k.target} pays +${k.bonusGh} GH/s.`
        : `Start mining ${k.target} days in a row for a +${k.bonusGh} GH/s bonus.`;
  return `
    <div class="bm-card streak-card">
      <div class="mining-card-head">
        <div><h4>${k.count ? `${k.count}-day streak` : 'Daily streak'}</h4><p>${line}</p></div>
        <span class="reset-chip">${k.progress}/${k.target}</span>
      </div>
      <div class="streak-dots">${dots}</div>
    </div>`;
}

// ── boost video: double what is running for a while ───────────────────────
export function boostHTML() {
  const s = state.status;
  const b = s?.boost;
  if (!b) return '';
  const started = Boolean(s.session?.active);
  const running = b.activeUntil && Date.parse(b.activeUntil) > Date.now();
  const done = b.used >= b.cap;
  const label = running ? 'Boost running' : done ? 'All used' : !started ? 'Start first' : b.gh <= 0 ? 'Claim first' : `Boost +${fmtHash(b.gh)}`;
  const disabled = running || done || !started || b.gh <= 0;
  return `
    <div class="claim-track boost-track">
      <div class="claim-track-row">
        <div><div class="claim-track-title">2× Boost</div>
          <div class="claim-track-sub">${running ? `Running now · ends in ${until(b.activeUntil)}` : `Watch a video to double your hashpower for ${b.minutes} minutes`}</div></div>
        <span class="claim-count">${b.used}/${b.cap}</span>
      </div>
      <div class="claim-track-row">
        <span class="claim-track-sub">${b.gh > 0 ? `Adds ${fmtHash(b.gh)} right now` : 'Doubles whatever you have running'}</span>
        <button class="btn-primary claim-btn" data-act="claim" data-kind="boost" ${disabled ? 'disabled' : ''}>${icons.bolt} ${label}</button>
      </div>
    </div>`;
}

// ── "what you're missing": today's pace against the packs ─────────────────
function upgrades() {
  const owned = ownedSupers();
  const supers = (state.products ?? []).filter((p) => p.kind === 'super_miner' && !owned.has(p.sku));
  // The middle Super Miner is the recommended one; fall back to the first not owned.
  const sup = supers.find((p) => p.sku === 'super_pro') ?? supers[0];
  const top = topMiner();
  return [
    sup && { name: sup.name, gh: sup.maxGhPerDay, price: productPrice(sup), section: 'super' },
    top && { name: `${top.name} miner`, gh: top.gh, price: productPrice(top), section: '' },
  ].filter(Boolean);
}

export function compareHTML() {
  const s = state.status;
  const ups = upgrades();
  if (!s || !ups.length) return '';
  const now = s.gh.total;
  const max = Math.max(now, ...ups.map((u) => now + u.gh)) || 1;
  const bar = (gh, cls = '') => `<div class="compare-bar ${cls}"><div style="width: ${Math.max(4, Math.round((gh / max) * 100))}%;"></div></div>`;
  return `
    <div class="bm-card compare-card">
      <div class="mining-card-head"><div><h4>Earn more every day</h4><p>What a full day of mining pays at today's rate.</p></div></div>
      <div class="compare-row"><div class="compare-label"><span>You now</span><strong>${now > 0 ? `up to ${perDay(now)}` : 'Not mining yet'}</strong></div>${bar(now, 'now')}</div>
      ${ups.map((u) => `
        <div class="compare-row" data-go="store" ${u.section ? `data-id="${u.section}"` : ''}>
          <div class="compare-label"><span>With ${esc(u.name)} <em>${esc(u.price)}</em></span><strong>up to ${perDay(now + u.gh)}${now > 0 ? ` <b>${((now + u.gh) / now).toFixed(1)}×</b>` : ''}</strong></div>
          ${bar(now + u.gh)}
        </div>`).join('')}
      <button class="btn-primary btn-block" data-go="store">${icons.bolt} Upgrade my mining</button>
    </div>`;
}

// ── wallet: how far the first withdrawal is ───────────────────────────────
export function reachFasterHTML(availSats, minSats) {
  const s = state.status;
  if (!s || availSats >= minSats) return '';
  const top = topMiner();
  if (!top) return '';
  const days = (gh) => Math.ceil((minSats - availSats) / ((gh * rate()) / 1000));
  const now = s.gh.total > 0 ? days(s.gh.total) : null;
  const withTop = days(s.gh.total + top.gh);
  if (now !== null && now <= withTop) return '';
  const d = (n) => `${n.toLocaleString('en-US')} day${n === 1 ? '' : 's'}`;
  return `
    <div class="bm-card reach-card" data-go="store">
      <div class="icon-box-purple">${icons.rocket}</div>
      <div style="flex: 1;">
        <h4>Reach your first withdrawal faster</h4>
        <p>${now === null ? 'Start mining to move towards the minimum.' : `At today's pace: about ${d(now)} of full mining.`} With a ${esc(top.name)} miner: about <strong>${d(withTop)}</strong>.</p>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--color-primary-purple); flex-shrink: 0;"><path d="m9 18 6-6-6-6"/></svg>
    </div>`;
}

// ── upsell sheets at the moments people want more ─────────────────────────
/** Right after the last free claim of the day. */
export function openClaimsDoneSheet() {
  const owned = ownedSupers();
  const p = (state.products ?? []).find((x) => x.kind === 'super_miner' && !owned.has(x.sku));
  if (!p) return;
  openSheet('Free claims done for today', `
    <div class="stack">
      <div class="super-upsell" data-go="store" data-id="super">
        <div class="super-upsell-icon">${icons.rocket}</div>
        <div class="super-upsell-text">
          <h4>Keep claiming with ${esc(p.name)}</h4>
          <p><strong>${p.claimsPerDay} more claims</strong> every day, +${p.claimGh} GH/s each: up to ${fmtHash(p.maxGhPerDay)} extra daily for <strong>${priceHTML(p)}</strong>.</p>
        </div>
      </div>
      <button class="btn-primary btn-block" data-go="store" data-id="super">${icons.bolt} See Super Miner packs</button>
      <p class="bm-hint text-center">Your free claims come back at midnight.</p>
    </div>`);
}

/** After the day is started, at most once a day, for people without a paid miner. */
export function openStartedSheet() {
  const s = state.status;
  if (!s || s.gh.paid > 0) return;
  try {
    if (localStorage.getItem('bitmine.startOffer') === s.session?.localDate) return;
    localStorage.setItem('bitmine.startOffer', s.session?.localDate ?? '');
  } catch {
    return; // no storage: don't risk showing it on every start
  }
  const offer = s.offer;
  const pack = offer && product(offer.sku);
  const skip = s.perks?.paidSkipStartAds && (s.startAdsRequired ?? 0) > 0;
  const ups = upgrades();
  if (!pack && !skip && !ups.length) return;
  openSheet('Mining started', `
    <div class="stack">
      ${pack ? `<div class="offer-card">${offerBody(pack, offer)}</div>` : ''}
      ${skip ? `<div class="perk-row"><div class="icon-box-purple">${icons.bolt}</div><div><h4>Skip the daily videos</h4><p>With any paid miner, one tap starts your day. No videos to watch.</p></div></div>` : ''}
      ${!pack && ups[0] ? `<div class="perk-row"><div class="icon-box-purple">${icons.rocket}</div><div><h4>Mine up to ${perDay(s.gh.total + ups[0].gh)} a day</h4><p>${esc(ups[0].name)} adds up to ${fmtHash(ups[0].gh)} every day.</p></div></div>` : ''}
      <button class="btn-primary btn-block" data-go="store">${icons.bolt} See miners and packs</button>
    </div>`);
}
