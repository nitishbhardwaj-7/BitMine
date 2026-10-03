/* ==========================================================================
   CONTENT — Market (live prices), Rewards (Invite & Earn), News, Academy,
   lesson reader and FAQ.
   ========================================================================== */

import { post } from '../api.js';
import { esc, header, skeleton, errorCard, emptyState, toast, showFieldError } from '../ui.js';
import { icons } from '../icons.js';
import { state, refresh, loadKeyed, btcUsd } from '../store.js';
import { fmtPrice, fmtPct, fmtSats, fmtUsd, timeAgo } from '../format.js';
import { openUrl, copyText, shareText } from '../native.js';
import { coinBadge, sparkPath, featuredNews, newsRow, lessonRow, lessonImg } from './parts.js';

// ── Market ────────────────────────────────────────────────────────────────
const FAV_KEY = 'bitmine.favorites';
const favorites = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '["bitcoin"]'));
  } catch {
    return new Set(['bitcoin']);
  }
};
let marketFilter = 'all';

function marketScreen() {
  const m = state.market;
  const favs = favorites();
  let coins = m?.coins ?? [];
  if (marketFilter === 'gainers') coins = coins.filter((c) => c.change24h >= 0).sort((a, b) => b.change24h - a.change24h);
  if (marketFilter === 'losers') coins = coins.filter((c) => c.change24h < 0).sort((a, b) => a.change24h - b.change24h);
  if (marketFilter === 'favorites') coins = coins.filter((c) => favs.has(c.id));
  const pill = (id, label) => `<button class="filter-pill ${marketFilter === id ? 'active' : ''}" data-act="market-filter" data-filter="${id}">${label}</button>`;
  return `
    <div class="screen-scroll-view animate-fade-up">
      <div class="screen-header"><h2 class="screen-title">Market</h2>
        <div class="screen-header-right"><button class="icon-action-btn" aria-label="Refresh prices" data-act="market-refresh">${icons.refresh}</button></div>
      </div>
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="filter-pills-row">${pill('all', 'All')}${pill('gainers', 'Top Gainers')}${pill('losers', 'Top Losers')}${pill('favorites', 'Favorites')}</div>
        <div class="bm-card" style="padding: 6px 0; overflow: hidden;">
          <div class="market-table-header"><span style="width: 38%;">Coin</span><span style="width: 28%; text-align: right;">Price</span><span style="width: 34%; text-align: right;">24h</span></div>
          <div id="marketCoinList">
            ${m == null
              ? state.errors.market ? `<div style="padding: 12px;">${errorCard(state.errors.market, 'market-refresh')}</div>` : `<div style="padding: 12px;">${skeleton(5)}</div>`
              : coins.length
                ? coins.map((c) => `
                  <div class="market-coin-row">
                    <div class="market-coin-left">
                      ${coinBadge(c, 'asset-icon-circle', 'width: 34px; height: 34px; font-size: 13px;')}
                      <div><h4 style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${esc(c.symbol)}</h4><p style="font-size: 11px; color: var(--text-secondary);">${esc(c.name)}</p></div>
                    </div>
                    <div class="market-coin-center">${fmtPrice(c.priceUsd)}</div>
                    <div class="market-coin-right">
                      <svg class="sparkline-svg" viewBox="0 0 48 24"><path d="${sparkPath(c.sparkline)}" fill="none" stroke="${c.change24h >= 0 ? '#12B76A' : '#F04438'}" stroke-width="2" stroke-linecap="round"/></svg>
                      <span class="pct-pill ${c.change24h >= 0 ? 'gain' : 'loss'}" style="font-size: 11px; padding: 2px 6px;">${fmtPct(c.change24h)}</span>
                      <button class="star-favorite-btn ${favs.has(c.id) ? 'active' : ''}" data-act="favorite" data-id="${esc(c.id)}" aria-label="Favorite">
                        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      </button>
                    </div>
                  </div>`).join('')
                : `<div style="padding: 12px;">${emptyState('No coins here', marketFilter === 'favorites' ? 'Tap the star on a coin to add it to your favorites.' : 'Nothing matches this filter right now.')}</div>`}
          </div>
        </div>
        ${m ? `<p class="muted-note">Prices from CoinGecko · updated ${timeAgo(m.updatedAt)}${m.stale ? ' (showing last known prices)' : ''}. For information only.</p>` : ''}
        <div class="promo-upgrade-card" style="background: linear-gradient(135deg, #F0EAFE 0%, #FFFFFF 100%);" data-go="news">
          <div class="promo-left">
            <div class="icon-box-purple" style="background: var(--color-primary-purple); color: #FFF;">${icons.bell}</div>
            <div class="promo-text"><h4>Stay Ahead of the Market</h4><p>Read the latest crypto news.</p></div>
          </div>
          <div style="color: var(--color-primary-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
        </div>
      </div>
    </div>`;
}

