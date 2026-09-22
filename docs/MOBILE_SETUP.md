# BitMine mobile app: setup and release

The app is the web code in `frontend/` (your design, now wired to the backend), packaged for iOS and Android with **Capacitor**.

## Run it in a browser (development)
1. Backend: `cd backend && npm run dev:api` (with `DEV_SHORTCUTS=true` in `backend/.env`).
2. App: `cd frontend && npm run dev`, then open:
   - `http://localhost:3000` for the desktop simulator (phone frame, screen jumper, screen grid)
   - `http://localhost:3000/?device=1` for full-screen phone layout
3. Browser test mode: rewarded videos and store purchases only exist on phones. With `VITE_DEV_SHORTCUTS=true` (frontend) and `DEV_SHORTCUTS=true` (backend), claims and purchases complete through development-only backend routes. These routes never exist in production.
4. Email codes appear in the API console until Brevo is configured.

## Configuration (`frontend/.env`, all public values)
| Key | Where it comes from |
|---|---|
| `VITE_API_URL` | Your API's HTTPS URL, e.g. `https://api.bitmine.app` |
| `VITE_REVENUECAT_APPLE_KEY` / `VITE_REVENUECAT_GOOGLE_KEY` | RevenueCat → Project → API keys (public `appl_…` / `goog_…`) |
| `VITE_GOOGLE_WEB_CLIENT_ID` | Google Cloud / Firebase → OAuth *Web* client ID |
| `VITE_DEV_SHORTCUTS` | `false` for store builds |
| `VITE_APP_VERSION` | Must match the store version. The backend's minimum version forces updates |

Ad unit IDs come from the backend (admin → FAQs & app → App config), so they can change without an app update.

## Create the native projects (once)
The bundle ID in `capacitor.config.json` is `com.bitmine.app`. **Confirm or change it before this step.** It must match App Store Connect, Play Console, Firebase, RevenueCat and the backend's `APPLE_BUNDLE_ID`.

```
cd frontend
npm run build
npx cap add android
npx cap add ios        # on a Mac (needs Xcode + CocoaPods)
npx cap sync
```

Then add the platform settings the plugins need:

**Android** (`android/app/src/main/AndroidManifest.xml`, inside `<application>`):
```xml
<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXXXXXX~YYYYYYYY"/>
```
Put `google-services.json` (from Firebase) in `android/app/`.

**iOS** (`ios/App/App/Info.plist`):
- `GADApplicationIdentifier` = your AdMob iOS app ID
- `SKAdNetworkItems` (from Google's AdMob docs)
- `NSUserTrackingUsageDescription` (App Tracking Transparency text)

Also add `GoogleService-Info.plist` to the Xcode project, turn on the Push Notifications and Sign in with Apple capabilities, and upload your APNs key to Firebase.

## Build and run on a device
```
cd frontend
npm run build && npx cap sync
npx cap open android   # Android Studio → Run
npx cap open ios       # Xcode → Run (Mac only)
```

## How the native parts work
| Feature | Plugin | What the server does |
|---|---|---|
| Claims | `@capacitor-community/admob` rewarded ad with SSV (`userId`, `customData` = claim id) | Google calls `/webhooks/admob-ssv`, and the server verifies and grants |
| Purchases | `@revenuecat/purchases-capacitor` (non-renewing on iOS, consumable on Android) | App calls `/v1/store/sync`, and the server checks RevenueCat and grants |
| Google / Apple sign-in | `@capgo/capacitor-social-login` returns an ID token | `/v1/auth/social` verifies it against Google's or Apple's keys |
| Push | `@capacitor-firebase/messaging` FCM token | `/v1/push-tokens`, sent by the worker's outbox |
| Links, share, copy, back button | `@capacitor/browser`, `share`, `clipboard`, `app` | – |

## Before store submission
- `VITE_DEV_SHORTCUTS=false`, `VITE_API_URL` = production HTTPS URL
- Real AdMob ad units in admin → App config, and `app-ads.txt` on your domain
- Privacy policy and terms URLs in admin → App config (both stores require them)
- Test a real rewarded ad, a sandbox purchase (with `ALLOW_SANDBOX=true` on a staging backend only) and a small real Speed withdrawal
