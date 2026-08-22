import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed (${signal || code}).`));
    });
  });
}

try {
  await run('fetch-webeyetrack-models.mjs');
  await run('copy-mediapipe-wasm.mjs');
  await run('patch-webeyetrack.mjs');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
