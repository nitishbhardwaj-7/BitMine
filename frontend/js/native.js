/* ==========================================================================
   NATIVE BRIDGE — everything that differs between the phone app (Capacitor)
   and the browser. Plugins are loaded lazily so the browser build never
   needs them. Each function has a browser fallback.

   Plugins (installed in package.json, configured in capacitor.config.ts):
     @capacitor-community/admob        rewarded ads with server-side verification
     @revenuecat/purchases-capacitor   store purchases
     @capgo/capacitor-social-login     Google and Apple sign-in
     @capacitor-firebase/messaging     push notification tokens (FCM)
     @capacitor/app, browser, clipboard, share, status-bar
   ========================================================================== */

import { config } from './config.js';

export const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
export const platform = window.Capacitor?.getPlatform?.() ?? 'web';

// ── rewarded ads ──────────────────────────────────────────────────────────
let admobReady = false;

async function admob() {
  const { AdMob } = await import('@capacitor-community/admob');
  if (!admobReady) {
    await AdMob.initialize({ initializeForTesting: import.meta.env?.DEV === true });
    admobReady = true;
  }
  return AdMob;
}

/**
 * Shows a rewarded ad tied to a claim. Google then calls our server (SSV)
 * with userId + customData, which is what actually grants the hashpower.
 * Resolves true when the ad was watched to the end.
 */
export async function showRewardedAd({ adUnitId, userId, claimId }) {
  if (!isNative) return false; // browser: the caller uses the dev shortcut instead
  const AdMob = await admob();
  await AdMob.prepareRewardVideoAd({ adId: adUnitId, ssv: { userId, customData: claimId } });
  const reward = await AdMob.showRewardVideoAd();
  return Boolean(reward);
}

// ── store purchases ───────────────────────────────────────────────────────
let purchasesReady = false;

async function purchases(userId) {
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  if (!purchasesReady) {
    const apiKey = platform === 'ios' ? config.revenueCatAppleKey : config.revenueCatGoogleKey;
    if (!apiKey) throw new Error('Purchases are not set up yet.');
    await Purchases.configure({ apiKey, appUserID: userId });
    purchasesReady = true;
  } else if (userId) {
    await Purchases.logIn({ appUserID: userId });
  }
  return Purchases;
}

/** Store prices for our products, keyed by store product id (localised, e.g. "₹399"). */
export async function storePrices(userId, storeIds) {
  if (!isNative || !storeIds.length) return {};
  try {
    const Purchases = await purchases(userId);
    const { products } = await Purchases.getProducts({ productIdentifiers: storeIds, type: 'NON_SUBSCRIPTION' });
    return Object.fromEntries(products.map((p) => [p.identifier, p.priceString]));
  } catch {
    return {};
  }
}

/** Buys one product. Resolves true when the store completed the purchase (the server then verifies it). */
export async function buyProduct(userId, storeId) {
  const Purchases = await purchases(userId);
  const { products } = await Purchases.getProducts({ productIdentifiers: [storeId], type: 'NON_SUBSCRIPTION' });
  if (!products.length) throw new Error('This product is not available in your store yet.');
  try {
    await Purchases.purchaseStoreProduct({ product: products[0] });
    return true;
  } catch (err) {
    if (err?.userCancelled || err?.code === '1' || /cancel/i.test(String(err?.message))) return false;
    throw err;
  }
}

export async function signOutPurchases() {
  if (!isNative || !purchasesReady) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.logOut().catch(() => undefined);
}

// ── Google / Apple sign-in ────────────────────────────────────────────────
let socialReady = false;

async function social() {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!socialReady) {
    await SocialLogin.initialize({
      google: config.googleWebClientId ? { webClientId: config.googleWebClientId } : undefined,
      apple: {},
    });
    socialReady = true;
  }
  return SocialLogin;
}

/** Returns { idToken, name? } from Google or Apple, or null if the user cancelled. */
export async function socialSignIn(provider) {
  if (!isNative) throw new Error(`${provider === 'google' ? 'Google' : 'Apple'} sign-in works in the phone app.`);
  const SocialLogin = await social();
  try {
    const res = await SocialLogin.login({ provider, options: provider === 'apple' ? { scopes: ['email', 'name'] } : { scopes: ['email', 'profile'] } });
    const r = res?.result ?? {};
    const idToken = r.idToken ?? r.identityToken;
    if (!idToken) return null;
    const name = r.profile?.name ?? ([r.profile?.givenName, r.profile?.familyName].filter(Boolean).join(' ') || undefined);
    return { idToken, name };
  } catch (err) {
    if (/cancel/i.test(String(err?.message ?? err))) return null;
    throw err;
  }
}

// ── push notifications ────────────────────────────────────────────────────
/** Asks permission and returns the FCM token, or null. */
export async function pushToken() {
  if (!isNative) return null;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return null;
    const { token } = await FirebaseMessaging.getToken();
    return token || null;
  } catch {
    return null;
  }
}

export async function onPushTap(handler) {
  if (!isNative) return;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.addListener('notificationActionPerformed', (e) => handler(e.notification?.data ?? {}));
  } catch {
    /* plugin not available */
  }
}

// ── small helpers ─────────────────────────────────────────────────────────
export async function openUrl(url) {
  if (isNative) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export async function copyText(text) {
  if (isNative) {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
  } else {
    await navigator.clipboard?.writeText(text);
  }
}

export async function shareText({ title, text, url }) {
  if (isNative) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text, url, dialogTitle: title });
    return true;
  }
  if (navigator.share) {
    await navigator.share({ title, text, url }).catch(() => undefined);
    return true;
  }
  await copyText(`${text} ${url ?? ''}`.trim());
  return false;
}

export async function onBackButton(handler) {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', handler);
}

export async function onResume(handler) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handler();
  });
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  App.addListener('resume', handler);
}

export async function exitApp() {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  App.exitApp();
}

export async function setStatusBar(light) {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: light ? Style.Dark : Style.Light });
  } catch {
    /* not available */
  }
}

const TZ_ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'Asia/Istanbul': 'Europe/Istanbul', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
};
export const deviceTimezone = () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return TZ_ALIASES[tz] ?? tz;
};
