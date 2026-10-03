/* ==========================================================================
   WALLET — balance, overview, transactions, withdrawals and the withdraw sheet.
   Withdrawals go to a Speed address (name@speed.app) or a Lightning invoice
   for the exact amount; the backend locks the sats straight away.
   ========================================================================== */

import { get, post, ApiError } from '../api.js';
import { esc, header, skeleton, errorCard, emptyState, toast, openSheet, closeSheet, showFieldError, formData, busy } from '../ui.js';
import { icons } from '../icons.js';
import { state, refresh, btcUsd } from '../store.js';
import { fmtSats, fmtUsd, fmtDateTime, sats } from '../format.js';
import { liveBalanceHtml, moneySub, unit, money, settlementRows } from './parts.js';
import { reachFasterHTML } from './offers.js';

const WITHDRAW_STATUS = {
  pending: ['warn', 'Waiting for review'],
  processing: ['warn', 'Sending'],
  paid: ['active', 'Sent'],
  failed: ['inactive', 'Returned'],
  rejected: ['inactive', 'Not approved'],
};

function withdrawalRow(w) {
  const [cls, label] = WITHDRAW_STATUS[w.status] ?? ['inactive', w.status];
  return `
    <div class="tx-row">
      <div>
        <h4>Lightning withdrawal</h4>
        <p>${fmtDateTime(w.createdAt)} · ${esc(w.destination)}</p>
        ${w.rejectReason ? `<p style="color: var(--color-danger);">${esc(w.rejectReason)}</p>` : ''}
      </div>
      <div style="text-align: right;">
        <div class="tx-amount minus">−${fmtSats(w.amountSats * 1000)}</div>
        <span class="badge-status ${cls === 'warn' ? 'lavender' : cls}" style="margin-top: 4px;">${label}</span>
      </div>
    </div>`;
}

function ledgerRow(e) {
  const plus = e.amountMsat > 0;
  return `
    <div class="tx-row">
      <div><h4>${esc(e.label)}</h4><p>${fmtDateTime(e.createdAt)}</p></div>
      <span class="tx-amount ${plus ? 'plus' : 'minus'}">${plus ? '+' : '−'}${(Math.abs(e.amountMsat) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} sats</span>
    </div>`;
}

let walletTab = 'overview';

