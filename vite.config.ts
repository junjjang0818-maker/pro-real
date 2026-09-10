import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Web demo bundler. Vitest keeps its own `vitest.config.ts`, so the unit-test
// setup is unaffected by anything here.

const ROOT = dirname(fileURLToPath(import.meta.url));

// The MediaPipe JS API and its WASM glue MUST be the same version. Read the
// actually-installed version so the CDN fallback URL can't drift out of sync
// with the bundled `@mediapipe/tasks-vision`.
let mediapipeVersion = '0.10.35';
try {
  mediapipeVersion = JSON.parse(
    readFileSync(join(ROOT, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'),
  ).version;
} catch {
  /* keep the fallback literal */
}

/**
 * Copies the version-matched MediaPipe WASM out of node_modules into
 * public/mediapipe/wasm on EVERY vite run (dev or build) — so gesture
 * recognition works regardless of whether you started with `npm run web`,
 * `npm run dev`, or a bare `vite`. The model file is committed separately.
 */
function mediapipeWasm(): Plugin {
  const src = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const dest = join(ROOT, 'public', 'mediapipe', 'wasm');
  const copy = () => {
    if (!existsSync(src)) {
      console.warn('[mediapipe] node_modules/@mediapipe/tasks-vision not found — run `npm install`.');
      return;
    }
    if (existsSync(join(dest, 'vision_wasm_internal.wasm'))) return; // already in place
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log('[mediapipe] wasm -> public/mediapipe/wasm');
  };
  return {
    name: 'mediapipe-wasm',
    buildStart: copy,
    configureServer: copy,
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasm()],
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
