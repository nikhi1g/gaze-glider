import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'node_modules', 'webeyetrack', 'dist', 'index.js');

try {
  const original = await readFile(bundlePath, 'utf8');
  let patched = original;
  patched = patched.replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@[^"'`]+\/wasm/g,
    '/mediapipe/wasm',
  );
  patched = patched.replace(
    /https:\/\/storage\.googleapis\.com\/mediapipe-models\/face_landmarker\/face_landmarker\/float16\/1\/face_landmarker\.task/g,
    '/mediapipe/face_landmarker.task',
  );

  const hasLocalWasm = patched.includes('/mediapipe/wasm');
  const hasLocalLandmarker = patched.includes('/mediapipe/face_landmarker.task');
  if (!hasLocalWasm || !hasLocalLandmarker) {
    throw new Error('The installed WebEyeTrack bundle layout changed; local asset paths could not be patched safely.');
  }

  if (patched !== original) {
    await writeFile(bundlePath, patched);
    console.log('✓ Patched WebEyeTrack to use bundled MediaPipe assets');
  } else {
    console.log('✓ WebEyeTrack already uses bundled MediaPipe assets');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
