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
/** Rejects if `promise` hasn't settled within `ms`: an ad network can leave a load hanging forever. */
const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

let admobReady = false;

/**
 * `testDevices` comes from the backend's app config (admin → FAQs & app). Phones
 * listed there receive Google test videos even before AdMob approves the app,
 * and their callbacks still verify claims on the server.
 * Plugins are handed back wrapped ({ AdMob }): a bare Capacitor plugin proxy returned from an
 * async function is treated as a thenable, and awaiting it hangs on Android.
 */
async function admob(testDevices = []) {
  const { AdMob } = await import('@capacitor-community/admob');
  if (!admobReady) {
    const testing = import.meta.env?.DEV === true || testDevices.length > 0;
    await withTimeout(AdMob.initialize({ initializeForTesting: testing, testingDevices: testDevices }), 15_000, 'ads did not start');
    admobReady = true;
  }
  return { AdMob };
}

/**
 * Shows a rewarded ad tied to a claim. Google then calls our server (SSV)
 * with userId + customData, which is what actually grants the hashpower.
 * Resolves true when the ad was watched to the end.
 */
export async function showRewardedAd({ adUnitId, userId, claimId, testDevices = [] }) {
  if (!isNative) return false; // browser: the caller uses the dev shortcut instead
  const { AdMob } = await admob(testDevices);
  // Loading is time-limited (the caller then hands the claim back); watching is not.
  await withTimeout(AdMob.prepareRewardVideoAd({ adId: adUnitId, ssv: { userId, customData: claimId } }), 25_000, 'no video loaded in time');
  const reward = await AdMob.showRewardVideoAd();
  return Boolean(reward);
}

// ── banner ads ────────────────────────────────────────────────────────────
// Google's sample ad units only ever show "Test Ad" banners: never put those in front of users.
const SAMPLE_UNIT = 'ca-app-pub-3940256099942544';
let bannerWanted = false;
let bannerShown = false;
let bannerMargin = 0;
let bannerQueue = Promise.resolve();

/**
 * Shows or hides the bottom banner. Calls arrive on every screen render, so
 * they are cheap when nothing changes and run one after another when it does.
 */
export function setBanner(show, { adUnitId, testDevices = [], margin = 0 } = {}) {
  if (!isNative) return;
  const usable = Boolean(adUnitId) && (!adUnitId.startsWith(SAMPLE_UNIT) || import.meta.env?.DEV === true);
  bannerWanted = Boolean(show && usable);
  if (bannerWanted === bannerShown && (!bannerWanted || margin === bannerMargin)) return;
  bannerQueue = bannerQueue
    .then(async () => {
      if (bannerWanted === bannerShown && (!bannerWanted || margin === bannerMargin)) return;
      const { AdMob } = await admob(testDevices);
      if (bannerShown) {
        await AdMob.removeBanner();
        bannerShown = false;
      }
      if (bannerWanted) {
        await withTimeout(AdMob.showBanner({ adId: adUnitId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin }), 15_000, 'banner did not load');
        bannerShown = true;
        bannerMargin = margin;
      }
    })
    .catch(() => undefined); // an unfilled banner is not an error worth showing
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
  return { Purchases };
}

/** Store prices for our products, keyed by store product id (localised, e.g. "₹399"). */
export async function storePrices(userId, storeIds, subscriptionIds = []) {
  if (!isNative || !(storeIds.length + subscriptionIds.length)) return {};
  const out = {};
  try {
    const { Purchases } = await purchases(userId);
    if (storeIds.length) {
      const { products } = await Purchases.getProducts({ productIdentifiers: storeIds, type: 'NON_SUBSCRIPTION' });
      for (const p of products) out[p.identifier] = p.priceString;
    }
    if (subscriptionIds.length) {
      const { products } = await Purchases.getProducts({ productIdentifiers: subscriptionIds, type: 'SUBSCRIPTION' });
      for (const p of products) out[subscriptionId(p.identifier)] = p.priceString;
    }
  } catch {
    /* keep whatever loaded; the list prices cover the rest */
  }
  return out;
}

/** Google Play names a subscription "productId:basePlanId"; ours are keyed by the product id. */
const subscriptionId = (identifier) => String(identifier).split(':')[0];

/** Buys one product. Resolves true when the store completed the purchase (the server then verifies it). */
export async function buyProduct(userId, storeId, subscription = false) {
  const { Purchases } = await purchases(userId);
  const { products } = await Purchases.getProducts({ productIdentifiers: [storeId], type: subscription ? 'SUBSCRIPTION' : 'NON_SUBSCRIPTION' });
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
  return { SocialLogin };
}

/** Returns { idToken, name? } from Google or Apple, or null if the user cancelled. */
export async function socialSignIn(provider) {
  if (!isNative) throw new Error(`${provider === 'google' ? 'Google' : 'Apple'} sign-in works in the phone app.`);
  const { SocialLogin } = await social();
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
