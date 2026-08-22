import { describe, expect, it } from 'vitest';
import { OneEuroFilter1D, OneEuroFilter2D } from '../src/tracker/OneEuroFilter';

describe('OneEuroFilter', () => {
  it('reduces stationary jitter', () => {
    const filter = new OneEuroFilter1D({ minCutoff: 1, beta: 0.04 });
    const raw: number[] = [];
    const filtered: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      const value = 0.5 + Math.sin(index * 2.1) * 0.022 + Math.cos(index * 0.77) * 0.009;
      raw.push(value);
      filtered.push(filter.filter(value, index * 16.67));
    }

    const variance = (values: number[]): number => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    };

    expect(variance(filtered.slice(20))).toBeLessThan(variance(raw.slice(20)) * 0.5);
  });

  it('tracks fast movement without becoming stuck', () => {
    const filter = new OneEuroFilter2D({ minCutoff: 1.1, beta: 0.08 });
    let output = { x: 0, y: 0 };
    for (let index = 0; index < 10; index += 1) {
      output = filter.filter({ x: 0, y: 0 }, index * 41.67);
    }
    for (let index = 10; index < 25; index += 1) {
      output = filter.filter({ x: 1, y: 1 }, index * 41.67);
    }
    expect(output.x).toBeGreaterThan(0.95);
    expect(output.y).toBeGreaterThan(0.95);
  });
});
