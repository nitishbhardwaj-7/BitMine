import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The screens reference pictures as plain "./assets/images/x.jpg" strings inside
 * JS templates, which Vite can't see, so a production build (and therefore the
 * APK) ended up with no images at all. The dev server serves them from the
 * project root; this copies the same folder into dist/ for builds.
 */
function copyImages() {
  let outDir = 'dist';
  return {
    name: 'bitmine-copy-images',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const from = resolve(__dirname, 'assets/images');
      if (existsSync(from)) cpSync(from, resolve(__dirname, outDir, 'assets/images'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [copyImages()],
  server: {
    port: 3000,
    host: true,
    watch: {
      ignored: ['**/android/**', '**/ios/**', '**/dist/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
});
