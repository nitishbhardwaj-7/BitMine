/* ==========================================================================
   SIGN-IN SCREENS — welcome, sign in, create account, email code, two-step
   code, forgot / reset password. Same dark hero + light card language as Home.
   ========================================================================== */

import { publicApi, ApiError } from '../api.js';
import { esc, otpInput, bindOtp, toast, showFieldError } from '../ui.js';
import { icons, googleLogo, appleLogo } from '../icons.js';
import { isNative, platform, socialSignIn, deviceTimezone } from '../native.js';

const orbs = `
  <div class="hero-liquid-lights-wrapper">
    <div class="hero-liquid-orb-1"></div><div class="hero-liquid-orb-2"></div>
    <div class="hero-liquid-orb-3"></div><div class="hero-liquid-orb-4"></div>
  </div>`;

function authLayout({ title, subtitle, card, features = false, backBtn = true }) {
  return `
    <div class="auth-screen animate-fade-up">
      <div class="auth-hero">
        ${orbs}
        <div class="auth-brand">
          ${backBtn ? `<button class="hero-icon-btn back-btn-circle" aria-label="Back" style="margin-right: 4px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg></button>` : ''}
          <div class="auth-logo"><img src="./assets/images/logo.png" alt="BitMine"/></div><span>BitMine</span>
        </div>
        <h1>${title}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
        ${features ? `
          <div class="auth-feature-list">
            <div class="auth-feature"><div class="icon-dot">${icons.bolt}</div>Earn sats every hour, even with the app closed</div>
            <div class="auth-feature"><div class="icon-dot">${icons.miner}</div>Free daily claims, Super Miner and 24/7 paid miners</div>
            <div class="auth-feature"><div class="icon-dot">${icons.send}</div>Withdraw over Lightning in seconds</div>
          </div>` : ''}
      </div>
      <div class="auth-card">${card}</div>
    </div>`;
}

const socialButtons = () =>
  isNative
    ? `
      <div class="auth-divider">or</div>
      <button class="btn-social" data-act="social" data-provider="google">${googleLogo} Continue with Google</button>
      ${platform === 'ios' ? `<button class="btn-social apple" data-act="social" data-provider="apple">${appleLogo} Continue with Apple</button>` : ''}`
    : '';

const passwordField = (name, label, autocomplete) => `
  <label class="bm-field"><span>${label}</span>
    <div class="bm-input-wrap">
      <input class="bm-input" type="password" name="${name}" autocomplete="${autocomplete}" required minlength="8" maxlength="128" placeholder="At least 8 characters">
      <button type="button" class="bm-input-action" data-act="toggle-password" aria-label="Show password">${icons.eye}</button>
    </div>
  </label>`;

export const screens = {
  welcome: {
    nav: false,
    dark: true,
    render: () =>
      authLayout({
        title: 'Cloud Bitcoin mining, made simple',
        subtitle: 'Start mining in seconds. No hardware, no setup.',
        features: true,
        backBtn: false,
        card: `
          <h2>Get started</h2>
          <button class="btn-primary btn-block" data-go="signup">Create account</button>
          <button class="btn-social" data-go="signin">I already have an account</button>
          ${socialButtons()}
          <p class="muted-note">By continuing you agree to the BitMine Terms of Service and Privacy Policy.</p>`,
      }),
  },

  signin: {
    nav: false,
    dark: true,
    render: (ctx) =>
      authLayout({
        title: 'Welcome back',
        subtitle: 'Sign in to check on your miners.',
        card: `
          <h2>Sign in</h2>
          <form class="bm-form" data-form="signin" novalidate>
            <label class="bm-field"><span>Email</span>
              <input class="bm-input" type="email" name="email" autocomplete="email" required value="${esc(ctx.params.email ?? '')}" placeholder="you@example.com">
            </label>
            ${passwordField('password', 'Password', 'current-password')}
            <div style="text-align: right; margin-top: -6px;"><span class="bm-link" style="font-size: 12.5px;" data-go="forgot">Forgot password?</span></div>
            <button class="btn-primary btn-block" type="submit">Sign in</button>
          </form>
          ${socialButtons()}
          <p class="auth-footer">New to BitMine? <span class="bm-link" data-go="signup">Create an account</span></p>`,
      }),
  },

  signup: {
    nav: false,
    dark: true,
    render: () =>
      authLayout({
        title: 'Create your account',
        subtitle: 'Your first miners are free. Claim them every day.',
        card: `
          <h2>Create account</h2>
          <form class="bm-form" data-form="signup" novalidate>
            <label class="bm-field"><span>Name</span>
              <input class="bm-input" name="name" autocomplete="name" required maxlength="60" placeholder="Your name">
            </label>
            <label class="bm-field"><span>Email</span>
              <input class="bm-input" type="email" name="email" autocomplete="email" required placeholder="you@example.com">
            </label>
            ${passwordField('password', 'Password', 'new-password')}
            <label class="bm-field"><span>Referral code <em style="font-style: normal; text-transform: none; font-weight: 600;">(optional)</em></span>
              <input class="bm-input" name="referralCode" autocomplete="off" maxlength="16" placeholder="e.g. 7KQ2M9XA" style="text-transform: uppercase;">
            </label>
            <button class="btn-primary btn-block" type="submit">Create account</button>
          </form>
          ${socialButtons()}
          <p class="muted-note">By creating an account you agree to the BitMine Terms of Service and Privacy Policy.</p>
          <p class="auth-footer">Already have an account? <span class="bm-link" data-go="signin">Sign in</span></p>`,
      }),
  },

  verify: {
    nav: false,
    dark: true,
    render: (ctx) =>
      authLayout({
        title: 'Check your email',
        subtitle: `We sent a 6-digit code to ${esc(ctx.params.email)}.`,
        card: `
          <h2>Enter your code</h2>
          <p class="auth-sub">The code expires in 10 minutes.</p>
          <form class="bm-form" data-form="verify" novalidate>
            ${otpInput('code')}
            <button class="btn-primary btn-block" type="submit">Verify email</button>
          </form>
          <p class="auth-footer">Didn't get it? <span class="bm-link" data-act="resend-verification">Send a new code</span></p>`,
      }),
    after: (root) => bindOtp(root),
  },

  twofa: {
    nav: false,
    dark: true,
    render: (ctx) =>
      authLayout({
        title: 'Two-step verification',
        subtitle: `Enter the code we sent to ${esc(ctx.params.email)}.`,
        card: `
          <h2>Sign-in code</h2>
          <p class="auth-sub">This keeps your sats safe even if someone knows your password.</p>
          <form class="bm-form" data-form="twofa" novalidate>
            ${otpInput('code')}
            <button class="btn-primary btn-block" type="submit">Continue</button>
          </form>`,
      }),
    after: (root) => bindOtp(root),
  },

  forgot: {
    nav: false,
    dark: true,
    render: () =>
      authLayout({
        title: 'Reset your password',
        subtitle: "We'll email you a code to set a new one.",
        card: `
          <h2>Forgot password</h2>
          <form class="bm-form" data-form="forgot" novalidate>
            <label class="bm-field"><span>Email</span>
              <input class="bm-input" type="email" name="email" autocomplete="email" required placeholder="you@example.com">
            </label>
            <button class="btn-primary btn-block" type="submit">Send code</button>
          </form>`,
      }),
  },

  reset: {
    nav: false,
    dark: true,
    render: (ctx) =>
      authLayout({
        title: 'Choose a new password',
        subtitle: `Enter the code sent to ${esc(ctx.params.email)} and your new password.`,
        card: `
          <h2>New password</h2>
          <form class="bm-form" data-form="reset" novalidate>
            <div class="bm-field"><span>Code</span>${otpInput('code')}</div>
            ${passwordField('newPassword', 'New password', 'new-password')}
            <button class="btn-primary btn-block" type="submit">Save password</button>
          </form>
          <p class="muted-note">For your security, this signs you out on every device.</p>`,
      }),
    after: (root) => bindOtp(root),
  },
};

