import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Web demo bundler. Vitest keeps its own `vitest.config.ts`, so the unit-test
// setup is unaffected by anything here.

// The MediaPipe JS API and its WASM glue MUST be the same version. Read the
// actually-installed version so the CDN fallback URL can't drift out of sync
// with the bundled `@mediapipe/tasks-vision`.
let mediapipeVersion = '0.10.35';
try {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url)), 'utf8'),
  );
  mediapipeVersion = pkg.version;
} catch {
  /* keep the fallback literal */
}

export default defineConfig({
  plugins: [react()],
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion),
  },
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: true },
});
