import type { Point2D } from '../types';
import type { HeadPoseFeatures } from '../tracker/FeatureExtractor';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function createLandmarks(count: number): string {
  return Array.from({ length: count }, (_, index) => (
    `<span class="eye-landmark eye-landmark-${index + 1}" aria-hidden="true"></span>`
  )).join('');
}

export class EyeAvatar {
  public readonly element: HTMLElement;
  private readonly face: HTMLElement;
  private readonly eyes: HTMLElement[];
  private readonly irises: HTMLElement[];
  private readonly pupils: HTMLElement[];
  private blinkTimer: number | null = null;
  private valid = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'eye-avatar';
    this.element.innerHTML = `
      <div class="eye-avatar-glow" aria-hidden="true"></div>
      <div class="eye-avatar-face">
        <div class="eye-shell eye-shell-left">
          <div class="eye-white">
            <div class="eye-iris">
              <div class="eye-iris-ring"></div>
              <div class="eye-pupil"><span class="eye-highlight"></span></div>
            </div>
          </div>
          <div class="eye-lid eye-lid-top"></div>
          <div class="eye-lid eye-lid-bottom"></div>
          <div class="eye-landmarks">${createLandmarks(14)}</div>
        </div>
        <div class="eye-bridge" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="eye-shell eye-shell-right">
          <div class="eye-white">
            <div class="eye-iris">
              <div class="eye-iris-ring"></div>
              <div class="eye-pupil"><span class="eye-highlight"></span></div>
            </div>
          </div>
          <div class="eye-lid eye-lid-top"></div>
          <div class="eye-lid eye-lid-bottom"></div>
          <div class="eye-landmarks">${createLandmarks(14)}</div>
        </div>
      </div>
    `;

    const face = this.element.querySelector<HTMLElement>('.eye-avatar-face');
    if (!face) throw new Error('Eye avatar face could not be created.');
    this.face = face;
    this.eyes = [...this.element.querySelectorAll<HTMLElement>('.eye-shell')];
    this.irises = [...this.element.querySelectorAll<HTMLElement>('.eye-iris')];
    this.pupils = [...this.element.querySelectorAll<HTMLElement>('.eye-pupil')];
    this.scheduleAmbientBlink();
  }

  setState(point: Point2D, pose: HeadPoseFeatures | null, valid: boolean, eyesOpen = true): void {
    this.valid = valid;
    const x = clamp((point.x - 0.5) * 2, -1, 1);
    const y = clamp((point.y - 0.5) * 2, -1, 1);
    const yaw = pose ? clamp(pose.yaw, -0.45, 0.45) : 0;
    const pitch = pose ? clamp(pose.pitch, -0.35, 0.35) : 0;
    const roll = pose ? clamp(pose.roll, -0.3, 0.3) : 0;

    const irisX = clamp(x * 34 + yaw * 12, -39, 39);
    const irisY = clamp(y * 22 + pitch * 10, -26, 26);
    this.irises.forEach((iris, index) => {
      const stereoOffset = index === 0 ? -0.35 : 0.35;
      iris.style.setProperty('--iris-x', `${irisX + stereoOffset}px`);
      iris.style.setProperty('--iris-y', `${irisY}px`);
    });

    this.pupils.forEach((pupil) => {
      const dilation = valid ? 1 - Math.min(Math.hypot(x, y) * 0.08, 0.08) : 0.92;
      pupil.style.transform = `scale(${dilation.toFixed(3)})`;
    });

    this.face.style.setProperty('--face-roll', `${(roll * 8).toFixed(2)}deg`);
    this.face.style.setProperty('--face-shift-x', `${(yaw * 10).toFixed(2)}px`);
    this.face.style.setProperty('--face-shift-y', `${(pitch * 8).toFixed(2)}px`);
    this.element.classList.toggle('is-tracking', valid);
    this.element.classList.toggle('is-searching', !valid);
    this.element.classList.toggle('is-blinking', !eyesOpen);
  }

  pulse(): void {
    this.element.classList.remove('has-pulse');
    void this.element.offsetWidth;
    this.element.classList.add('has-pulse');
  }

  destroy(): void {
    if (this.blinkTimer !== null) window.clearTimeout(this.blinkTimer);
    this.element.remove();
  }

  private scheduleAmbientBlink(): void {
    const delay = 3500 + Math.random() * 4200;
    this.blinkTimer = window.setTimeout(() => {
      if (this.valid && !this.element.classList.contains('is-blinking')) {
        this.element.classList.add('ambient-blink');
        window.setTimeout(() => this.element.classList.remove('ambient-blink'), 150);
      }
      this.scheduleAmbientBlink();
    }, delay);
  }
}
