import type {
  CalibrationModel,
  CalibrationSample,
  GazeObservation,
  Point2D,
} from '../types';
import type { CalibrationTarget } from './CalibrationPlan';
import { percentile, predictCalibration } from './RidgeRegressor';

export interface CalibrationHooks {
  onTarget(target: CalibrationTarget, index: number, total: number, progress: number): void;
  onTargetProgress?(target: CalibrationTarget, progress: number): void;
  onMessage?(message: string): void;
}

export interface ValidationResult {
  errorsPx: number[];
  medianPx: number;
  p95Px: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Calibration cancelled.', 'AbortError'));
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Calibration cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}

function distanceInPixels(
  prediction: Point2D,
  target: Point2D,
  width: number,
  height: number,
): number {
  return Math.hypot(
    (prediction.x - target.x) * width,
    (prediction.y - target.y) * height,
  );
}

export class CalibrationSession {
  private readonly latestObservation: () => GazeObservation | null;
  private cancelled = false;

  constructor(latestObservation: () => GazeObservation | null) {
    this.latestObservation = latestObservation;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private assertActive(signal?: AbortSignal): void {
    if (this.cancelled || signal?.aborted) {
      throw new DOMException('Calibration cancelled.', 'AbortError');
    }
  }

  async collect(
    plan: readonly CalibrationTarget[],
    hooks: CalibrationHooks,
    signal?: AbortSignal,
  ): Promise<CalibrationSample[]> {
    this.cancelled = false;
    const samples: CalibrationSample[] = [];

    for (let index = 0; index < plan.length; index += 1) {
      this.assertActive(signal);
      const target = plan[index];
      if (!target) continue;

      hooks.onTarget(target, index, plan.length, index / plan.length);
      await sleep(target.settleMs, signal);

      const startedAt = performance.now();
      let lastObservationId = -1;
      let lastAcceptedAt = -Infinity;
      let targetSamples = 0;

      while (performance.now() - startedAt < target.collectMs) {
        this.assertActive(signal);
        const elapsed = performance.now() - startedAt;
        hooks.onTargetProgress?.(target, Math.min(1, elapsed / target.collectMs));

        const observation = this.latestObservation();
        if (
          observation &&
          observation.id !== lastObservationId &&
          observation.features &&
          observation.receivedAt - lastAcceptedAt >= 42
        ) {
          lastObservationId = observation.id;
          lastAcceptedAt = observation.receivedAt;
          targetSamples += 1;
          samples.push({
            features: [...observation.features],
            target: { x: target.x, y: target.y },
            phase: target.id,
          });
        }

        await sleep(12, signal);
      }

      if (targetSamples < 3) {
        hooks.onMessage?.('Tracking was briefly unstable. Hold still and keep both eyes visible.');
      }
    }

    if (samples.length < 40) {
      throw new Error(
        `Only ${samples.length} usable gaze samples were captured. Improve lighting and re-run calibration.`,
      );
    }

    return samples;
  }

  async validate(
    plan: readonly CalibrationTarget[],
    model: CalibrationModel,
    viewportWidth: number,
    viewportHeight: number,
    hooks: CalibrationHooks,
    signal?: AbortSignal,
  ): Promise<ValidationResult> {
    const errorsPx: number[] = [];

    for (let index = 0; index < plan.length; index += 1) {
      this.assertActive(signal);
      const target = plan[index];
      if (!target) continue;

      hooks.onTarget(target, index, plan.length, index / plan.length);
      await sleep(target.settleMs, signal);

      const startedAt = performance.now();
      let lastObservationId = -1;
      const pointPredictions: Point2D[] = [];

      while (performance.now() - startedAt < target.collectMs) {
        this.assertActive(signal);
        const elapsed = performance.now() - startedAt;
        hooks.onTargetProgress?.(target, Math.min(1, elapsed / target.collectMs));

        const observation = this.latestObservation();
        if (observation && observation.id !== lastObservationId && observation.features) {
          lastObservationId = observation.id;
          pointPredictions.push(predictCalibration(model, observation.features));
        }
        await sleep(12, signal);
      }

      if (pointPredictions.length > 0) {
        const prediction = pointPredictions.reduce<Point2D>(
          (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
          { x: 0, y: 0 },
        );
        prediction.x /= pointPredictions.length;
        prediction.y /= pointPredictions.length;
        errorsPx.push(
          distanceInPixels(prediction, target, viewportWidth, viewportHeight),
        );
      }
    }

    if (errorsPx.length < 3) {
      throw new Error('Validation could not collect enough stable gaze samples.');
    }

    return {
      errorsPx,
      medianPx: percentile(errorsPx, 0.5),
      p95Px: percentile(errorsPx, 0.95),
    };
  }
}
