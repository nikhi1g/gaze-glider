import { describe, expect, it } from 'vitest';
import type { CalibrationSample } from '../src/types';
import { fitRobustCalibration, predictCalibration } from '../src/tracker/RidgeRegressor';

function featuresFor(x: number, y: number, index: number): number[] {
  const yaw = (index % 7 - 3) * 0.018;
  const pitch = (index % 5 - 2) * 0.014;
  const z = 55 + (index % 9 - 4) * 0.7;
  const rawX = x * 0.86 - 0.43 + yaw * 0.25;
  const rawY = y * 0.82 - 0.41 + pitch * 0.22;
  return [
    rawX,
    rawY,
    rawX * rawX,
    rawY * rawY,
    rawX * rawY,
    yaw,
    pitch,
    0.005,
    0.1,
    -0.2,
    z,
    0.31,
    0.5,
    0.5,
    rawX * yaw,
    rawY * pitch,
    rawX * z,
    rawY * z,
    yaw * z,
    pitch * z,
    rawX * 0.5,
    rawY * 0.5,
  ];
}

describe('fitRobustCalibration', () => {
  it('recovers a head-aware screen mapping and rejects a gross outlier', () => {
    const samples: CalibrationSample[] = [];
    let index = 0;
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 9; column += 1) {
        const x = 0.05 + column * 0.1125;
        const y = 0.06 + row * 0.146;
        samples.push({
          features: featuresFor(x, y, index),
          target: { x, y },
          phase: `point-${index}`,
        });
        index += 1;
      }
    }

    samples.push({
      features: featuresFor(0.5, 0.5, 999),
      target: { x: 0.98, y: 0.02 },
      phase: 'intentional-outlier',
    });

    const { model } = fitRobustCalibration(samples, {
      viewportWidth: 1728,
      viewportHeight: 1117,
    });

    const prediction = predictCalibration(model, featuresFor(0.73, 0.31, 121));
    expect(Math.abs(prediction.x - 0.73)).toBeLessThan(0.035);
    expect(Math.abs(prediction.y - 0.31)).toBeLessThan(0.035);
    expect(model.metrics.rejectedSampleCount).toBeGreaterThanOrEqual(1);
  });
});