/** Where a sign-in response leads: a session, or a 2FA challenge. */
function handleSession(res, ctx) {
  if (res.twoFactorRequired) return ctx.go('twofa', { email: res.email, challengeId: res.challengeId }, { replace: true });
  return ctx.signedIn(res);
}

export const forms = {
  async signin(form, v, ctx) {
    if (!v.email || !v.password) return showFieldError(form, 'Enter your email and password.');
    try {
      handleSession(await publicApi('POST', '/v1/auth/login', { email: v.email, password: v.password, deviceId: ctx.deviceId }), ctx);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_not_verified') {
        toast(err.message);
        return ctx.go('verify', { email: v.email });
      }
      throw err;
    }
  },

  async signup(form, v, ctx) {
    if (!v.name || !v.email) return showFieldError(form, 'Enter your name and email.');
    if ((v.password ?? '').length < 8) return showFieldError(form, 'Use a password of at least 8 characters.');
    await publicApi('POST', '/v1/auth/register', {
      name: v.name,
      email: v.email,
      password: v.password,
      timezone: deviceTimezone(),
      referralCode: v.referralCode ? v.referralCode.toUpperCase() : undefined,
    });
    ctx.go('verify', { email: v.email });
  },

  async verify(form, v, ctx) {
    if ((v.code ?? '').length !== 6) return showFieldError(form, 'Enter all 6 digits.');
    ctx.signedIn(await publicApi('POST', '/v1/auth/verify-email', { email: ctx.params.email, code: v.code, deviceId: ctx.deviceId }));
  },

  async twofa(form, v, ctx) {
    if ((v.code ?? '').length !== 6) return showFieldError(form, 'Enter all 6 digits.');
    ctx.signedIn(await publicApi('POST', '/v1/auth/2fa/verify', { email: ctx.params.email, challengeId: ctx.params.challengeId, code: v.code, deviceId: ctx.deviceId }));
  },

  async forgot(form, v, ctx) {
    if (!v.email) return showFieldError(form, 'Enter your email.');
    await publicApi('POST', '/v1/auth/password/forgot', { email: v.email });
    ctx.go('reset', { email: v.email });
  },

  async reset(form, v, ctx) {
    if ((v.code ?? '').length !== 6) return showFieldError(form, 'Enter the 6-digit code.');
    if ((v.newPassword ?? '').length < 8) return showFieldError(form, 'Use a password of at least 8 characters.');
    await publicApi('POST', '/v1/auth/password/reset', { email: ctx.params.email, code: v.code, newPassword: v.newPassword });
    toast('Password saved. Sign in with your new password.');
    ctx.go('signin', { email: ctx.params.email }, { replace: true });
  },
};

export const actions = {
  'toggle-password'(el) {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.innerHTML = show ? icons.eyeOff : icons.eye;
  },

  async 'resend-verification'(el, ctx) {
    await publicApi('POST', '/v1/auth/resend-verification', { email: ctx.params.email });
    toast('A new code is on its way.');
  },

  async social(el, ctx) {
    const provider = el.dataset.provider;
    const res = await socialSignIn(provider);
    if (!res) return;
    handleSession(
      await publicApi('POST', '/v1/auth/social', { provider, idToken: res.idToken, name: res.name, timezone: deviceTimezone(), deviceId: ctx.deviceId }),
      ctx,
    );
  },
};
