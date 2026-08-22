import { spawn } from 'node:child_process';
import process from 'node:process';

const children = new Set();
let shuttingDown = false;

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    ...options,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${signal || code}.`));
    });
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 1200).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await waitForExit(spawnChild(process.execPath, ['scripts/setup.mjs']), 'setup');
  const vite = spawnChild('npm', ['run', 'dev:web']);
  await waitForServer('http://127.0.0.1:5173');
  const electron = spawnChild('npm', ['run', 'electron:dev'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  });
  electron.once('exit', (code) => shutdown(code || 0));
  vite.once('exit', (code) => {
    if (!shuttingDown) shutdown(code || 1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
