import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
  path.join(root, 'node_modules', 'webeyetrack', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
];
const destination = path.join(root, 'public', 'mediapipe', 'wasm');

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

const source = (await Promise.all(candidates.map(async (candidate) => (
  await isDirectory(candidate) ? candidate : null
)))).find(Boolean);

if (!source) {
  console.error('MediaPipe WASM assets were not found. Run npm install before npm run setup.');
  process.exitCode = 1;
} else {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  const files = await readdir(destination);
  const wasmFiles = files.filter((file) => file.endsWith('.wasm'));
  if (wasmFiles.length === 0) {
    console.error('The MediaPipe package did not contain any WASM binaries.');
    process.exitCode = 1;
  } else {
    console.log(`✓ Copied ${files.length} MediaPipe runtime files to public/mediapipe/wasm`);
  }
}
