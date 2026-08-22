import type { Point2D } from '../types';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export class GazeOrb {
  private readonly container: HTMLElement;
  public readonly element: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'demo-gaze-orb';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = '<span></span><i></i>';
    this.container.append(this.element);
  }

  update(point: Point2D, valid: boolean): void {
    const bounds = this.container.getBoundingClientRect();
    const padding = 24;
    const x = padding + clamp(point.x, 0, 1) * Math.max(bounds.width - padding * 2, 0);
    const y = padding + clamp(point.y, 0, 1) * Math.max(bounds.height - padding * 2, 0);
    this.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    this.element.classList.toggle('is-valid', valid);
  }
}