function walletScreen() {
  const w = state.wallet;
  const s = state.status;
  const min = w?.minWithdrawalSats ?? 2500;
  const avail = sats(w?.availableMsat ?? 0);
  const progress = Math.min(100, Math.round((avail / min) * 100));
  return `
    <div class="screen-scroll-view animate-fade-up">
      <div class="screen-header"><h2 class="screen-title">Wallet</h2>
        <div class="screen-header-right"><button class="icon-action-btn" aria-label="Transactions" data-go="transactions">${icons.list}</button></div>
      </div>
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="bm-card wallet-balance-card">
          <div class="wallet-balance-label-row">
            <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Balance</span>
            <button class="currency-select-pill" data-act="cycle-unit">${unit().toUpperCase()}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div class="wallet-main-amount" data-live="balance">${s ? liveBalanceHtml() : '—'}</div>
          <div class="wallet-btc-equiv" data-live="balance-sub">${s ? moneySub(s.balance.displayMsat) : ''}</div>
          <div class="action-shortcut-group" style="margin-top: 18px;">
            <div class="action-shortcut-item" data-act="withdraw"><div class="action-circle-btn light">${icons.up}</div><span class="action-shortcut-label light">Withdraw</span></div>
            <div class="action-shortcut-item" data-go="transactions"><div class="action-circle-btn light">${icons.list}</div><span class="action-shortcut-label light">History</span></div>
            <div class="action-shortcut-item" data-go="rewards"><div class="action-circle-btn light">${icons.gift}</div><span class="action-shortcut-label light">Invite</span></div>
            <div class="action-shortcut-item" data-go="support"><div class="action-circle-btn light">${icons.help}</div><span class="action-shortcut-label light">Help</span></div>
          </div>
        </div>

        <div class="segmented-control">
          <div class="segmented-tab ${walletTab === 'overview' ? 'active' : ''}" data-act="wallet-tab" data-tab="overview">Overview</div>
          <div class="segmented-tab ${walletTab === 'withdrawals' ? 'active' : ''}" data-act="wallet-tab" data-tab="withdrawals">Withdrawals</div>
        </div>

        ${walletTab === 'overview' ? `
        ${w ? `
        <div class="bm-card">
          <div class="row-between" style="margin-bottom: 8px;">
            <span class="text-sm font-semibold text-primary">Ready to withdraw</span>
            <span class="text-sm font-bold text-purple">${avail.toLocaleString('en-US')} / ${min.toLocaleString('en-US')} sats</span>
          </div>
          <div class="bm-progress-track"><div class="bm-progress-fill" style="width: ${progress}%;"></div></div>
          <p class="bm-hint" style="margin-top: 8px;">${w.openWithdrawal ? `A withdrawal of ${fmtSats(w.openWithdrawal.amountSats * 1000)} is in progress.` : avail >= min ? 'You can withdraw now.' : `The minimum withdrawal is ${min.toLocaleString('en-US')} sats. Keep mining!`}</p>
        </div>
        ${w.openWithdrawal ? '' : reachFasterHTML(avail, min)}
        <div class="bm-card" style="padding: 6px 16px;"><div class="info-rows">
          <div class="info-row"><span>Available</span><strong>${fmtSats(w.availableMsat)}</strong></div>
          <div class="info-row"><span>Being withdrawn</span><strong>${fmtSats(w.lockedMsat)}</strong></div>
          <div class="info-row"><span>Mining now (not yet credited)</span><strong>${fmtSats(s?.balance.unsettledMsat ?? 0)}</strong></div>
          <div class="info-row"><span>Total mined</span><strong>${money(w.lifetimeMinedMsat)}</strong></div>
          <div class="info-row"><span>Bitcoin price</span><strong>${btcUsd() ? `$${Math.round(btcUsd()).toLocaleString('en-US')}` : '–'}</strong></div>
        </div></div>` : state.errors.wallet ? errorCard(state.errors.wallet, 'reload') : skeleton(4)}
        <div>
          <div class="section-header-row"><span class="section-title">Daily earnings</span><span class="section-link" data-go="transactions">All transactions</span></div>
          <div class="settlement-history-card">${state.daily ? settlementRows(state.daily, 7) : skeleton(3)}</div>
        </div>` : `
        <div class="bm-card" style="padding: 4px 16px;">
          ${state.withdrawals == null ? skeleton(3) : state.withdrawals.length ? state.withdrawals.map(withdrawalRow).join('') : emptyState('No withdrawals yet', `Once you have ${min.toLocaleString('en-US')} sats you can withdraw over Lightning.`)}
        </div>`}

        <div class="promo-upgrade-card" style="background: linear-gradient(135deg, #F0EAFE 0%, #FFFFFF 100%);" data-go="store">
          <div class="promo-left">
            <div class="promo-miner-thumb" style="background: #180F33;"><img src="./assets/images/rocket_rewards.jpg" alt=""/></div>
            <div class="promo-text"><h4>Earn More with BitMine</h4><p>Add miners to grow your daily sats.</p></div>
          </div>
          <button class="btn-primary" style="padding: 7px 14px; font-size: 11px;">Get Started</button>
        </div>
      </div>
    </div>`;
}

