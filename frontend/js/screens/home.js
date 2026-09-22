/* ==========================================================================
   HOME — the prototype's Home, now live: balance, today's mining, claims,
   market ticker, miners, news, lessons, referral and daily earnings.
   ========================================================================== */

import { esc, skeleton } from '../ui.js';
import { icons } from '../icons.js';
import { state, btcUsd, liveTodayMsat } from '../store.js';
import { fmtHash, fmtSatsPrecise } from '../format.js';
import { initHeroScrollCollapse } from '../heroCollapse.js';
import {
  tickerHTML, minerCard, claimTracksHTML, countdownText, featuredNews, newsRow, lessonRow, settlementRows,
  liveBalanceText, money, moneySub,
} from './parts.js';

function heroCard() {
  const s = state.status;
  const me = state.me;
  if (s && !s.session) {
    return `
      <div class="security-alert-card hero-stagger-6" id="heroSecurityCard">
        <div class="security-alert-left">
          <div class="shield-icon-glow">${icons.bolt}</div>
          <div class="security-alert-text"><h4>Start today's mining</h4><p>Unlock ${s.claims.cap} free claims until midnight.</p></div>
        </div>
        <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-act="start-mining">Start</button>
      </div>`;
  }
  if (me && !me.twoFactorEnabled) {
    return `
      <div class="security-alert-card hero-stagger-6" id="heroSecurityCard">
        <div class="security-alert-left">
          <div class="shield-icon-glow">${icons.shield}</div>
          <div class="security-alert-text"><h4>Secure Your Account</h4><p>Turn on two-step verification to keep your sats safe.</p></div>
        </div>
        <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-go="security">Set Up</button>
      </div>`;
  }
  return `
    <div class="security-alert-card hero-stagger-6" id="heroSecurityCard">
      <div class="security-alert-left">
        <div class="shield-icon-glow">${icons.pulse}</div>
        <div class="security-alert-text"><h4>Mining is running</h4><p>Claims reset in <span data-live="countdown">${countdownText()}</span>.</p></div>
      </div>
      <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-go="mining">Boost</button>
    </div>`;
}

