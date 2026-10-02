/* ==========================================================================
   ACCOUNT — Profile, Settings, My Account, Security & 2FA, Notification
   settings, Notifications, Help & Support (tickets) and account deletion.
   ========================================================================== */

import { post, patch, api, ApiError, auth } from '../api.js';
import { esc, header, skeleton, errorCard, emptyState, toast, listItem, openSheet, closeSheet, otpInput, bindOtp, showFieldError, chevron } from '../ui.js';
import { icons } from '../icons.js';
import { state, refresh, loadKeyed } from '../store.js';
import { fmtSats, fmtDateTime, fmtDate, timeAgo, initials } from '../format.js';
import { config } from '../config.js';
import { openUrl, deviceTimezone, platform } from '../native.js';

// ── Profile ───────────────────────────────────────────────────────────────
function profileScreen() {
  const me = state.me ?? auth.user;
  const r = state.referrals;
  return `
    <div class="screen-scroll-view animate-fade-up">
      <div class="screen-header"><h2 class="screen-title">Profile</h2>
        <button class="icon-action-btn" aria-label="Settings" data-go="settings">${icons.cog}</button>
      </div>
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="profile-user-card" data-go="account">
          <div class="profile-user-left">
            <div class="profile-avatar-circle"><div class="avatar-initials">${esc(initials(me?.name))}</div></div>
            <div class="profile-user-meta"><h3>${esc(me?.name ?? '')}</h3><p>${esc(me?.email ?? '')}</p></div>
          </div>
          <div style="color: var(--text-muted);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
        </div>

        <div class="profile-rewards-banner" data-go="rewards">
          <div>
            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85;">Referral earnings</span>
            <h3 style="font-size: 19px; font-weight: 800; margin-top: 2px;">${r ? fmtSats(r.totalEarnedMsat) : '–'}</h3>
          </div>
          <button class="btn-white">Invite</button>
        </div>

        <div class="grouped-list-section">
          ${listItem({ icon: icons.user, title: 'My Account', attrs: 'data-go="account"' })}
          ${listItem({ icon: icons.shield, title: 'Security & 2FA', attrs: 'data-go="security"', right: `<span class="badge-status ${me?.twoFactorEnabled ? 'active' : 'lavender'}">${me?.twoFactorEnabled ? 'On' : 'Off'}</span>` })}
          ${listItem({ icon: icons.miner, title: 'My Miners', attrs: 'data-go="miners"' })}
          ${listItem({ icon: icons.folder, title: 'Purchases', attrs: 'data-go="purchases"' })}
          ${listItem({ icon: icons.gift, title: 'Referral Program', attrs: 'data-go="rewards"', right: `<span class="badge-status lavender">Earn Together</span>` })}
          ${listItem({ icon: icons.bell, title: 'Notifications', attrs: 'data-go="notifications"', right: state.notifications?.unread ? `<span class="badge-status lavender">${state.notifications.unread} new</span>` : '' })}
        </div>

        <div class="grouped-list-section">
          ${listItem({ icon: icons.help, title: 'Help & Support', attrs: 'data-go="support"' })}
          ${listItem({ icon: icons.question, title: 'FAQ', attrs: 'data-go="faq"' })}
          ${listItem({ icon: icons.star, title: 'Rate BitMine', attrs: 'data-act="rate"' })}
        </div>

        <div class="grouped-list-section">
          ${listItem({ icon: icons.logout, title: 'Log Out', attrs: 'data-act="logout"', danger: true })}
        </div>
      </div>
    </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────
function settingsScreen() {
  const cfg = state.config;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Settings')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="grouped-list-section">
          ${listItem({ icon: icons.cog, title: 'Account Settings', attrs: 'data-go="account"' })}
          ${listItem({ icon: icons.shield, title: 'Security & 2FA', attrs: 'data-go="security"' })}
          ${listItem({ icon: icons.bell, title: 'Notifications', attrs: 'data-go="notification-settings"' })}
          ${listItem({ icon: icons.globe, title: 'Time zone', attrs: 'data-go="account"', right: `<span style="font-size: 13px; color: var(--text-secondary);">${esc(state.me?.timezone ?? '')}</span>` })}
        </div>
        <div class="grouped-list-section">
          ${listItem({ icon: icons.lock, title: 'Privacy Policy', attrs: cfg?.privacyUrl ? `data-act="open-url" data-url="${esc(cfg.privacyUrl)}"` : 'data-act="soon"' })}
          ${listItem({ icon: icons.file, title: 'Terms of Service', attrs: cfg?.termsUrl ? `data-act="open-url" data-url="${esc(cfg.termsUrl)}"` : 'data-act="soon"' })}
          ${listItem({ icon: icons.info, title: 'About BitMine', attrs: 'data-act="about"', right: `<span style="font-size: 13px; color: var(--color-primary-purple); font-weight: 600;">v${esc(config.appVersion)}</span>` })}
        </div>
        <div class="grouped-list-section">
          ${listItem({ icon: icons.trash, title: 'Delete Account', attrs: 'data-go="delete-account"', danger: true })}
        </div>
      </div>
    </div>`;
}

