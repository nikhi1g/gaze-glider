import './overlay.css';
import type { OverlayCalibrationState, OverlayTrackingState, Point2D } from './types';

const root = document.querySelector<HTMLElement>('#overlayRoot');
if (!root) throw new Error('Overlay root was not found.');

root.innerHTML = `
  <div id="trackingLayer" class="tracking-layer" aria-hidden="true">
    <div id="overlayCursor" class="overlay-cursor cursor-orb">
      <div class="orb-cursor"><span></span><i></i></div>
      <div class="eyes-cursor">
        <div class="mini-eye"><span class="mini-iris"><i></i></span></div>
        <div class="mini-eye"><span class="mini-iris"><i></i></span></div>
      </div>
      <div class="crosshair-cursor"><span></span><i></i></div>
    </div>
  </div>
  <div id="calibrationLayer" class="calibration-layer" aria-hidden="true">
    <div class="calibration-vignette"></div>
    <div id="calibrationTarget" class="calibration-target">
      <span></span><i></i><b></b>
    </div>
    <div class="calibration-copy">
      <strong id="calibrationInstruction">Look at the target</strong>
      <div class="calibration-progress"><span id="calibrationProgress"></span></div>
      <small id="calibrationCount"></small>
    </div>
  </div>
`;

const trackingLayer = required<HTMLElement>('#trackingLayer');
const cursor = required<HTMLElement>('#overlayCursor');
const calibrationLayer = required<HTMLElement>('#calibrationLayer');
const calibrationTarget = required<HTMLElement>('#calibrationTarget');
const calibrationInstruction = required<HTMLElement>('#calibrationInstruction');
const calibrationProgress = required<HTMLElement>('#calibrationProgress');
const calibrationCount = required<HTMLElement>('#calibrationCount');
const miniIrises = [...document.querySelectorAll<HTMLElement>('.mini-iris')];

let previousPoint: Point2D = { x: 0.5, y: 0.5 };
let trackingFrame: number | null = null;
let pendingTrackingState: OverlayTrackingState | null = null;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Overlay element '${selector}' was not found.`);
  return element;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function applyTrackingState(state: OverlayTrackingState): void {
  trackingFrame = null;
  pendingTrackingState = null;
  trackingLayer.classList.toggle('is-visible', state.visible);
  cursor.className = `overlay-cursor cursor-${state.cursorStyle}`;
  cursor.classList.toggle('is-valid', state.valid);
  cursor.style.setProperty('--quality', String(clamp(state.quality)));

  const x = clamp(state.point.x) * window.innerWidth;
  const y = clamp(state.point.y) * window.innerHeight;
  const velocityX = clamp((state.point.x - previousPoint.x) * 28, -1, 1);
  const velocityY = clamp((state.point.y - previousPoint.y) * 28, -1, 1);
  cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;

  miniIrises.forEach((iris, index) => {
    const stereo = index === 0 ? -0.45 : 0.45;
    iris.style.transform = `translate(calc(-50% + ${(velocityX * 4 + stereo).toFixed(2)}px), calc(-50% + ${(velocityY * 3).toFixed(2)}px))`;
  });
  previousPoint = state.point;
}

function queueTrackingState(state: OverlayTrackingState): void {
  pendingTrackingState = state;
  if (trackingFrame !== null) return;
  trackingFrame = requestAnimationFrame(() => {
    if (pendingTrackingState) applyTrackingState(pendingTrackingState);
  });
}

function applyCalibrationState(state: OverlayCalibrationState): void {
  calibrationLayer.classList.toggle('is-visible', state.visible);
  trackingLayer.classList.toggle('is-suppressed', state.visible);
  if (!state.visible) return;

  const x = clamp(state.point.x) * window.innerWidth;
  const y = clamp(state.point.y) * window.innerHeight;
  calibrationTarget.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  calibrationTarget.dataset.phase = state.phase;
  calibrationInstruction.textContent = state.instruction;
  calibrationProgress.style.transform = `scaleX(${clamp(state.progress)})`;
  calibrationCount.textContent = state.phase === 'validation'
    ? `Accuracy check ${state.index + 1} of ${state.total}`
    : `Calibration ${state.index + 1} of ${state.total}`;
}

window.gazeGlider?.onOverlayTracking(queueTrackingState);
window.gazeGlider?.onOverlayCalibration(applyCalibrationState);