export const screens = {
  home: {
    tab: 'home',
    dark: true,
    keys: ['status', 'wallet', 'market', 'miners', 'daily', 'referrals', 'notifications', 'me'],
    load: (ctx) => {
      ctx.ensure('lessons');
      ctx.ensureKeyed('news', 'ALL');
    },
    render() {
      const s = state.status;
      const unread = state.notifications?.unread ?? 0;
      const active = (state.miners ?? []).filter((m) => m.status === 'active');
      const news = state.news.ALL ?? [];
      const lessons = state.lessons ?? [];
      const lifetime = state.wallet?.lifetimeMinedMsat ?? s?.balance.lifetimeMinedMsat ?? 0;
      return `
      <div class="home-screen-container" id="homeScreenContainer">
        <div class="home-hero collapsing-hero" id="homeHero">
          <div class="hero-liquid-lights-wrapper" id="heroLiquidLights">
            <div class="hero-liquid-orb-1"></div><div class="hero-liquid-orb-2"></div>
            <div class="hero-liquid-orb-3"></div><div class="hero-liquid-orb-4"></div>
          </div>
          <div class="hero-collapsing-content" id="heroCollapsingContent">
            <div class="hero-top-bar hero-stagger-0" id="heroTopBar">
              <div class="hero-brand">
                <button class="hero-icon-btn" aria-label="Settings" data-go="settings">${icons.menu}</button>
                <span class="brand-title">BitMine</span>
                <div class="network-pill"><span class="pulse-dot" ${s?.gh.total ? '' : 'style="background: #A3A1B2; animation: none;"'}></span><span>${s?.gh.total ? 'Mining' : 'Idle'}</span></div>
              </div>
              <div class="hero-top-icons">
                <button class="hero-icon-btn" aria-label="Notifications" data-go="notifications">${icons.bell}${unread ? '<span class="notification-badge-dot"></span>' : ''}</button>
                <button class="hero-icon-btn" aria-label="Profile" data-go="profile">${icons.user}</button>
              </div>
            </div>

            <div class="hero-balance-section" id="heroBalanceSection">
              <div class="hero-balance-wrapper hero-stagger-3" id="heroBalanceWrapper">
                <div class="hero-balance-glass-card" id="heroBalanceCard">
                  <div class="glass-reflection-sweep"></div>
                  <div class="hero-balance-text" id="heroBalanceText">
                    <span class="hero-greeting hero-stagger-4">Wallet balance</span>
                    <div class="hero-balance-row">
                      <span class="hero-balance-value" id="heroBalanceValue" data-live="balance" data-act="cycle-unit" style="cursor: pointer;">${s ? liveBalanceText() : '—'}</span>
                      <button class="balance-eye-btn" data-act="toggle-balance" aria-label="Hide or show balance">${icons.eye}</button>
                    </div>
                    <div class="hero-balance-sub" id="heroBalanceSub" style="margin-top: 5px;">
                      <span class="pct-pill glass-light">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m18 15-6-6-6 6"/></svg>
                        <span data-live="today">${fmtSatsPrecise(liveTodayMsat())}</span>&nbsp;today
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="action-shortcut-group hero-stagger-6" id="heroActionGroup">
              <div class="action-shortcut-item" data-act="withdraw"><div class="action-circle-btn">${icons.up}</div><span class="action-shortcut-label">Withdraw</span></div>
              <div class="action-shortcut-item" data-go="mining"><div class="action-circle-btn">${icons.bolt}</div><span class="action-shortcut-label">Boost</span></div>
              <div class="action-shortcut-item" data-go="store"><div class="action-circle-btn">${icons.plus}</div><span class="action-shortcut-label">Buy</span></div>
              <div class="action-shortcut-item" data-act="more"><div class="action-circle-btn">${icons.more}</div><span class="action-shortcut-label">More</span></div>
            </div>

            ${heroCard()}
          </div>
        </div>

        <div class="screen-scroll-view" id="homeScrollView">
          <div class="hero-scroll-spacer" id="heroScrollSpacer"></div>
          <div class="screen-content-padding" style="margin-top: 6px; gap: 18px;">
            ${tickerHTML()}

            <div>
              <div class="section-header-row"><span class="section-title">Your Mining Overview</span><span class="section-link" data-go="miners">View All</span></div>
              <div class="overview-grid">
                <div class="bm-stat-card" data-go="mining">
                  <div class="icon-box-purple">${icons.miner}</div>
                  <div>
                    <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Hashrate</span>
                    <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 2px;">
                      <strong style="font-size: 17px; font-weight: 800; color: var(--text-primary);">${fmtHash(s?.gh.total ?? 0)}</strong>
                    </div>
                    <span class="text-xs text-muted" style="display: block;">${s ? `Paid ${fmtHash(s.gh.paid)} · Claims ${fmtHash(s.gh.claim + s.gh.super)}` : '&nbsp;'}</span>
                  </div>
                </div>
                <div class="bm-stat-card" data-go="wallet">
                  <div class="icon-box-purple">${icons.gift}</div>
                  <div>
                    <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Mined</span>
                    <div style="margin-top: 2px;">
                      <strong style="font-size: 16px; font-weight: 800; color: var(--text-primary);">${money(lifetime)}</strong>
                      <span class="text-xs text-muted" style="display: block;">${moneySub(lifetime)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="bm-card mining-card">
              <div class="mining-card-head">
                <div><h4>Today's claims</h4><p>${s?.session ? 'Claimed hashpower mines until midnight.' : 'Start mining to unlock your claims.'}</p></div>
                <span class="reset-chip">${icons.clock}<span data-live="countdown">${countdownText()}</span></span>
              </div>
              ${s ? claimTracksHTML() : skeleton(2)}
              ${s && !s.session ? `<button class="btn-primary btn-block" data-act="start-mining">${icons.bolt} Start mining</button>` : ''}
            </div>

            <div class="promo-upgrade-card" data-go="store">
              <div class="promo-left">
                <div class="promo-miner-thumb"><img src="./assets/images/miner_rig_3d.jpg" alt=""/></div>
                <div class="promo-text"><h4>Upgrade Your Mining Power</h4><p>Paid miners mine 24/7 for 180 days.</p></div>
              </div>
              <div style="color: var(--color-primary-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
            </div>

            <div>
              <div class="section-header-row"><span class="section-title">Active Miners</span><span class="section-link" data-go="miners">Manage (${active.length})</span></div>
              <div style="display: flex; flex-direction: column; gap: 12px;">
                ${active.length
                  ? active.slice(0, 2).map((m) => minerCard(m, true)).join('')
                  : `<div class="bm-card" style="padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                       <div><h4 style="font-size: 14px; font-weight: 800;">No paid miners yet</h4><p style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">Mine around the clock without claiming.</p></div>
                       <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-go="store">Browse</button>
                     </div>`}
              </div>
            </div>

            ${news.length ? `
            <div>
              <div class="section-header-row"><span class="section-title">News & Market Insights</span><span class="section-link" data-go="news">View All</span></div>
              ${featuredNews(news[0], 0, true)}
              <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">${news.slice(1, 3).map((a, i) => newsRow(a, i + 1)).join('')}</div>
            </div>` : ''}

            <div>
              <div class="section-header-row"><span class="section-title">Learn Cloud Mining</span><span class="section-link" data-go="academy">All Lessons</span></div>
              <div class="academy-hero-card" data-go="academy" style="padding: 18px; margin-bottom: 12px; cursor: pointer;">
                <div class="academy-hero-left" style="max-width: 62%;">
                  <span class="badge-status lavender" style="font-size: 10px; margin-bottom: 6px; display: inline-block;">BEGINNER GUIDE</span>
                  <h3 style="font-size: 16px; margin-bottom: 4px;">Learn Crypto Mining</h3>
                  <p style="font-size: 11px; color: rgba(255, 255, 255, 0.75); margin-bottom: 10px;">Hashpower, claims and Lightning withdrawals in a few minutes.</p>
                  <button class="btn-primary" style="padding: 6px 14px; font-size: 11px;" data-go="academy">Start Learning</button>
                </div>
                <div class="academy-cap-thumb" style="width: 86px; height: 86px;"><img src="./assets/images/academy_cap.jpg" alt=""/></div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 10px;">${lessons.slice(0, 2).map((l) => lessonRow(l, true)).join('')}</div>
            </div>

            <div class="bm-card" style="padding: 16px; background: linear-gradient(145deg, #FFFFFF 0%, #F5F0FF 100%); border-color: var(--color-lavender-border);">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div style="flex: 1;">
                  <span class="badge-status lavender" style="font-size: 10px; margin-bottom: 6px; display: inline-block;">REFERRAL BONUS</span>
                  <h4 style="font-size: 15px; font-weight: 800; color: var(--text-primary); margin-bottom: 2px;">Invite & Earn BTC</h4>
                  <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Earn ${state.referrals?.rewardPercent ?? 5}% of what your friends mine, every day.</p>
                  <button class="btn-primary" style="padding: 7px 16px; font-size: 12px;" data-go="rewards">Invite Friends</button>
                </div>
                <div style="width: 82px; height: 82px; border-radius: 18px; overflow: hidden; flex-shrink: 0; box-shadow: 0 8px 20px rgba(109, 53, 245, 0.25);">
                  <img src="./assets/images/rocket_rewards.jpg" alt="" style="width: 100%; height: 100%; object-fit: cover;"/>
                </div>
              </div>
            </div>

            <div>
              <div class="section-header-row"><span class="section-title">Recent Earnings</span><span class="section-link" data-go="transactions">History</span></div>
              <div class="settlement-history-card">${state.daily ? settlementRows(state.daily, 4) : skeleton(3)}</div>
            </div>
          </div>
        </div>
      </div>`;
    },
    after(root) {
      initHeroScrollCollapse(root);
    },
  },
};