// ── My Account ────────────────────────────────────────────────────────────
function accountScreen() {
  const me = state.me;
  if (!me) return `${header('My Account')}<div class="screen-content-padding">${skeleton(4)}</div>`;
  const device = deviceTimezone();
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('My Account')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="bm-card">
          <form class="bm-form" data-form="profile" novalidate>
            <label class="bm-field"><span>Name</span><input class="bm-input" name="name" value="${esc(me.name)}" maxlength="60" required></label>
            <button class="btn-primary btn-block" type="submit">Save name</button>
          </form>
        </div>
        <div class="bm-card" style="padding: 6px 16px;"><div class="info-rows">
          <div class="info-row"><span>Email</span><strong>${esc(me.email)}</strong></div>
          <div class="info-row"><span>Referral code</span><strong>${esc(me.referralCode)}</strong></div>
          <div class="info-row"><span>Signed in with</span><strong>${me.linkedProviders?.length ? me.linkedProviders.map((p) => (p === 'google' ? 'Google' : 'Apple')).join(', ') : 'Email'}</strong></div>
        </div></div>
        <div class="grouped-list-section">
          ${listItem({ icon: icons.mail, title: 'Change email', attrs: 'data-act="change-email"' })}
        </div>
        <div class="bm-card">
          <div class="row-between"><div><h4 style="font-size: 14px; font-weight: 800;">Time zone</h4><p class="bm-hint">Claims reset at midnight in this time zone.</p></div></div>
          <div class="info-rows" style="margin-top: 6px;">
            <div class="info-row"><span>Current</span><strong>${esc(me.timezone)}</strong></div>
            ${me.timezonePending ? `<div class="info-row"><span>Changing to</span><strong>${esc(me.timezonePending.timezone)} on ${fmtDate(me.timezonePending.effectiveAt)}</strong></div>` : ''}
          </div>
          ${device !== me.timezone && !me.timezonePending ? `<button class="btn-soft btn-block" style="margin-top: 10px;" data-act="use-device-timezone">Use this device's time zone (${esc(device)})</button>
            <p class="bm-hint" style="margin-top: 6px;">You can change time zone once every 30 days. It takes effect from the next midnight.</p>` : ''}
        </div>
      </div>
    </div>`;
}

// ── Security ──────────────────────────────────────────────────────────────
function securityScreen() {
  const me = state.me;
  const on = Boolean(me?.twoFactorEnabled);
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Security & 2FA')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="security-alert-card" style="position: relative; margin: 0;">
          <div class="security-alert-left">
            <div class="shield-icon-glow">${icons.shield}</div>
            <div class="security-alert-text"><h4>Two-step verification is ${on ? 'on' : 'off'}</h4>
              <p>${on ? 'Signing in and withdrawing need a code we email you.' : 'Add a code by email when you sign in or withdraw.'}</p></div>
          </div>
          <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-act="${on ? 'disable-2fa' : 'enable-2fa'}">${on ? 'Turn off' : 'Turn on'}</button>
        </div>
        <div class="bm-card">
          <form class="bm-form" data-form="change-password" novalidate>
            <h4 style="font-size: 14px; font-weight: 800;">${me?.linkedProviders?.length ? 'Set or change password' : 'Change password'}</h4>
            <label class="bm-field"><span>Current password</span><input class="bm-input" type="password" name="currentPassword" autocomplete="current-password" placeholder="${me?.linkedProviders?.length ? 'Leave empty if you never set one' : ''}"></label>
            <label class="bm-field"><span>New password</span><input class="bm-input" type="password" name="newPassword" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
            <button class="btn-primary btn-block" type="submit">Save password</button>
            <p class="bm-hint">This signs you out on every device.</p>
          </form>
        </div>
      </div>
    </div>`;
}