// ── Rewards (Invite & Earn) ───────────────────────────────────────────────
function rewardsScreen() {
  const r = state.referrals;
  const code = r?.referralCode ?? state.me?.referralCode ?? '—';
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Rewards')}
      <div class="screen-content-padding" style="gap: 16px;">
        <div class="rewards-hero-card">
          <div class="rewards-hero-content">
            <h3>Invite & Earn</h3>
            <p>Get ${r?.rewardPercent ?? 5}% of what your friends mine, every day.</p>
            <div class="referral-box-row">
              <span class="referral-code-text">${esc(code)}</span>
              <button class="btn-primary" data-act="copy-referral" style="padding: 5px 14px; font-size: 11px;">Copy</button>
            </div>
          </div>
          <div class="rewards-rocket-illustration"><img src="./assets/images/rocket_rewards.jpg" alt=""/></div>
        </div>
        <button class="btn-primary btn-block" data-act="share-referral">${icons.share} Share invite</button>

        <div class="overview-grid">
          <div class="bm-stat-card">
            <div class="icon-box-purple">${icons.users}</div>
            <div><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Friends invited</span>
              <strong style="font-size: 20px; font-weight: 800; color: var(--text-primary); display: block; margin-top: 2px;">${r ? r.invitedCount : '–'}</strong></div>
          </div>
          <div class="bm-stat-card">
            <div class="icon-box-purple">${icons.gift}</div>
            <div><span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total earned</span>
              <strong style="font-size: 16px; font-weight: 800; color: var(--text-primary); display: block; margin-top: 2px;">${r ? fmtSats(r.totalEarnedMsat) : '–'}</strong>
              <span class="text-xs text-muted">${r ? `≈ ${fmtUsd(r.totalEarnedMsat, btcUsd())}` : ''}</span></div>
          </div>
        </div>

        <div class="section-header-row" style="margin-top: 4px;"><span class="section-title">How it works</span></div>
        <div class="stack">
          ${[
            ['Share your code', 'Friends enter it when they create their BitMine account.'],
            ['They mine', 'Their earnings are never reduced: your bonus is paid by BitMine.'],
            [`You earn ${r?.rewardPercent ?? 5}% daily`, `Credited once a day, up to ${r?.dailyCapSats ?? 5} sats a day in total. Yesterday you earned ${fmtSats(r?.yesterdayEarnedMsat ?? 0)}.`],
          ].map(([t, d], i) => `
            <div class="bm-card" style="padding: 14px; display: flex; gap: 12px; align-items: center;">
              <div class="icon-box-purple sm" style="font-weight: 800;">${i + 1}</div>
              <div><h4 style="font-size: 13px; font-weight: 700;">${t}</h4><p style="font-size: 11.5px; color: var(--text-secondary);">${d}</p></div>
            </div>`).join('')}
        </div>

        ${r?.canAddReferralCode ? `
        <div class="bm-card">
          <form class="bm-form" data-form="add-referral" novalidate>
            <label class="bm-field"><span>Were you invited? Add their code</span>
              <input class="bm-input" name="code" maxlength="16" placeholder="Friend's referral code" style="text-transform: uppercase;" required>
            </label>
            <button class="btn-soft btn-block" type="submit">Add referral code</button>
          </form>
          <p class="bm-hint" style="margin-top: 8px;">You can add a code within your first 7 days.</p>
        </div>` : ''}
      </div>
    </div>`;
}

// ── News ──────────────────────────────────────────────────────────────────
let newsCategory = 'ALL';

function newsScreen() {
  const list = state.news[newsCategory];
  const err = state.errors[`news:${newsCategory}`];
  const pill = (id, label) => `<button class="filter-pill ${newsCategory === id ? 'active' : ''}" data-act="news-filter" data-filter="${id}">${label}</button>`;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('News')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="filter-pills-row">${pill('ALL', 'All')}${pill('BITCOIN', 'Bitcoin')}${pill('MINING', 'Mining')}${pill('MARKET', 'Market')}${pill('WEB3', 'Web3')}</div>
        ${list == null
          ? err ? errorCard(err) : skeleton(5)
          : list.length
            ? `${featuredNews(list[0], 0)}<div style="display: flex; flex-direction: column; gap: 12px;">${list.slice(1).map((a, i) => newsRow(a, i + 1)).join('')}</div>
               <p class="muted-note">Headlines from CoinDesk, Cointelegraph, Decrypt and Bitcoin Magazine. Tap to read on the publisher's site.</p>`
            : emptyState('No news yet', 'Headlines refresh every 30 minutes. Check back soon.')}
      </div>
    </div>`;
}

// ── Academy ───────────────────────────────────────────────────────────────
let academyFilter = 'All';

function academyScreen() {
  const lessons = state.lessons;
  const cats = ['All', ...new Set((lessons ?? []).map((l) => l.category))];
  const shown = (lessons ?? []).filter((l) => academyFilter === 'All' || l.category === academyFilter);
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Academy')}
      <div class="screen-content-padding" style="gap: 16px;">
        <div class="filter-pills-row">${cats.map((c) => `<button class="filter-pill ${academyFilter === c ? 'active' : ''}" data-act="academy-filter" data-filter="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div class="academy-hero-card">
          <div class="academy-hero-left">
            <h3>Learn Crypto Mining</h3>
            <p>A short guide from Bitcoin basics to Lightning withdrawals.</p>
            <button class="btn-white" style="font-size: 11px; padding: 7px 16px;" ${lessons?.[0] ? `data-go="lesson" data-id="${esc(lessons[0].slug)}"` : ''}>Start Learning</button>
          </div>
          <div class="academy-cap-thumb"><img src="./assets/images/academy_cap.jpg" alt=""/></div>
        </div>
        <div class="section-header-row"><span class="section-title">Lessons</span><span class="text-xs text-muted" style="font-weight: 600;">${shown.length} lessons</span></div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${lessons == null ? (state.errors.lessons ? errorCard(state.errors.lessons, 'reload') : skeleton(4)) : shown.map((l) => lessonRow(l)).join('')}
        </div>
      </div>
    </div>`;
}

function lessonScreen(ctx) {
  const l = state.lesson[ctx.params.id];
  const err = state.errors[`lesson:${ctx.params.id}`];
  if (!l) return `<div class="screen-scroll-view">${header('Lesson')}<div class="screen-content-padding">${err ? errorCard(err) : skeleton(6)}</div></div>`;
  const all = state.lessons ?? [];
  const next = all[all.findIndex((x) => x.slug === l.slug) + 1];
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Academy')}
      <div class="screen-content-padding" style="gap: 16px;">
        <div class="featured-news-card" style="cursor: default;">
          <div class="featured-news-thumb" style="height: 160px;"><img src="${lessonImg(l.image)}" alt=""/></div>
          <div class="featured-news-body">
            <span class="badge-status lavender" style="align-self: flex-start;">${esc(l.category.toUpperCase())} · ${esc(l.level.toUpperCase())}</span>
            <h3>${esc(l.title)}</h3>
            <div class="news-meta-row"><span>${l.minutes} min read</span></div>
          </div>
        </div>
        <div class="bm-card lesson-body">${l.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        ${next ? `<button class="btn-primary btn-block" data-go="lesson" data-id="${esc(next.slug)}" data-replace="1">Next: ${esc(next.title)}</button>` : `<button class="btn-soft btn-block" data-go="academy">Back to all lessons</button>`}
      </div>
    </div>`;
}

