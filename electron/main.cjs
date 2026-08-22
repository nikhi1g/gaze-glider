'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  session,
} = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const APPLICATION_SERVER_HOST = '127.0.0.1';
const APPLICATION_SERVER_PORT = 47863;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let overlayWindow = null;
let staticServer = null;
let applicationBaseUrl = null;
let selectedDisplayId = null;
let overlayTrackingActive = false;
let calibrationActive = false;
let cursorEnabled = false;
let latestCursorMoveAt = 0;

const ALLOWED_CURSOR_STYLES = new Set(['orb', 'eyes', 'crosshair']);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'GazeCursorHelper')
    : path.join(app.getAppPath(), 'native', 'build', 'GazeCursorHelper');
}

class CursorHelper {
  constructor() {
    this.process = null;
    this.stdoutBuffer = '';
    this.nextRequestId = 1;
    this.pending = new Map();
  }

  get available() {
    return process.platform === 'darwin' && fs.existsSync(helperPath());
  }

  ensureStarted() {
    if (!this.available) return false;
    if (this.process && !this.process.killed) return true;

    try {
      this.process = spawn(helperPath(), [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.stdoutBuffer = '';
      this.process.stdout.on('data', (chunk) => this.handleStdout(chunk));
      this.process.stderr.on('data', (chunk) => {
        if (!app.isPackaged) console.error(`[GazeCursorHelper] ${String(chunk).trim()}`);
      });
      this.process.on('exit', () => {
        this.rejectPending(new Error('The native cursor helper exited.'));
        this.process = null;
      });
      this.process.on('error', (error) => {
        console.error('Cursor helper failed:', error);
        this.rejectPending(error);
        this.process = null;
      });
      return true;
    } catch (error) {
      console.error('Could not launch cursor helper:', error);
      this.process = null;
      return false;
    }
  }

  handleStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            pending.resolve(message);
          }
        } catch (error) {
          if (!app.isPackaged) console.error('Invalid cursor-helper response:', error);
        }
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  write(message) {
    if (!this.ensureStarted() || !this.process?.stdin.writable) return false;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  request(command, timeoutMs = 4000) {
    if (!this.ensureStarted()) {
      return Promise.resolve({ ok: false, trusted: false, error: 'helper-unavailable' });
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Cursor helper '${command}' request timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      if (!this.write({ id, command })) {
        clearTimeout(timeout);
        this.pending.delete(id);
        resolve({ ok: false, trusted: false, error: 'helper-unavailable' });
      }
    });
  }

  async permission(prompt) {
    try {
      const response = await this.request(prompt ? 'prompt' : 'status', prompt ? 12_000 : 4_000);
      return Boolean(response.trusted);
    } catch (error) {
      console.error('Could not check cursor-helper permission:', error);
      return false;
    }
  }

  moveNormalized(x, y, displayId) {
    this.write({ command: 'moveNormalized', x, y, displayId });
  }

  stop() {
    if (this.process && !this.process.killed) {
      try {
        this.process.stdin.write(`${JSON.stringify({ command: 'quit' })}\n`);
      } catch {
        // Ignore shutdown races.
      }
      this.process.kill();
    }
    this.rejectPending(new Error('Cursor helper stopped.'));
    this.process = null;
  }
}

const cursorHelper = new CursorHelper();

function serializeDisplay(display) {
  return {
    id: display.id,
    label: display.label || `Display ${display.id}`,
    internal: Boolean(display.internal) || /built.?in|internal/i.test(display.label || ''),
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
  };
}

function findDisplay(displayId) {
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.id === Number(displayId))
    || screen.getPrimaryDisplay();
}

function configureOverlayForDisplay(displayId) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  const display = findDisplay(displayId);
  selectedDisplayId = display.id;
  overlayWindow.setBounds(display.bounds, false);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  return display;
}

function refreshOverlayVisibility() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (calibrationActive || overlayTrackingActive) {
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
}

