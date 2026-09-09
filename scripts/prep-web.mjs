// Copies the version-matched MediaPipe WASM bundle out of node_modules so the
// web demo loads it locally (no CDN / no version-skew). Runs before `dev` and
// `build`. Safe to run repeatedly; a no-op if the package isn't installed.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.warn(
    '[prep-web] @mediapipe/tasks-vision/wasm not found — run `npm install`.\n' +
      '           Gesture recognition will fall back to the jsDelivr CDN at runtime.',
  );
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[prep-web] MediaPipe wasm -> public/mediapipe/wasm');
