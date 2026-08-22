import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  {
    destination: path.join(root, 'public', 'web', 'model.json'),
    url: 'https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/main/js/examples/minimal-example/public/web/model.json',
    gitBlobSha1: '7963db6c21ef15c8d1ede988503b420960981d25',
    minimumBytes: 40_000,
  },
  {
    destination: path.join(root, 'public', 'web', 'group1-shard1of1.bin'),
    url: 'https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/main/js/examples/minimal-example/public/web/group1-shard1of1.bin',
    gitBlobSha1: '4934aeb0740d32a2b02d952d2d6ce8f229ba36b6',
    minimumBytes: 600_000,
  },
  {
    destination: path.join(root, 'public', 'mediapipe', 'face_landmarker.task'),
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    minimumBytes: 3_000_000,
  },
];

function gitBlobHash(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

async function isValidExisting(asset) {
  try {
    const info = await stat(asset.destination);
    if (info.size < asset.minimumBytes) return false;
    if (!asset.gitBlobSha1) return true;
    const buffer = await readFile(asset.destination);
    return gitBlobHash(buffer) === asset.gitBlobSha1;
  } catch {
    return false;
  }
}

async function download(asset) {
  if (await isValidExisting(asset)) {
    console.log(`✓ ${path.relative(root, asset.destination)}`);
    return;
  }

  await mkdir(path.dirname(asset.destination), { recursive: true });
  const temporary = `${asset.destination}.download`;
  await rm(temporary, { force: true });

  console.log(`↓ ${asset.url}`);
  const response = await fetch(asset.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'GazeGlider/0.1 asset installer' },
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${asset.url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < asset.minimumBytes) {
    throw new Error(`Downloaded asset is unexpectedly small: ${asset.url}`);
  }
  if (asset.gitBlobSha1 && gitBlobHash(buffer) !== asset.gitBlobSha1) {
    throw new Error(`Integrity check failed for ${asset.url}`);
  }
  if (buffer.subarray(0, 20).toString('utf8').toLowerCase().includes('<html')) {
    throw new Error(`Downloaded HTML instead of an asset: ${asset.url}`);
  }

  await writeFile(temporary, buffer, { mode: 0o644 });
  await rename(temporary, asset.destination);
  console.log(`✓ ${path.relative(root, asset.destination)} (${buffer.length.toLocaleString()} bytes)`);
}

try {
  for (const asset of assets) await download(asset);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