function sendToOverlay(channel, payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', () => {
      if (!overlayWindow?.isDestroyed()) overlayWindow.webContents.send(channel, payload);
    });
    return;
  }
  overlayWindow.webContents.send(channel, payload);
}

function validateTrackingState(payload) {
  if (!payload || !payload.point) return null;
  if (!isFiniteNumber(payload.point.x) || !isFiniteNumber(payload.point.y)) return null;
  const cursorStyle = ALLOWED_CURSOR_STYLES.has(payload.cursorStyle) ? payload.cursorStyle : 'orb';
  return {
    visible: Boolean(payload.visible),
    valid: Boolean(payload.valid),
    quality: clamp(isFiniteNumber(payload.quality) ? payload.quality : 0),
    cursorStyle,
    point: {
      x: clamp(payload.point.x),
      y: clamp(payload.point.y),
    },
  };
}

function validateCalibrationState(payload) {
  if (!payload || !payload.point) return null;
  if (!isFiniteNumber(payload.point.x) || !isFiniteNumber(payload.point.y)) return null;
  const phase = ['screen', 'head-range', 'validation'].includes(payload.phase)
    ? payload.phase
    : 'screen';
  return {
    visible: Boolean(payload.visible),
    point: { x: clamp(payload.point.x), y: clamp(payload.point.y) },
    instruction: String(payload.instruction || 'Look at the target').slice(0, 180),
    progress: clamp(isFiniteNumber(payload.progress) ? payload.progress : 0),
    index: Math.max(0, Math.floor(Number(payload.index) || 0)),
    total: Math.max(1, Math.floor(Number(payload.total) || 1)),
    phase,
  };
}

