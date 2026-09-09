// Prepares local MediaPipe assets for the web demo so gesture recognition has
// NO runtime CDN dependency:
//   - copies the version-matched WASM bundle out of node_modules
//   - downloads hand_landmarker.task once (skipped if already present / offline)
// Runs before `dev` and `build`. Safe to run repeatedly. public/mediapipe is
// gitignored.
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const outDir = join(root, 'public', 'mediapipe');
const wasmDest = join(outDir, 'wasm');
const modelDest = join(outDir, 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

if (existsSync(wasmSrc)) {
  rmSync(wasmDest, { recursive: true, force: true });
  mkdirSync(wasmDest, { recursive: true });
  cpSync(wasmSrc, wasmDest, { recursive: true });
  console.log('[prep-web] MediaPipe wasm -> public/mediapipe/wasm');
} else {
  console.warn('[prep-web] @mediapipe/tasks-vision/wasm not found — run `npm install`.');
}

mkdirSync(outDir, { recursive: true });
if (existsSync(modelDest) && statSync(modelDest).size > 1_000_000) {
  console.log('[prep-web] hand_landmarker.task already present');
} else {
  try {
    process.stdout.write('[prep-web] downloading hand_landmarker.task (~7.5MB) … ');
    const res = await fetch(MODEL_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
    writeFileSync(modelDest, buf);
    console.log(`done (${(buf.length / 1e6).toFixed(1)} MB) -> public/mediapipe/hand_landmarker.task`);
  } catch (err) {
    console.warn(
      `failed (${err.message}).\n` +
        '           The app will try the Google/CDN URL at runtime. If that is also\n' +
        '           blocked, set a mirror URL in the app under 설정 → 손 인식 모델 URL 재정의,\n' +
        `           or download it manually to public/mediapipe/hand_landmarker.task:\n` +
        `             ${MODEL_URL}`,
    );
  }
}