// ── Notification settings ─────────────────────────────────────────────────
const PREFS = [
  ['miningReminder', 'Mining reminder', 'A nudge at 10:00 if you haven\'t started mining today.'],
  ['minerExpiry', 'Miner ending soon', '3 days before a paid miner stops.'],
  ['withdrawals', 'Withdrawals', 'When a withdrawal is sent, returned or not approved.'],
  ['support', 'Support replies', 'When we answer one of your requests.'],
];

function notificationSettingsScreen() {
  const prefs = state.me?.notificationPrefs ?? {};
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Notifications')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="grouped-list-section">
          ${PREFS.map(([key, title, sub]) => `
            <div class="grouped-list-item" style="cursor: default;">
              <div><div class="grouped-item-title">${title}</div><p class="bm-hint" style="margin-top: 2px;">${sub}</p></div>
              <label class="bm-switch"><input type="checkbox" data-pref="${key}" ${prefs[key] !== false ? 'checked' : ''}><span></span></label>
            </div>`).join('')}
        </div>
        <p class="muted-note">Announcements from BitMine are always shown in your notification list.</p>
      </div>
    </div>`;
}

// ── Notifications list ────────────────────────────────────────────────────
const KIND_ICON = {
  mining_reminder: icons.bolt, miner_expiry: icons.miner, withdrawal_paid: icons.check, withdrawal_failed: icons.refresh,
  withdrawal_rejected: icons.x, support_reply: icons.chat, announcement: icons.bell,
};

function notificationsScreen() {
  const n = state.notifications;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Notifications', { right: n?.unread ? `<button class="section-link" data-act="read-all" style="font-size: 12.5px;">Mark all read</button>` : `<button class="icon-action-btn" aria-label="Notification settings" data-go="notification-settings">${icons.cog}</button>` })}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="grouped-list-section">
          ${n == null ? `<div style="padding: 14px;">${state.errors.notifications ? errorCard(state.errors.notifications, 'reload') : skeleton(5)}</div>`
            : n.notifications.length ? n.notifications.map((x) => `
              <div class="notif-row ${x.read ? '' : 'unread'}" data-act="open-notification" data-id="${esc(x.id)}" data-kind="${esc(x.kind)}" data-ticket="${esc(x.data?.ticketId ?? '')}" data-miner="${esc(x.data?.minerId ?? '')}">
                <div class="grouped-item-icon">${KIND_ICON[x.kind] ?? icons.bell}</div>
                <div style="flex: 1;"><h4>${esc(x.title)}</h4><p>${esc(x.body)}</p><time>${timeAgo(x.createdAt)}</time></div>
                ${x.read ? '' : '<span class="unread-dot"></span>'}
              </div>`).join('')
            : emptyState('No notifications yet', "We'll let you know about withdrawals, miners and replies from support.")}
        </div>
      </div>
    </div>`;
}

// ── Support ───────────────────────────────────────────────────────────────
const TICKET_STATUS = { open: ['lavender', 'Waiting for reply'], answered: ['active', 'Answered'], closed: ['inactive', 'Closed'] };