function transactionsScreen() {
  const l = state.ledger;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Transactions')}
      <div class="screen-content-padding" style="gap: 14px;">
        <p class="bm-hint">Mining is credited every hour. Withdrawals move sats out of your available balance as soon as you request them.</p>
        <div class="bm-card" style="padding: 4px 16px;">
          ${l == null ? (state.errors.ledger ? errorCard(state.errors.ledger, 'reload') : skeleton(5)) : l.entries.length ? l.entries.map(ledgerRow).join('') : emptyState('No transactions yet', 'Your hourly mining credits will appear here.')}
        </div>
        ${l?.nextCursor ? `<button class="btn-soft btn-block" data-act="ledger-more">Load more</button>` : ''}
      </div>
    </div>`;
}

export const screens = {
  wallet: { tab: 'wallet', keys: ['wallet', 'status', 'daily', 'withdrawals', 'market', 'products'], load: (ctx) => { ctx.ensure('products'); return ctx.refresh('wallet', 'daily', 'withdrawals'); }, render: walletScreen },
  transactions: { tab: 'wallet', keys: ['ledger'], load: (ctx) => ctx.refresh('ledger'), render: transactionsScreen },
};

// ── withdraw sheet ────────────────────────────────────────────────────────
function withdrawSheet() {
  const w = state.wallet;
  const me = state.me;
  const avail = sats(w?.availableMsat ?? 0);
  const min = w?.minWithdrawalSats ?? 2500;
  if (w?.openWithdrawal) {
    return `<div class="stack text-center"><p class="bm-hint">You already have a withdrawal of ${fmtSats(w.openWithdrawal.amountSats * 1000)} in progress. You can request another once it's done.</p>
      <button class="btn-primary btn-block" data-act="close-and-go" data-to="wallet">View status</button></div>`;
  }
  if (avail < min) {
    return `<div class="stack text-center"><p class="bm-hint">You have ${avail.toLocaleString('en-US')} sats available. The minimum withdrawal is ${min.toLocaleString('en-US')} sats.</p>
      <button class="btn-primary btn-block" data-act="close-and-go" data-to="mining">Boost your mining</button></div>`;
  }
  return `
    <form class="bm-form" data-form="withdraw" novalidate>
      <p class="bm-hint">Minimum ${min.toLocaleString('en-US')} sats. Each withdrawal is reviewed, then sent over Lightning in seconds.</p>
      <label class="bm-field"><span>Speed address or Lightning invoice</span>
        <input class="bm-input" name="destination" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="name@speed.app or lnbc…" required>
      </label>
      <label class="bm-field"><span>Amount (sats) <b class="bm-link" data-act="withdraw-max" style="font-size: 11px;">Max ${avail.toLocaleString('en-US')}</b></span>
        <input class="bm-input" name="amountSats" inputmode="numeric" placeholder="${min}" required>
      </label>
      <p class="bm-hint" data-withdraw-usd>&nbsp;</p>
      ${me?.twoFactorEnabled ? `
      <label class="bm-field"><span>Email code <b class="bm-link" data-act="withdraw-code" style="font-size: 11px;">Send code</b></span>
        <input class="bm-input" name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" required>
      </label>` : ''}
      <button class="btn-primary btn-block" type="submit">Request withdrawal</button>
      <p class="muted-note">Using another wallet? Create an invoice there for the exact amount and paste it above.</p>
    </form>`;
}

export const forms = {
  async withdraw(form, v) {
    const amountSats = Number(String(v.amountSats).replace(/[,\s]/g, ''));
    const min = state.wallet?.minWithdrawalSats ?? 2500;
    if (!v.destination) return showFieldError(form, 'Enter a Speed address or a Lightning invoice.');
    if (!Number.isInteger(amountSats) || amountSats < min) return showFieldError(form, `Enter a whole number of at least ${min.toLocaleString('en-US')} sats.`);
    if (amountSats > sats(state.wallet?.availableMsat ?? 0)) return showFieldError(form, 'That is more than your available balance.');
    try {
      await post('/v1/withdrawals', { amountSats, destination: v.destination, ...(v.code ? { code: v.code } : {}) });
    } catch (err) {
      if (err instanceof ApiError) return showFieldError(form, err.message);
      throw err;
    }
    closeSheet();
    await refresh('wallet', 'status', 'withdrawals');
    toast(`Withdrawal of ${amountSats.toLocaleString('en-US')} sats requested. We'll notify you when it's sent.`);
  },
};

export const actions = {
  async withdraw() {
    await refresh('wallet', 'me');
    openSheet('Lightning Withdrawal', withdrawSheet());
    const form = document.querySelector('[data-form="withdraw"]');
    form?.amountSats?.addEventListener('input', () => {
      const n = Number(form.amountSats.value.replace(/[,\s]/g, ''));
      form.querySelector('[data-withdraw-usd]').textContent = n > 0 ? `≈ ${fmtUsd(n * 1000, btcUsd())}` : ' ';
    });
  },
  'withdraw-max'() {
    const input = document.querySelector('[data-form="withdraw"] [name="amountSats"]');
    if (input) {
      input.value = String(sats(state.wallet?.availableMsat ?? 0));
      input.dispatchEvent(new Event('input'));
    }
  },
  async 'withdraw-code'(el) {
    await busy(el, () => post('/v1/withdrawals/code'));
    toast('Code sent to your email.');
  },
  'wallet-tab'(el, ctx) {
    walletTab = el.dataset.tab;
    ctx.rerender();
  },
  async 'ledger-more'(el, ctx) {
    const more = await get(`/v1/wallet/ledger?before=${encodeURIComponent(state.ledger.nextCursor)}`);
    state.ledger = { entries: [...state.ledger.entries, ...more.entries], nextCursor: more.nextCursor };
    ctx.rerender();
  },
};
