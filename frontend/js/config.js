/* ==========================================================================
   APP CONFIG — values come from frontend/.env (VITE_*) at build time.
   Everything here is public (it ships inside the app); never put secrets here.
   ========================================================================== */

const env = import.meta.env ?? {};

export const config = {
  apiUrl: (env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, ''),
  // RevenueCat public SDK keys (start with appl_ / goog_).
  revenueCatAppleKey: env.VITE_REVENUECAT_APPLE_KEY || '',
  revenueCatGoogleKey: env.VITE_REVENUECAT_GOOGLE_KEY || '',
  // Google sign-in: the Web client ID from Google Cloud (used by the native plugin).
  googleWebClientId: env.VITE_GOOGLE_WEB_CLIENT_ID || '',
  // Browser builds can't show rewarded ads or store purchases; in development
  // the backend's DEV_SHORTCUTS stand in for them.
  devShortcuts: env.VITE_DEV_SHORTCUTS === 'true' || (env.DEV && env.VITE_DEV_SHORTCUTS !== 'false'),
  appVersion: env.VITE_APP_VERSION || '1.0.0',
};