function supportScreen() {
  const t = state.tickets;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Help & Support')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="promo-upgrade-card" data-go="faq">
          <div class="promo-left"><div class="icon-box-purple">${icons.question}</div><div class="promo-text"><h4>Quick answers</h4><p>Most questions are answered in the FAQ.</p></div></div>
          <div style="color: var(--color-primary-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
        </div>
        <button class="btn-primary btn-block" data-go="new-ticket">${icons.chat} Send us a message</button>
        <div class="section-header-row"><span class="section-title">Your requests</span></div>
        <div class="grouped-list-section">
          ${t == null ? `<div style="padding: 14px;">${state.errors.tickets ? errorCard(state.errors.tickets, 'reload') : skeleton(3)}</div>`
            : t.length ? t.map((x) => {
              const [cls, label] = TICKET_STATUS[x.status] ?? ['inactive', x.status];
              return `
              <div class="grouped-list-item" data-go="ticket" data-id="${esc(x.id)}">
                <div><div class="grouped-item-title">${esc(x.subject)}</div><p class="bm-hint" style="margin-top: 2px;">Updated ${timeAgo(x.updatedAt)}</p></div>
                <div class="grouped-item-right"><span class="badge-status ${cls}">${label}</span>${chevron}</div>
              </div>`;
            }).join('') : emptyState('No requests yet', 'Ask us anything about mining, purchases or withdrawals.')}
        </div>
      </div>
    </div>`;
}

function newTicketScreen() {
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('New request')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="bm-card">
          <form class="bm-form" data-form="new-ticket" novalidate>
            <label class="bm-field"><span>Topic</span>
              <select class="bm-input" name="category">
                <option value="withdrawal">Withdrawals</option><option value="purchase">Purchases</option>
                <option value="mining">Mining and claims</option><option value="account">My account</option><option value="other" selected>Something else</option>
              </select>
            </label>
            <label class="bm-field"><span>Subject</span><input class="bm-input" name="subject" maxlength="120" required placeholder="What's it about?"></label>
            <label class="bm-field"><span>Message</span><textarea class="bm-input" name="message" maxlength="4000" required placeholder="Tell us what happened. Include dates and amounts if it's about a payment."></textarea></label>
            <button class="btn-primary btn-block" type="submit">Send</button>
          </form>
        </div>
        <p class="muted-note">We usually reply within a day. You'll get a notification when we do.</p>
      </div>
    </div>`;
}

function ticketScreen(ctx) {
  const t = state.ticket[ctx.params.id];
  const err = state.errors[`ticket:${ctx.params.id}`];
  if (!t) return `<div class="screen-scroll-view">${header('Request')}<div class="screen-content-padding">${err ? errorCard(err) : skeleton(4)}</div></div>`;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Request')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div><h3 style="font-size: 16px; font-weight: 800;">${esc(t.subject)}</h3><p class="bm-hint">Opened ${fmtDateTime(t.createdAt)}</p></div>
        <div class="thread">
          ${t.messages.map((m) => `<div class="bubble ${m.from}">${esc(m.text)}<time>${m.from === 'admin' ? 'BitMine Support · ' : ''}${fmtDateTime(m.at)}</time></div>`).join('')}
        </div>
        ${t.status === 'closed' ? `<p class="muted-note">This request is closed. Open a new one if you still need help.</p>` : `
        <form class="bm-form" data-form="ticket-reply" novalidate>
          <textarea class="bm-input" name="text" maxlength="4000" required placeholder="Write a reply" style="min-height: 80px;"></textarea>
          <button class="btn-primary btn-block" type="submit">Send reply</button>
        </form>`}
      </div>
    </div>`;
}

// ── Purchases ─────────────────────────────────────────────────────────────
function purchasesScreen() {
  const p = state.purchases;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Purchases')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="bm-card" style="padding: 4px 16px;">
          ${p == null ? skeleton(3) : p.length ? p.map((x) => `
            <div class="tx-row">
              <div><h4>${esc(x.product?.name ?? 'Purchase')}</h4><p>${fmtDateTime(x.purchasedAt)} · ${x.store === 'app_store' ? 'App Store' : 'Google Play'}</p></div>
              <span class="badge-status ${x.status === 'granted' ? 'active' : 'inactive'}">${x.status === 'granted' ? 'Active' : 'Refunded'}</span>
            </div>`).join('') : emptyState('No purchases yet', 'Paid miners and Super Miner tiers you buy will appear here.', `<button class="btn-primary" data-go="store">Open store</button>`)}
        </div>
      </div>
    </div>`;
}

// ── Delete account ────────────────────────────────────────────────────────
function deleteAccountScreen() {
  const bal = state.wallet?.availableMsat ?? 0;
  return `
    <div class="screen-scroll-view animate-fade-up">
      ${header('Delete Account')}
      <div class="screen-content-padding" style="gap: 14px;">
        <div class="bm-card" style="border-color: var(--color-danger-border);">
          <h4 style="font-size: 15px; font-weight: 800; color: var(--color-danger);">This can't be undone</h4>
          <p class="bm-hint" style="margin-top: 6px;">Deleting your account signs you out everywhere, stops all your miners and gives up your remaining balance${bal ? ` of ${fmtSats(bal)}` : ''}. Withdraw first if you can.</p>
        </div>
        <div class="bm-card">
          <form class="bm-form" data-form="delete-account" novalidate>
            <label class="bm-field"><span>Type DELETE to confirm</span><input class="bm-input" name="confirm" autocomplete="off" required></label>
            <button class="btn-primary btn-block btn-danger" type="submit">Delete my account</button>
          </form>
        </div>
      </div>
    </div>`;
}

