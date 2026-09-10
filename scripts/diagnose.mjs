// Prints why the hand-recognition model might fail to load.
//   node scripts/diagnose.mjs
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ok = (b) => (b ? '✅' : '❌');
const row = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);
let problems = 0;

console.log('\n=== 제스처 손 인식 진단 ===\n');
row('실행 폴더', root);

try {
  const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim();
  let behind = '';
  try {
    execSync('git fetch -q origin main', { cwd: root });
    // commits on origin/main whose changes aren't in our working tree
    const n = execSync('git rev-list --count --no-merges HEAD..origin/main', { cwd: root }).toString().trim();
    behind = n === '0' ? '' : ` (origin/main 에 반영 안 된 커밋 ${n}개 — 최신 코드가 맞는지 git pull 로 확인 권장)`;
  } catch {}
  row('현재 커밋', `${sha} @ ${branch}${behind}`);
} catch {
  row('git', '⚠️  git 저장소가 아니거나 git 없음');
}

const mpPkg = join(root, 'node_modules/@mediapipe/tasks-vision/package.json');
if (existsSync(mpPkg)) {
  row('@mediapipe/tasks-vision', `${ok(true)} v${JSON.parse(readFileSync(mpPkg, 'utf8')).version}`);
} else {
  row('@mediapipe/tasks-vision', `${ok(false)} 미설치  → npm install`);
  problems++;
}

const model = join(root, 'public/mediapipe/hand_landmarker.task');
if (existsSync(model) && statSync(model).size > 1_000_000) {
  row('모델 파일', `${ok(true)} ${(statSync(model).size / 1e6).toFixed(1)} MB`);
} else {
  row('모델 파일', `${ok(false)} public/mediapipe/hand_landmarker.task 없음/손상  → git pull`);
  problems++;
}

const wasm = join(root, 'public/mediapipe/wasm/vision_wasm_internal.wasm');
row('WASM 로컬 복사', existsSync(wasm) ? `${ok(true)} 있음` : `${ok(false)} 없음  → npm run web (또는 vite) 실행 시 자동 복사`);

const viteCfg = existsSync(join(root, 'vite.config.ts')) ? readFileSync(join(root, 'vite.config.ts'), 'utf8') : '';
if (viteCfg.includes('__MEDIAPIPE_VERSION__') && viteCfg.includes('mediapipeWasm')) {
  row('vite.config 패치', `${ok(true)} 최신`);
} else {
  row('vite.config 패치', `${ok(false)} 옛날 코드  → git pull`);
  problems++;
}

console.log('');
if (problems === 0) {
  console.log('  전부 정상입니다. 그래도 안 되면 npm run web 실행 후');
  console.log('  브라우저 F12 → Console 의 [gesture] 로 시작하는 줄을 복사해 보내주세요.');
} else {
  console.log(`  ❌ ${problems}개 문제 — 위에 적힌 대로 조치 후 다시 실행하세요.`);
}
console.log('');
