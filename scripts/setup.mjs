import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 22) {
  console.error(`Node 22 or newer is required; found ${process.version}.`);
  process.exit(1);
}

if (process.platform === 'darwin' && process.arch !== 'arm64') {
  console.warn(`GazeGlider is optimized for Apple Silicon; current architecture is ${process.arch}.`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal || code}).`));
    });
  });
}

try {
  await run(process.execPath, [path.join(root, 'scripts', 'prepare-assets.mjs')]);
  await run('bash', [path.join(root, 'scripts', 'build-native-helper.sh')]);
  console.log('\nGazeGlider setup complete. Run: npm run dev');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
