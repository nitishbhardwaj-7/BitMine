/** Builds the debug APK, using Android Studio's bundled Java 21 when JAVA_HOME isn't Java 21. */
import { execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const candidates = [process.env.JAVA_HOME, 'C:/Program Files/Android/Android Studio/jbr', '/Applications/Android Studio.app/Contents/jbr/Contents/Home'].filter(Boolean);
// java -version prints to stderr; spawn it directly (no shell quoting issues with spaces).
const javaVersion = (home) => {
  const r = spawnSync(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), ['-version'], { encoding: 'utf8' });
  return `${r.stderr ?? ''}${r.stdout ?? ''}`;
};
const javaHome = candidates.find((h) => existsSync(h) && /version "2[1-9]/.test(javaVersion(h)));
if (!javaHome) {
  console.error('Java 21 not found. Install Android Studio (it bundles Java 21) or set JAVA_HOME to a JDK 21.');
  process.exit(1);
}
const androidDir = fileURLToPath(new URL('../android', import.meta.url));
const gradlew = process.platform === 'win32' ? `"${join(androidDir, 'gradlew.bat')}"` : './gradlew';
execSync(`${gradlew} assembleDebug`, { cwd: androidDir, stdio: 'inherit', shell: true, env: { ...process.env, JAVA_HOME: javaHome } });
console.log('\nAPK: android/app/build/outputs/apk/debug/app-debug.apk');
