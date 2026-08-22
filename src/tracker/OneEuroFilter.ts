interface OneEuroOptions {
  minCutoff?: number;
  beta?: number;
  derivativeCutoff?: number;
}

class LowPassFilter {
  private initialized = false;
  private value = 0;

  filter(next: number, alpha: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.value = next;
      return next;
    }

    this.value = alpha * next + (1 - alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.initialized = false;
    this.value = 0;
  }
}

function alpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(cutoff, 1e-4));
  return 1 / (1 + tau / Math.max(dtSeconds, 1e-4));
}

export class OneEuroFilter1D {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private readonly signal = new LowPassFilter();
  private readonly derivative = new LowPassFilter();
  private previousRaw: number | null = null;
  private previousTimestamp: number | null = null;

  constructor(options: OneEuroOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1.15;
    this.beta = options.beta ?? 0.045;
    this.derivativeCutoff = options.derivativeCutoff ?? 1;
  }

  filter(value: number, timestampMs: number): number {
    if (this.previousTimestamp === null || this.previousRaw === null) {
      this.previousTimestamp = timestampMs;
      this.previousRaw = value;
      return this.signal.filter(value, 1);
    }

    const dt = Math.max((timestampMs - this.previousTimestamp) / 1000, 1 / 240);
    const rawDerivative = (value - this.previousRaw) / dt;
    const smoothDerivative = this.derivative.filter(
      rawDerivative,
      alpha(this.derivativeCutoff, dt),
    );
    const dynamicCutoff = this.minCutoff + this.beta * Math.abs(smoothDerivative);
    const filtered = this.signal.filter(value, alpha(dynamicCutoff, dt));

    this.previousTimestamp = timestampMs;
    this.previousRaw = value;
    return filtered;
  }

  reset(): void {
    this.signal.reset();
    this.derivative.reset();
    this.previousRaw = null;
    this.previousTimestamp = null;
  }
}

export class OneEuroFilter2D {
  private readonly x: OneEuroFilter1D;
  private readonly y: OneEuroFilter1D;

  constructor(options: OneEuroOptions = {}) {
    this.x = new OneEuroFilter1D(options);
    this.y = new OneEuroFilter1D(options);
  }

  filter(point: { x: number; y: number }, timestampMs: number): { x: number; y: number } {
    return {
      x: this.x.filter(point.x, timestampMs),
      y: this.y.filter(point.y, timestampMs),
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }
}