// ── FAQ ───────────────────────────────────────────────────────────────────
function faqScreen() {
  const faqs = state.faqs;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('FAQ')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="grouped-list-section">
          ${faqs == null ? `<div style="padding: 14px;">${state.errors.faqs ? errorCard(state.errors.faqs, 'reload') : skeleton(5)}</div>` : faqs.map((f) => `
            <details class="faq-item"><summary>${esc(f.question)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg></summary><p>${esc(f.answer)}</p></details>`).join('')}
        </div>
        <div class="promo-upgrade-card" data-go="support">
          <div class="promo-left"><div class="icon-box-purple">${icons.chat}</div><div class="promo-text"><h4>Still need help?</h4><p>Send us a message and we'll reply here.</p></div></div>
          <div style="color: var(--color-primary-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
        </div>
      </div>
    </div>`;
}

export const screens = {
  market: { tab: 'market', banner: true, keys: ['market'], load: (ctx) => ctx.refresh('market'), render: marketScreen },
  rewards: { tab: 'profile', keys: ['referrals', 'me', 'market'], load: (ctx) => ctx.refresh('referrals'), render: rewardsScreen },
  news: { tab: 'home', banner: true, keys: ['news'], load: () => loadKeyed('news', newsCategory), render: newsScreen },
  academy: { tab: 'home', keys: ['lessons'], load: (ctx) => ctx.ensure('lessons'), render: academyScreen },
  lesson: { tab: 'home', keys: ['lesson', 'lessons'], load: (ctx) => { ctx.ensure('lessons'); return loadKeyed('lesson', ctx.params.id); }, render: lessonScreen },
  faq: { tab: 'profile', keys: ['faqs'], load: (ctx) => ctx.ensure('faqs'), render: faqScreen },
};

function referralMessage() {
  const code = state.referrals?.referralCode ?? state.me?.referralCode ?? '';
  return { code, text: `I'm mining Bitcoin with BitMine. Join with my code ${code} and start earning sats today.` };
}