export const screens = {
  profile: { tab: 'profile', keys: ['me', 'referrals', 'notifications'], load: (ctx) => ctx.refresh('me', 'referrals'), render: profileScreen },
  settings: { tab: 'profile', keys: ['me', 'config'], render: settingsScreen },
  account: { tab: 'profile', keys: ['me'], load: (ctx) => ctx.refresh('me'), render: accountScreen, static: true },
  security: { tab: 'profile', keys: ['me'], render: securityScreen, static: true },
  'notification-settings': { tab: 'profile', keys: ['me'], render: notificationSettingsScreen },
  notifications: { tab: 'home', keys: ['notifications'], load: (ctx) => ctx.refresh('notifications'), render: notificationsScreen },
  support: { tab: 'profile', keys: ['tickets'], load: (ctx) => ctx.refresh('tickets'), render: supportScreen },
  'new-ticket': { tab: 'profile', render: newTicketScreen, static: true },
  ticket: { tab: 'profile', keys: ['ticket'], load: (ctx) => loadKeyed('ticket', ctx.params.id), render: ticketScreen, static: true },
  purchases: { tab: 'profile', keys: ['purchases'], load: (ctx) => ctx.refresh('purchases'), render: purchasesScreen },
  'delete-account': { tab: 'profile', keys: ['wallet'], render: deleteAccountScreen, static: true },
};

// ── forms ─────────────────────────────────────────────────────────────────
export const forms = {
  async profile(form, v) {
    if (!v.name) return showFieldError(form, 'Enter your name.');
    state.me = await patch('/v1/me', { name: v.name });
    auth.updateUser(state.me);
    toast('Name saved.');
  },
  async 'change-password'(form, v, ctx) {
    if ((v.newPassword ?? '').length < 8) return showFieldError(form, 'Use a new password of at least 8 characters.');
    await post('/v1/me/password', { currentPassword: v.currentPassword || undefined, newPassword: v.newPassword });
    toast('Password changed. Please sign in again.');
    ctx.signOut({ remote: false });
  },
  async 'new-ticket'(form, v, ctx) {
    if (!v.subject || (v.message ?? '').length < 5) return showFieldError(form, 'Add a subject and a message.');
    const t = await post('/v1/support/tickets', { category: v.category, subject: v.subject, message: v.message });
    state.ticket[t.id] = t;
    refresh('tickets');
    toast("Message sent. We'll reply here.");
    ctx.go('ticket', { id: t.id }, { replace: true });
  },
  async 'ticket-reply'(form, v, ctx) {
    if (!v.text) return showFieldError(form, 'Write a reply first.');
    state.ticket[ctx.params.id] = await post(`/v1/support/tickets/${ctx.params.id}/messages`, { text: v.text });
    ctx.rerender();
  },
  async 'delete-account'(form, v, ctx) {
    if (v.confirm !== 'DELETE') return showFieldError(form, 'Type DELETE in capitals to confirm.');
    await post('/v1/me/delete', { confirm: 'DELETE' });
    toast('Your account has been deleted.');
    ctx.signOut({ remote: false });
  },
  async 'confirm-2fa'(form, v) {
    const enable = form.dataset.enable === '1';
    if ((v.code ?? '').length !== 6) return showFieldError(form, 'Enter the 6-digit code.');
    state.me = await post(`/v1/me/2fa/${enable ? 'enable' : 'disable'}/confirm`, { code: v.code });
    auth.updateUser(state.me);
    closeSheet();
    toast(enable ? 'Two-step verification is on.' : 'Two-step verification is off.');
  },
  async 'change-email'(form, v) {
    if (!form.dataset.sent) {
      if (!v.newEmail) return showFieldError(form, 'Enter your new email.');
      await post('/v1/me/email', { newEmail: v.newEmail });
      form.dataset.sent = '1';
      form.querySelector('[data-step="code"]').hidden = false;
      form.querySelector('[name="newEmail"]').readOnly = true;
      form.querySelector('button[type="submit"]').textContent = 'Confirm new email';
      bindOtp(form);
      return toast(`Code sent to ${v.newEmail}.`);
    }
    if ((v.code ?? '').length !== 6) return showFieldError(form, 'Enter the 6-digit code.');
    state.me = await post('/v1/me/email/confirm', { newEmail: v.newEmail, code: v.code });
    auth.updateUser(state.me);
    closeSheet();
    toast('Email changed.');
  },
};

