import type { GazeResultLike, Point2D } from '../types';

export const FEATURE_VERSION = 'webeyetrack-head-aware-v2';

const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;
const EPSILON = 1e-8;

export interface HeadPoseFeatures {
  yaw: number;
  pitch: number;
  roll: number;
  originX: number;
  originY: number;
  originZ: number;
  faceScale: number;
  faceCenterX: number;
  faceCenterY: number;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function item(values: readonly number[], index: number): number {
  return finite(values[index]);
}

export function rawPointFromResult(result: GazeResultLike): Point2D | null {
  if (result.gazeState !== 'open') return null;

  const x = result.normPog[0];
  const y = result.normPog[1];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

export function extractHeadPose(result: GazeResultLike): HeadPoseFeatures {
  const hx = item(result.headVector, 0);
  const hy = item(result.headVector, 1);
  const hz = item(result.headVector, 2);
  const horizontalHeadMagnitude = Math.sqrt(hx * hx + hz * hz) + EPSILON;
  const yaw = Math.atan2(hx, Math.abs(hz) + EPSILON);
  const pitch = Math.atan2(-hy, horizontalHeadMagnitude);

  const leftEye = result.facialLandmarks[LEFT_EYE_OUTER];
  const rightEye = result.facialLandmarks[RIGHT_EYE_OUTER];
  const nose = result.facialLandmarks[NOSE_TIP];
  const eyeDx = finite(rightEye?.x) - finite(leftEye?.x);
  const eyeDy = finite(rightEye?.y) - finite(leftEye?.y);
  const roll = Math.atan2(eyeDy, eyeDx || EPSILON);
  const faceScale = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy);

  return {
    yaw,
    pitch,
    roll,
    originX: item(result.faceOrigin3D, 0),
    originY: item(result.faceOrigin3D, 1),
    originZ: item(result.faceOrigin3D, 2),
    faceScale,
    faceCenterX: finite(nose?.x, 0.5),
    faceCenterY: finite(nose?.y, 0.5),
  };
}

export function extractGazeFeatures(result: GazeResultLike): number[] | null {
  const raw = rawPointFromResult(result);
  if (!raw) return null;

  const pose = extractHeadPose(result);
  const {
    yaw,
    pitch,
    roll,
    originX,
    originY,
    originZ,
    faceScale,
    faceCenterX,
    faceCenterY,
  } = pose;

  const features = [
    raw.x,
    raw.y,
    raw.x * raw.x,
    raw.y * raw.y,
    raw.x * raw.y,
    yaw,
    pitch,
    roll,
    originX,
    originY,
    originZ,
    faceScale,
    faceCenterX,
    faceCenterY,
    raw.x * yaw,
    raw.y * pitch,
    raw.x * originZ,
    raw.y * originZ,
    yaw * originZ,
    pitch * originZ,
    raw.x * faceCenterX,
    raw.y * faceCenterY,
  ];

  return features.every(Number.isFinite) ? features : null;
}
