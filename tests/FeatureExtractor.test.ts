import { describe, expect, it } from 'vitest';
import type { GazeResultLike, NormalizedLandmarkLike } from '../src/types';
import { extractGazeFeatures, extractHeadPose, rawPointFromResult } from '../src/tracker/FeatureExtractor';

function result(overrides: Partial<GazeResultLike> = {}): GazeResultLike {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) as NormalizedLandmarkLike[];
  landmarks[33] = { x: 0.36, y: 0.45 };
  landmarks[263] = { x: 0.64, y: 0.46 };
  landmarks[1] = { x: 0.51, y: 0.52 };

  return {
    facialLandmarks: landmarks,
    faceRt: { rows: 4, columns: 4, data: Array(16).fill(0) },
    faceBlendshapes: [],
    eyePatch: {} as ImageData,
    headVector: [0.12, -0.08, -0.98],
    faceOrigin3D: [1.2, -0.4, 58.5],
    metric_transform: { rows: 3, columns: 3, data: Array(9).fill(0) },
    gazeState: 'open',
    normPog: [0.16, -0.21],
    durations: { total: 18 },
    timestamp: 0,
    ...overrides,
  };
}

describe('FeatureExtractor', () => {
  it('produces finite gaze and head-pose features', () => {
    const input = result();
    const raw = rawPointFromResult(input);
    const pose = extractHeadPose(input);
    const features = extractGazeFeatures(input);

    expect(raw).toEqual({ x: 0.16, y: -0.21 });
    expect(pose.originZ).toBe(58.5);
    expect(pose.faceScale).toBeGreaterThan(0.25);
    expect(features).toHaveLength(22);
    expect(features?.every(Number.isFinite)).toBe(true);
  });

  it('rejects closed-eye frames', () => {
    expect(extractGazeFeatures(result({ gazeState: 'closed' }))).toBeNull();
  });
});
