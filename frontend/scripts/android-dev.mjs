/**
 * Development build for a real Android phone on the same Wi-Fi as this PC.
 *
 *   npm run android:dev     → builds the web app pointing at http://<this PC's LAN IP>:4000
 *                             (DEV_API_HOST=192.168.x.x or DEV_API_URL=http://... to override),
 *                             syncs it into android/ with plain HTTP allowed, then restores
 *                             capacitor.config.json
 *   npm run android:apk     → builds android/app/build/outputs/apk/debug/app-debug.apk
 *
 * Plain HTTP and the dev claim/purchase shortcuts exist ONLY in this build.
 * Store builds use `npm run build && npx cap sync` with an HTTPS VITE_API_URL.
 * The backend must be running (npm run dev:api) with DEV_SHORTCUTS=true.
 */
import { execSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';

const ip =
  process.env.DEV_API_HOST ||
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
    .sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')))[0];

if (!ip) {
  console.error('No local network address found. Set DEV_API_HOST=192.168.x.x and try again.');
  process.exit(1);
}

// DEV_API_URL overrides everything (e.g. http://localhost:4010 with `adb reverse tcp:4010 tcp:4010` for an emulator).
const apiUrl = process.env.DEV_API_URL || `http://${ip}:4000`;
console.log(`\nDevelopment Android build → API ${apiUrl}\n`);

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

run('npx vite build', { VITE_API_URL: apiUrl, VITE_DEV_SHORTCUTS: 'true' });

const configPath = new URL('../capacitor.config.json', import.meta.url);
const original = readFileSync(configPath, 'utf8');
try {
  const cfg = JSON.parse(original);
  // http://localhost page origin so the WebView may call the PC over plain HTTP
  // (the debug manifest in android/app/src/debug allows cleartext; release builds don't).
  cfg.server = { ...(cfg.server ?? {}), androidScheme: 'http', cleartext: true };
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  run('npx cap sync android');
} finally {
  writeFileSync(configPath, original);
}

console.log(`
Done. Next:
  1. Allow Node.js through Windows Firewall on private networks if asked.
  2. npm run android:apk   (or open Android Studio: npx cap open android)
  3. Install android/app/build/outputs/apk/debug/app-debug.apk on your phone.
`);
