/**
 * Refuses to build a store release with development settings.
 *   npm run android:release   (runs this, then vite build + cap sync)
 * Reads frontend/.env / .env.production the same way Vite does.
 */
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const f of ['.env', '.env.production', '.env.local', '.env.production.local']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const problems = [];
if (!/^https:\/\//.test(env.VITE_API_URL || '')) problems.push(`VITE_API_URL must be an https:// URL (got "${env.VITE_API_URL || ''}")`);
if (/localhost|127\.0\.0\.1|192\.168\./.test(env.VITE_API_URL || '')) problems.push('VITE_API_URL points at a development machine');
if (env.VITE_DEV_SHORTCUTS === 'true') problems.push('VITE_DEV_SHORTCUTS must be false for a release');
if (!env.VITE_REVENUECAT_GOOGLE_KEY && !env.VITE_REVENUECAT_APPLE_KEY) problems.push('No RevenueCat public key set: purchases will not work');
if (!/^\d+\.\d+\.\d+$/.test(env.VITE_APP_VERSION || '')) problems.push('VITE_APP_VERSION must look like 1.0.0');

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest) && readFileSync(manifest, 'utf8').includes('ca-app-pub-3940256099942544')) {
  problems.push(`${manifest} still has Google's TEST AdMob app ID`);
}

if (problems.length) {
  console.error('\nNot ready for a release build:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
  process.exit(1);
}
console.log('Release settings look good.');