export const actions = {
  'market-filter'(el, ctx) {
    marketFilter = el.dataset.filter;
    ctx.rerender();
  },
  async 'market-refresh'() {
    await refresh('market');
  },
  favorite(el, ctx) {
    const favs = favorites();
    const id = el.dataset.id;
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
    } catch {
      /* ignore */
    }
    toast(favs.has(id) ? 'Added to favorites' : 'Removed from favorites');
    ctx.rerender();
  },
  async 'copy-referral'(el) {
    const { code } = referralMessage();
    await copyText(code);
    const html = el.innerHTML;
    el.innerHTML = 'Copied!';
    setTimeout(() => (el.innerHTML = html), 2000);
    toast(`Referral code ${code} copied.`);
  },
  async 'share-referral'() {
    const { text } = referralMessage();
    const shared = await shareText({ title: 'Mine Bitcoin with BitMine', text });
    if (!shared) toast('Invite copied. Paste it anywhere to share.');
  },
  'news-filter'(el, ctx) {
    newsCategory = el.dataset.filter;
    if (!state.news[newsCategory]) loadKeyed('news', newsCategory);
    ctx.rerender();
  },
  'academy-filter'(el, ctx) {
    academyFilter = el.dataset.filter;
    ctx.rerender();
  },
  async 'open-article'(el) {
    await openUrl(el.dataset.url);
  },
};

export const forms = {
  async 'add-referral'(form, v) {
    if (!v.code) return showFieldError(form, "Enter your friend's code.");
    await post('/v1/me/referral', { code: v.code.toUpperCase() });
    await refresh('referrals', 'me');
    toast('Referral code added. Your friend will earn a bonus from your mining.');
  },
};
