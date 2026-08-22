import './styles.css';
import type {
  CalibrationModel,
  DisplayInfo,
  GazeObservation,
  OverlayCalibrationState,
  OverlayCursorStyle,
  OverlayTrackingState,
  Point2D,
  RuntimeInfo,
} from './types';
import { CalibrationSession } from './tracker/CalibrationSession';
import { getCalibrationPlan, getValidationPlan, type CalibrationTarget } from './tracker/CalibrationPlan';
import {
  loadCalibration,
  removeCalibration,
  saveCalibration,
  type CalibrationIdentity,
} from './tracker/CalibrationStore';
import { extractHeadPose } from './tracker/FeatureExtractor';
import { OneEuroFilter2D } from './tracker/OneEuroFilter';
import {
  fitRobustCalibration,
  predictCalibration,
} from './tracker/RidgeRegressor';
import { WebEyeTrackerController, type TrackerState } from './tracker/WebEyeTracker';
import { EyeAvatar } from './ui/EyeAvatar';
import { GazeOrb } from './ui/GazeOrb';
import { StatusPill, type StatusTone } from './ui/StatusPill';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root was not found.');

app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <span></span><i></i>
        </div>
        <div>
          <h1>GazeGlider</h1>
          <p>On-device gaze control for macOS</p>
        </div>
      </div>
      <div class="header-actions">
        <div id="runtimeBadge" class="runtime-badge">Apple Silicon</div>
        <div id="statusHost"></div>
      </div>
    </header>

    <main class="dashboard">
      <section class="visualization-card panel">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Live visualization</span>
            <h2>Your eyes drive the element</h2>
          </div>
          <span id="liveFps" class="metric-chip">0 fps</span>
        </div>

        <div id="eyeAvatarHost" class="eye-avatar-host"></div>

        <div id="demoField" class="demo-field">
          <div class="demo-grid" aria-hidden="true"></div>
          <span class="demo-label">Gaze surface</span>
          <span id="demoHint" class="demo-hint">Start the camera to preview raw tracking</span>
        </div>

        <div class="camera-tile">
          <video id="cameraPreview" autoplay muted playsinline></video>
          <div class="camera-scanline" aria-hidden="true"></div>
          <span id="cameraLabel">Camera off</span>
        </div>

        <div class="telemetry-row" aria-label="Live tracking telemetry">
          <div><span>Yaw</span><strong id="yawValue">0.0°</strong></div>
          <div><span>Pitch</span><strong id="pitchValue">0.0°</strong></div>
          <div><span>Roll</span><strong id="rollValue">0.0°</strong></div>
          <div><span>Distance Z</span><strong id="distanceValue">—</strong></div>
          <div><span>Inference</span><strong id="latencyValue">—</strong></div>
        </div>
      </section>

      <aside class="controls-card panel">
        <div class="panel-heading compact">
          <div>
            <span class="eyebrow">Control center</span>
            <h2>Set up tracking</h2>
          </div>
        </div>

        <div class="control-section">
          <div class="section-number">1</div>
          <div class="section-content">
            <label for="displaySelect">Target display</label>
            <select id="displaySelect"></select>
            <button id="cameraButton" class="button button-primary" type="button">
              <span class="button-icon camera-icon" aria-hidden="true"></span>
              Start camera and models
            </button>
            <p class="field-note">Disable Center Stage and keep the camera near the screen center.</p>
          </div>
        </div>

        <div class="control-section">
          <div class="section-number">2</div>
          <div class="section-content">
            <div class="label-row">
              <label>Personal calibration</label>
              <span id="calibrationBadge" class="mini-badge">Not calibrated</span>
            </div>
            <button id="calibrateButton" class="button" type="button" disabled>
              Run 30-second calibration
            </button>
            <div id="calibrationMetrics" class="calibration-metrics is-empty">
              <span>Median error</span><strong>—</strong>
            </div>
            <button id="resetCalibrationButton" class="text-button" type="button" disabled>
              Delete saved calibration
            </button>
          </div>
        </div>

        <div class="control-section">
          <div class="section-number">3</div>
          <div class="section-content">
            <label for="cursorStyleSelect">Moving element</label>
            <select id="cursorStyleSelect">
              <option value="orb">Glow orb</option>
              <option value="eyes">Animated eyes</option>
              <option value="crosshair">Precision reticle</option>
            </select>
            <button id="trackingButton" class="button button-accent" type="button" disabled>
              Start desktop overlay
            </button>
          </div>
        </div>

        <div class="control-section system-cursor-section">
          <div class="section-number">4</div>
          <div class="section-content">
            <div class="label-row">
              <label for="systemCursorToggle">System mouse pointer</label>
              <span class="danger-badge">Optional</span>
            </div>
            <label class="toggle-row">
              <input id="systemCursorToggle" type="checkbox" disabled />
              <span class="toggle-control" aria-hidden="true"></span>
              <span>Move the macOS cursor with gaze</span>
            </label>
            <button id="permissionButton" class="text-button" type="button" disabled>
              Check Accessibility permission
            </button>
            <p id="cursorPermissionText" class="field-note">The overlay never clicks. Use the trackpad or keyboard to confirm actions.</p>
          </div>
        </div>

        <div class="privacy-card">
          <span class="privacy-icon" aria-hidden="true"></span>
          <div>
            <strong>Camera frames remain on this Mac</strong>
            <p>Inference runs locally. No video, landmarks, or calibration samples are uploaded.</p>
          </div>
        </div>
      </aside>
    </main>

    <footer class="app-footer">
      <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> toggle system cursor</span>
      <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>X</kbd> emergency stop</span>
      <span id="footerVersion">GazeGlider</span>
    </footer>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element '${selector}' was not found.`);
  return element;
}

const video = requiredElement<HTMLVideoElement>('#cameraPreview');
const displaySelect = requiredElement<HTMLSelectElement>('#displaySelect');
const cursorStyleSelect = requiredElement<HTMLSelectElement>('#cursorStyleSelect');
const cameraButton = requiredElement<HTMLButtonElement>('#cameraButton');
const calibrateButton = requiredElement<HTMLButtonElement>('#calibrateButton');
const trackingButton = requiredElement<HTMLButtonElement>('#trackingButton');
const resetCalibrationButton = requiredElement<HTMLButtonElement>('#resetCalibrationButton');
const systemCursorToggle = requiredElement<HTMLInputElement>('#systemCursorToggle');
const permissionButton = requiredElement<HTMLButtonElement>('#permissionButton');
const calibrationBadge = requiredElement<HTMLElement>('#calibrationBadge');
const calibrationMetrics = requiredElement<HTMLElement>('#calibrationMetrics');
const cursorPermissionText = requiredElement<HTMLElement>('#cursorPermissionText');
const cameraLabel = requiredElement<HTMLElement>('#cameraLabel');
const demoHint = requiredElement<HTMLElement>('#demoHint');
const liveFps = requiredElement<HTMLElement>('#liveFps');
const toast = requiredElement<HTMLElement>('#toast');
const yawValue = requiredElement<HTMLElement>('#yawValue');
const pitchValue = requiredElement<HTMLElement>('#pitchValue');
const rollValue = requiredElement<HTMLElement>('#rollValue');
const distanceValue = requiredElement<HTMLElement>('#distanceValue');
const latencyValue = requiredElement<HTMLElement>('#latencyValue');
const runtimeBadge = requiredElement<HTMLElement>('#runtimeBadge');
const footerVersion = requiredElement<HTMLElement>('#footerVersion');

const statusPill = new StatusPill('Initializing');
requiredElement<HTMLElement>('#statusHost').append(statusPill.element);
const eyeAvatar = new EyeAvatar();
requiredElement<HTMLElement>('#eyeAvatarHost').append(eyeAvatar.element);
const gazeOrb = new GazeOrb(requiredElement<HTMLElement>('#demoField'));

const tracker = new WebEyeTrackerController(video, 24);
const pointFilter = new OneEuroFilter2D({ minCutoff: 1.25, beta: 0.055, derivativeCutoff: 1 });

let runtimeInfo: RuntimeInfo | null = null;
let displays: DisplayInfo[] = [];
let calibrationModel: CalibrationModel | null = null;
let calibrationIdentity: CalibrationIdentity | null = null;
let calibrationInProgress = false;
let trackingActive = false;
let systemCursorEnabled = false;
let latestPoint: Point2D = { x: 0.5, y: 0.5 };
let lastObservationAt = 0;
let smoothedFps = 0;
let validStreak = 0;
let lastCursorMoveAt = 0;
let toastTimer: number | null = null;
let calibrationAbortController: AbortController | null = null;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function toDegrees(radians: number): string {
  return `${(radians * 180 / Math.PI).toFixed(1)}°`;
}

function setStatus(text: string, tone: StatusTone): void {
  statusPill.set(text, tone);
}

function showToast(message: string, tone: 'neutral' | 'good' | 'error' = 'neutral'): void {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 4200);
}

function runSafely(operation: () => Promise<void>): void {
  void operation().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!toast.classList.contains('is-visible') || toast.textContent !== message) {
      showToast(message, 'error');
    }
  });
}

function selectedDisplay(): DisplayInfo | null {
  const id = Number(displaySelect.value);
  return displays.find((display) => display.id === id) ?? displays[0] ?? null;
}

function selectedCursorStyle(): OverlayCursorStyle {
  const value = cursorStyleSelect.value;
  if (value === 'eyes' || value === 'crosshair') return value;
  return 'orb';
}

function makeCalibrationIdentity(): CalibrationIdentity | null {
  const display = selectedDisplay();
  const camera = tracker.cameraInfo;
  if (!display || !camera) return null;

  return {
    displayId: display.id,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    cameraId: camera.deviceId,
  };
}

function updateCalibrationControls(): void {
  const cameraReady = tracker.cameraInfo !== null;
  calibrateButton.disabled = !cameraReady || calibrationInProgress;
  trackingButton.disabled = !cameraReady || !calibrationModel || calibrationInProgress;
  resetCalibrationButton.disabled = !calibrationModel || calibrationInProgress;
  systemCursorToggle.disabled = !trackingActive || !calibrationModel || !runtimeInfo?.helperAvailable;
  permissionButton.disabled = !runtimeInfo?.helperAvailable;

  if (!calibrationModel) {
    calibrationBadge.textContent = 'Not calibrated';
    calibrationBadge.dataset.tone = 'neutral';
    calibrationMetrics.classList.add('is-empty');
    calibrationMetrics.innerHTML = '<span>Median error</span><strong>—</strong>';
    return;
  }

  const median = calibrationModel.metrics.validationMedianPx;
  calibrationBadge.textContent = median === null ? 'Calibrated' : median < 90 ? 'Good' : median < 160 ? 'Usable' : 'Coarse';
  calibrationBadge.dataset.tone = median !== null && median >= 160 ? 'warning' : 'good';
  calibrationMetrics.classList.remove('is-empty');
  calibrationMetrics.innerHTML = `
    <span>Validation median</span>
    <strong>${median === null ? '—' : `${Math.round(median)} px`}</strong>
    <small>${calibrationModel.metrics.retainedSampleCount} samples retained</small>
  `;
}

function loadSavedCalibration(): void {
  calibrationIdentity = makeCalibrationIdentity();
  calibrationModel = calibrationIdentity ? loadCalibration(calibrationIdentity) : null;
  pointFilter.reset();
  updateCalibrationControls();
}

async function initializeBridge(): Promise<void> {
  const bridge = window.gazeGlider;
  if (!bridge) {
    runtimeInfo = {
      platform: navigator.platform,
      arch: 'browser',
      appVersion: 'browser preview',
      helperAvailable: false,
      packaged: false,
    };
    displays = [
      {
        id: 0,
        label: 'Browser window',
        internal: true,
        scaleFactor: window.devicePixelRatio,
        bounds: { x: 0, y: 0, width: window.screen.width, height: window.screen.height },
        workArea: { x: 0, y: 0, width: window.screen.availWidth, height: window.screen.availHeight },
      },
    ];
  } else {
    [runtimeInfo, displays] = await Promise.all([
      bridge.getRuntimeInfo(),
      bridge.listDisplays(),
    ]);
  }

  displaySelect.replaceChildren();
  for (const display of displays) {
    const suffix = display.internal ? ' · built-in' : '';
    const option = new Option(
      `${display.label || `Display ${display.id}`}${suffix} · ${display.bounds.width}×${display.bounds.height}`,
      String(display.id),
    );
    displaySelect.add(option);
  }

  const internal = displays.find((display) => display.internal);
  if (internal) displaySelect.value = String(internal.id);

  runtimeBadge.textContent = runtimeInfo.arch === 'arm64' ? 'Apple Silicon native' : runtimeInfo.arch;
  runtimeBadge.dataset.ready = String(runtimeInfo.platform === 'darwin' && runtimeInfo.arch === 'arm64');
  footerVersion.textContent = `GazeGlider ${runtimeInfo.appVersion}`;
  permissionButton.disabled = !runtimeInfo.helperAvailable;
  setStatus('Ready to start', 'neutral');
  updateCalibrationControls();
}

async function ensureCameraStarted(): Promise<void> {
  if (tracker.cameraInfo) return;
  cameraButton.disabled = true;

  try {
    const info = await tracker.start();
    cameraButton.textContent = 'Camera and models ready';
    cameraButton.classList.add('is-complete');
    cameraLabel.textContent = `${info.label} · ${info.width}×${info.height}`;
    demoHint.textContent = 'Raw gaze preview active. Calibrate for screen-accurate movement.';
    loadSavedCalibration();
    updateCalibrationControls();
    showToast('Camera and gaze models loaded locally.', 'good');
  } catch (error) {
    cameraButton.disabled = false;
    const message = error instanceof Error ? error.message : String(error);
    showToast(message, 'error');
    throw error;
  }
}

function targetToOverlay(
  target: CalibrationTarget,
  index: number,
  total: number,
  pointProgress: number,
): OverlayCalibrationState {
  return {
    visible: true,
    point: { x: target.x, y: target.y },
    instruction: target.instruction,
    progress: clamp((index + pointProgress) / total),
    index,
    total,
    phase: target.phase,
  };
}

async function runCalibration(): Promise<void> {
  if (calibrationInProgress) return;
  if (!window.gazeGlider) {
    showToast('Calibration requires the Electron desktop app, not a browser tab.', 'error');
    return;
  }
  await ensureCameraStarted();
  const display = selectedDisplay();
  if (!display) throw new Error('No target display is available.');

  calibrationInProgress = true;
  calibrationAbortController = new AbortController();
  const bridge = window.gazeGlider;
  const previousTrackingState = trackingActive;
  const previousCalibrationModel = calibrationModel;
  const previousCalibrationIdentity = calibrationIdentity;

  try {
    await setTracking(false);
    await setSystemCursor(false, false);
    updateCalibrationControls();
    calibrateButton.textContent = 'Calibrating…';
    setStatus('Calibration running', 'working');
    await bridge?.beginCalibration(display.id);
    const session = new CalibrationSession(() => tracker.latestObservation);
    const plan = getCalibrationPlan();
    let currentIndex = 0;

    const samples = await session.collect(plan, {
      onTarget(target, index, total) {
        currentIndex = index;
        bridge?.updateCalibration(targetToOverlay(target, index, total, 0));
      },
      onTargetProgress(target, progress) {
        bridge?.updateCalibration(targetToOverlay(target, currentIndex, plan.length, progress));
      },
      onMessage(message) {
        showToast(message);
      },
    }, calibrationAbortController.signal);

    const fit = fitRobustCalibration(samples, {
      viewportWidth: display.bounds.width,
      viewportHeight: display.bounds.height,
      lambda: 0.055,
    });
    const candidateModel = fit.model;

    const validationPlan = getValidationPlan();
    const validation = await session.validate(
      validationPlan,
      candidateModel,
      display.bounds.width,
      display.bounds.height,
      {
        onTarget(target, index, total) {
          currentIndex = index;
          bridge?.updateCalibration(targetToOverlay(target, index, total, 0));
        },
        onTargetProgress(target, progress) {
          bridge?.updateCalibration(targetToOverlay(target, currentIndex, validationPlan.length, progress));
        },
      },
      calibrationAbortController.signal,
    );

    candidateModel.metrics.validationMedianPx = validation.medianPx;
    candidateModel.metrics.validationP95Px = validation.p95Px;
    calibrationModel = candidateModel;
    calibrationIdentity = makeCalibrationIdentity();
    if (!calibrationIdentity) throw new Error('Calibration identity could not be created.');
    saveCalibration(calibrationIdentity, calibrationModel);
    pointFilter.reset();
    eyeAvatar.pulse();

    const quality = validation.medianPx < 90 ? 'good' : validation.medianPx < 160 ? 'usable' : 'coarse';
    showToast(
      `Calibration saved: ${Math.round(validation.medianPx)} px median error (${quality}).`,
      quality === 'coarse' ? 'neutral' : 'good',
    );
    setStatus('Calibrated', quality === 'coarse' ? 'warning' : 'good');
  } catch (error) {
    calibrationModel = previousCalibrationModel;
    calibrationIdentity = previousCalibrationIdentity;
    if (error instanceof DOMException && error.name === 'AbortError') {
      setStatus(calibrationModel ? 'Calibrated' : 'Camera ready', calibrationModel ? 'good' : 'neutral');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message, 'error');
      setStatus('Calibration failed', 'error');
    }
  } finally {
    try {
      await bridge?.endCalibration();
    } finally {
      calibrationInProgress = false;
      calibrationAbortController = null;
      calibrateButton.textContent = calibrationModel ? 'Recalibrate' : 'Run 30-second calibration';
      updateCalibrationControls();
    }
    if (previousTrackingState && calibrationModel) await setTracking(true);
  }
}

async function setTracking(active: boolean): Promise<void> {
  if (active) {
    await ensureCameraStarted();
    if (!calibrationModel) {
      showToast('Run calibration before starting the desktop overlay.', 'error');
      return;
    }
  }

  const display = selectedDisplay();
  if (!display) return;
  await window.gazeGlider?.setTrackingActive({
    active,
    displayId: display.id,
    cursorStyle: selectedCursorStyle(),
  });
  trackingActive = active;
  pointFilter.reset();

  trackingButton.textContent = active ? 'Stop desktop overlay' : 'Start desktop overlay';
  trackingButton.classList.toggle('is-active', active);
  systemCursorToggle.disabled = !active || !calibrationModel || !runtimeInfo?.helperAvailable;
  if (!active) await setSystemCursor(false, false);
  setStatus(active ? 'Tracking active' : calibrationModel ? 'Calibrated' : 'Ready', active ? 'good' : 'neutral');
}

async function setSystemCursor(enabled: boolean, prompt = true): Promise<void> {
  const bridge = window.gazeGlider;
  if (!bridge || !runtimeInfo?.helperAvailable) {
    systemCursorEnabled = false;
    systemCursorToggle.checked = false;
    if (enabled) showToast('The native cursor helper is unavailable in this build.', 'error');
    return;
  }

  if (enabled && (!trackingActive || !calibrationModel)) {
    systemCursorToggle.checked = false;
    showToast('Start the calibrated overlay before enabling the system cursor.', 'error');
    return;
  }

  let permission = await bridge.getCursorPermission();
  if (enabled && !permission.trusted && prompt) {
    permission = await bridge.promptCursorPermission();
  }

  if (enabled && !permission.trusted) {
    systemCursorEnabled = false;
    systemCursorToggle.checked = false;
    cursorPermissionText.textContent = 'Accessibility permission is not enabled. Approve GazeGlider or GazeCursorHelper in System Settings, then check again.';
    showToast('Accessibility permission is required to move the macOS cursor.', 'error');
    return;
  }

  const result = await bridge.setCursorEnabled(enabled);
  systemCursorEnabled = result.enabled;
  systemCursorToggle.checked = result.enabled;
  cursorPermissionText.textContent = result.enabled
    ? 'Gaze is moving the pointer. GazeGlider never clicks automatically.'
    : result.trusted
      ? 'Accessibility permission is ready. Enable the toggle when needed.'
      : 'The overlay never clicks. Use the trackpad or keyboard to confirm actions.';
  if (result.enabled) showToast('System cursor control enabled. ⌘⇧X stops it immediately.', 'good');
}

function processObservation(observation: GazeObservation): void {
  const now = observation.receivedAt;
  if (lastObservationAt > 0) {
    const instantaneousFps = 1000 / Math.max(now - lastObservationAt, 1);
    smoothedFps = smoothedFps === 0 ? instantaneousFps : smoothedFps * 0.88 + instantaneousFps * 0.12;
  }
  lastObservationAt = now;
  liveFps.textContent = `${Math.round(smoothedFps)} fps`;

  const pose = extractHeadPose(observation.result);
  yawValue.textContent = toDegrees(pose.yaw);
  pitchValue.textContent = toDegrees(pose.pitch);
  rollValue.textContent = toDegrees(pose.roll);
  distanceValue.textContent = Number.isFinite(pose.originZ) ? `${pose.originZ.toFixed(1)} cm` : '—';
  const totalDuration = observation.result.durations.total;
  latencyValue.textContent = typeof totalDuration === 'number' && Number.isFinite(totalDuration)
    ? `${Math.round(totalDuration)} ms`
    : '—';

  const hasValidGaze = Boolean(observation.features && observation.rawNormalized);
  if (hasValidGaze) validStreak = Math.min(validStreak + 1, 30);
  else validStreak = 0;

  let predictedPoint: Point2D | null = null;
  if (observation.features && calibrationModel) {
    try {
      predictedPoint = predictCalibration(calibrationModel, observation.features);
    } catch {
      predictedPoint = null;
    }
  } else if (observation.rawNormalized) {
    predictedPoint = {
      x: observation.rawNormalized.x + 0.5,
      y: observation.rawNormalized.y + 0.5,
    };
  }

  const valid = Boolean(predictedPoint && hasValidGaze);
  if (predictedPoint) {
    const bounded = {
      x: clamp(predictedPoint.x),
      y: clamp(predictedPoint.y),
    };
    latestPoint = pointFilter.filter(bounded, now);
  }

  eyeAvatar.setState(latestPoint, pose, valid, observation.result.gazeState === 'open');
  gazeOrb.update(latestPoint, valid);
  demoHint.textContent = calibrationModel
    ? valid ? 'Calibrated point of gaze' : 'Looking for both eyes…'
    : valid ? 'Raw preview · calibration required' : 'Looking for both eyes…';

  if (!trackingActive || calibrationInProgress) return;

  const quality = clamp(validStreak / 8);
  const overlayState: OverlayTrackingState = {
    visible: valid,
    point: latestPoint,
    cursorStyle: selectedCursorStyle(),
    valid,
    quality,
  };
  window.gazeGlider?.updateOverlay(overlayState);

  if (systemCursorEnabled && valid && now - lastCursorMoveAt >= 28) {
    const display = selectedDisplay();
    if (display) {
      lastCursorMoveAt = now;
      window.gazeGlider?.moveCursor({
        x: latestPoint.x,
        y: latestPoint.y,
        displayId: display.id,
      });
    }
  }
}

tracker.onObservation(processObservation);
tracker.onState((state: TrackerState) => {
  const mapping: Record<TrackerState, [string, StatusTone]> = {
    idle: ['Ready to start', 'neutral'],
    'requesting-camera': ['Requesting camera', 'working'],
    'loading-models': ['Loading local models', 'working'],
    ready: ['Camera ready', 'good'],
    running: [trackingActive ? 'Tracking active' : 'Camera ready', 'good'],
    stopped: ['Camera stopped', 'neutral'],
    error: ['Tracking error', 'error'],
  };
  const [text, tone] = mapping[state];
  setStatus(text, tone);
});
tracker.onError((error) => {
  cameraButton.disabled = false;
  cameraButton.textContent = 'Restart camera and models';
  cameraButton.classList.remove('is-complete');
  cameraLabel.textContent = 'Camera stopped';
  updateCalibrationControls();
  showToast(error.message, 'error');
  if (trackingActive || systemCursorEnabled) {
    runSafely(async () => {
      await setSystemCursor(false, false);
      await setTracking(false);
    });
  }
});

cameraButton.addEventListener('click', () => runSafely(ensureCameraStarted));
calibrateButton.addEventListener('click', () => runSafely(runCalibration));
trackingButton.addEventListener('click', () => runSafely(() => setTracking(!trackingActive)));
systemCursorToggle.addEventListener('change', () => runSafely(() => setSystemCursor(systemCursorToggle.checked)));
permissionButton.addEventListener('click', () => runSafely(async () => {
  const permission = await window.gazeGlider?.promptCursorPermission();
  if (!permission) return;
  cursorPermissionText.textContent = permission.trusted
    ? 'Accessibility permission is ready.'
    : 'Approve GazeGlider or GazeCursorHelper in System Settings > Privacy & Security > Accessibility.';
  showToast(permission.trusted ? 'Accessibility permission is enabled.' : 'Waiting for Accessibility approval.');
}));

resetCalibrationButton.addEventListener('click', () => runSafely(async () => {
  if (calibrationIdentity) removeCalibration(calibrationIdentity);
  calibrationModel = null;
  pointFilter.reset();
  await setTracking(false);
  updateCalibrationControls();
  showToast('Saved calibration deleted.');
}));

displaySelect.addEventListener('change', () => runSafely(async () => {
  await setTracking(false);
  if (tracker.cameraInfo) loadSavedCalibration();
}));

cursorStyleSelect.addEventListener('change', () => runSafely(async () => {
  if (trackingActive) {
    const display = selectedDisplay();
    if (display) {
      await window.gazeGlider?.setTrackingActive({
        active: true,
        displayId: display.id,
        cursorStyle: selectedCursorStyle(),
      });
    }
  }
}));

window.gazeGlider?.onCursorToggleRequested(() => {
  runSafely(() => setSystemCursor(!systemCursorEnabled));
});
window.gazeGlider?.onEmergencyStop(() => {
  calibrationAbortController?.abort();
  runSafely(async () => {
    await setSystemCursor(false, false);
    await setTracking(false);
  });
  showToast('Emergency stop activated.', 'error');
});

window.addEventListener('beforeunload', () => {
  tracker.stop();
});

void initializeBridge().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus('Initialization failed', 'error');
  showToast(message, 'error');
});