function installIpcHandlers() {
  ipcMain.handle('runtime:get-info', () => ({
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    helperAvailable: cursorHelper.available,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('display:list', () => screen.getAllDisplays().map(serializeDisplay));

  ipcMain.handle('calibration:begin', (_event, displayId) => {
    const display = configureOverlayForDisplay(displayId);
    calibrationActive = true;
    cursorEnabled = false;
    refreshOverlayVisibility();
    return {
      width: display?.bounds.width ?? 0,
      height: display?.bounds.height ?? 0,
    };
  });

  ipcMain.on('calibration:update', (_event, payload) => {
    const valid = validateCalibrationState(payload);
    if (valid) sendToOverlay('overlay:calibration', valid);
  });

  ipcMain.handle('calibration:end', () => {
    calibrationActive = false;
    sendToOverlay('overlay:calibration', {
      visible: false,
      point: { x: 0.5, y: 0.5 },
      instruction: '',
      progress: 0,
      index: 0,
      total: 1,
      phase: 'screen',
    });
    refreshOverlayVisibility();
  });

  ipcMain.handle('tracking:set-active', (_event, payload) => {
    const active = Boolean(payload?.active);
    const displayId = Number(payload?.displayId);
    configureOverlayForDisplay(displayId);
    overlayTrackingActive = active;
    if (!active) cursorEnabled = false;
    const cursorStyle = ALLOWED_CURSOR_STYLES.has(payload?.cursorStyle) ? payload.cursorStyle : 'orb';
    sendToOverlay('overlay:tracking', {
      visible: false,
      point: { x: 0.5, y: 0.5 },
      cursorStyle,
      valid: false,
      quality: 0,
    });
    refreshOverlayVisibility();
  });

  ipcMain.on('tracking:update-overlay', (_event, payload) => {
    if (!overlayTrackingActive || calibrationActive) return;
    const valid = validateTrackingState(payload);
    if (valid) sendToOverlay('overlay:tracking', valid);
  });

  ipcMain.handle('cursor:get-permission', async () => ({
    trusted: await cursorHelper.permission(false),
    helperAvailable: cursorHelper.available,
  }));

  ipcMain.handle('cursor:prompt-permission', async () => ({
    trusted: await cursorHelper.permission(true),
    helperAvailable: cursorHelper.available,
  }));

  ipcMain.handle('cursor:set-enabled', async (_event, enabled) => {
    const helperAvailable = cursorHelper.available;
    const trusted = helperAvailable ? await cursorHelper.permission(false) : false;
    cursorEnabled = Boolean(enabled) && trusted && helperAvailable && overlayTrackingActive;
    return { enabled: cursorEnabled, trusted, helperAvailable };
  });

  ipcMain.on('cursor:move', (_event, payload) => {
    if (!cursorEnabled || !overlayTrackingActive || calibrationActive) return;
    if (!payload || !isFiniteNumber(payload.x) || !isFiniteNumber(payload.y)) return;
    const now = Date.now();
    if (now - latestCursorMoveAt < 20) return;
    latestCursorMoveAt = now;

    const display = findDisplay(payload.displayId ?? selectedDisplayId);
    cursorHelper.moveNormalized(clamp(payload.x), clamp(payload.y), display.id);
  });
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
    '.task': 'application/octet-stream',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.map': 'application/json; charset=utf-8',
  }[extension] || 'application/octet-stream';
}

async function startStaticServer() {
  const root = path.join(app.getAppPath(), 'dist');
  staticServer = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
      const candidate = path.resolve(root, relativePath);
      if (!candidate.startsWith(`${path.resolve(root)}${path.sep}`) && candidate !== path.resolve(root)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      fs.stat(candidate, (statError, stat) => {
        const filePath = !statError && stat.isDirectory() ? path.join(candidate, 'index.html') : candidate;
        fs.readFile(filePath, (readError, data) => {
          if (readError) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
            return;
          }
          response.writeHead(200, {
            'Content-Type': mimeType(filePath),
            'Cache-Control': 'no-store',
            'Cross-Origin-Opener-Policy': 'same-origin',
          });
          response.end(data);
        });
      });
    } catch {
      response.writeHead(400).end('Bad request');
    }
  });

  await new Promise((resolve, reject) => {
    staticServer.once('error', reject);
    staticServer.listen(APPLICATION_SERVER_PORT, APPLICATION_SERVER_HOST, resolve);
  });
  const address = staticServer.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the local asset server.');
  return `http://${APPLICATION_SERVER_HOST}:${address.port}`;
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    try {
      const allowedOrigin = applicationBaseUrl ? new URL(applicationBaseUrl).origin : null;
      if (!allowedOrigin || new URL(url).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
}

async function createWindows() {
  const preload = path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    show: false,
    backgroundColor: '#080d16',
    title: 'GazeGlider',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    acceptFirstMouse: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  secureWindow(mainWindow);
  secureWindow(overlayWindow);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    overlayWindow = null;
    app.quit();
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  const mainUrl = `${applicationBaseUrl}/index.html`;
  const overlayUrl = `${applicationBaseUrl}/overlay.html`;
  await Promise.all([mainWindow.loadURL(mainUrl), overlayWindow.loadURL(overlayUrl)]);
  configureOverlayForDisplay(screen.getPrimaryDisplay().id);
  mainWindow.show();
}

function configurePermissions() {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const videoRequested = !details?.mediaTypes || details.mediaTypes.includes('video');
    callback(permission === 'media' && videoRequested);
  });
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    mainWindow?.webContents.send('shortcut:cursor-toggle');
  });

  globalShortcut.register('CommandOrControl+Shift+X', () => {
    cursorEnabled = false;
    overlayTrackingActive = false;
    calibrationActive = false;
    refreshOverlayVisibility();
    mainWindow?.webContents.send('shortcut:emergency-stop');
  });
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  installIpcHandlers();
  configurePermissions();
  applicationBaseUrl = process.env.VITE_DEV_SERVER_URL || await startStaticServer();
  await createWindows();
  registerShortcuts();

  screen.on('display-metrics-changed', () => {
    if (selectedDisplayId !== null) configureOverlayForDisplay(selectedDisplayId);
  });
  screen.on('display-removed', () => configureOverlayForDisplay(screen.getPrimaryDisplay().id));

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) void createWindows();
    else mainWindow.show();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cursorHelper.stop();
  staticServer?.close();
});