// ── actions ───────────────────────────────────────────────────────────────
function twoFactorSheet(enable) {
  openSheet(enable ? 'Turn on two-step verification' : 'Turn off two-step verification', `
    <form class="bm-form text-center" data-form="confirm-2fa" data-enable="${enable ? 1 : 0}" novalidate>
      <p class="bm-hint">We sent a 6-digit code to <strong>${esc(state.me?.email)}</strong>.</p>
      ${otpInput('code')}
      <button class="btn-primary btn-block" type="submit">${enable ? 'Turn on' : 'Turn off'}</button>
    </form>`);
  bindOtp(document.getElementById('sheetBodyContent'));
}

export const actions = {
  async 'enable-2fa'() {
    await post('/v1/me/2fa/enable');
    twoFactorSheet(true);
  },
  async 'disable-2fa'() {
    await post('/v1/me/2fa/disable');
    twoFactorSheet(false);
  },
  'change-email'() {
    openSheet('Change email', `
      <form class="bm-form" data-form="change-email" novalidate>
        <label class="bm-field"><span>New email</span><input class="bm-input" type="email" name="newEmail" required placeholder="you@example.com"></label>
        <div class="bm-field" data-step="code" hidden><span>Code sent to your new email</span>${otpInput('code')}</div>
        <button class="btn-primary btn-block" type="submit">Send code</button>
      </form>`);
  },
  async 'use-device-timezone'() {
    state.me = await post('/v1/me/timezone', { timezone: deviceTimezone() });
    toast('Time zone updated from the next midnight.');
  },
  async 'read-all'() {
    await post('/v1/notifications/read', { all: true });
    await refresh('notifications');
  },
  async 'open-notification'(el, ctx) {
    post('/v1/notifications/read', { ids: [el.dataset.id] }).then(() => refresh('notifications')).catch(() => undefined);
    const kind = el.dataset.kind;
    if (kind === 'support_reply' && el.dataset.ticket) return ctx.go('ticket', { id: el.dataset.ticket });
    if (kind === 'miner_expiry' && el.dataset.miner) return ctx.go('miner-details', { id: el.dataset.miner });
    if (kind.startsWith('withdrawal')) return ctx.go('wallet');
    if (kind === 'mining_reminder') return ctx.go('mining');
  },
  async logout(el, ctx) {
    ctx.signOut({ remote: true });
  },
  async 'open-url'(el) {
    await openUrl(el.dataset.url);
  },
  soon() {
    toast('Coming soon.');
  },
  rate() {
    const urls = state.config?.storeUrls ?? {};
    const url = platform === 'ios' ? urls.ios : urls.android;
    if (url) openUrl(url);
    else toast('Rating opens once BitMine is in the store. Thank you!');
  },
  about() {
    openSheet('About BitMine', `
      <div class="stack text-center">
        <div class="auth-logo" style="margin: 0 auto;"><img src="./assets/images/logo.png" alt="BitMine"/></div>
        <h4 style="font-size: 16px; font-weight: 800;">BitMine v${esc(config.appVersion)}</h4>
        <p class="bm-hint">Cloud Bitcoin mining rewards with Lightning withdrawals. Earnings are credited hourly and paid in sats.</p>
        ${state.config?.supportEmail ? `<p class="bm-hint">Contact: ${esc(state.config.supportEmail)}</p>` : ''}
      </div>`);
  },
  async pref(el) {
    const input = el;
    try {
      const r = await patch('/v1/me/notifications', { [input.dataset.pref]: input.checked });
      if (state.me) state.me.notificationPrefs = r.notificationPrefs;
    } catch (err) {
      input.checked = !input.checked;
      throw err;
    }
  },
};

