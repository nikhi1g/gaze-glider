import type { CalibrationModel } from '../types';
import { FEATURE_VERSION } from './FeatureExtractor';

const PREFIX = 'gazeGlider.calibration';

export interface CalibrationIdentity {
  displayId: number;
  width: number;
  height: number;
  scaleFactor: number;
  cameraId?: string;
}

function key(identity: CalibrationIdentity): string {
  const camera = identity.cameraId || 'default';
  return [
    PREFIX,
    identity.displayId,
    `${Math.round(identity.width)}x${Math.round(identity.height)}`,
    identity.scaleFactor.toFixed(2),
    camera,
  ].join(':');
}


function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNullableNumber(value: unknown): value is number | null {
  return value === null || finiteNumber(value);
}

function finiteArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isValidModel(value: unknown): value is CalibrationModel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CalibrationModel>;
  if (candidate.schemaVersion !== 1 || candidate.featureVersion !== FEATURE_VERSION) return false;
  if (!finiteArray(candidate.means) || !finiteArray(candidate.scales)) return false;
  if (!finiteArray(candidate.coefficientsX) || !finiteArray(candidate.coefficientsY)) return false;
  if (candidate.means.length !== candidate.scales.length) return false;
  if (candidate.coefficientsX.length !== candidate.means.length + 1) return false;
  if (candidate.coefficientsY.length !== candidate.means.length + 1) return false;
  if (candidate.scales.some((scale) => scale <= 0)) return false;
  if (!finiteNumber(candidate.lambda) || candidate.lambda < 0) return false;
  if (!candidate.metrics || typeof candidate.metrics !== 'object') return false;

  const metrics = candidate.metrics;
  if (!Number.isInteger(metrics.sampleCount) || metrics.sampleCount < 0) return false;
  if (!Number.isInteger(metrics.retainedSampleCount) || metrics.retainedSampleCount < 0) return false;
  if (!Number.isInteger(metrics.rejectedSampleCount) || metrics.rejectedSampleCount < 0) return false;
  if (metrics.retainedSampleCount + metrics.rejectedSampleCount !== metrics.sampleCount) return false;
  if (!finiteNumber(metrics.trainingRmseNormalized) || metrics.trainingRmseNormalized < 0) return false;
  if (!finiteNullableNumber(metrics.validationMedianPx) || !finiteNullableNumber(metrics.validationP95Px)) return false;
  if (metrics.validationMedianPx !== null && metrics.validationMedianPx < 0) return false;
  if (metrics.validationP95Px !== null && metrics.validationP95Px < 0) return false;
  if (typeof metrics.calibratedAt !== 'string' || Number.isNaN(Date.parse(metrics.calibratedAt))) return false;
  if (!finiteNumber(metrics.viewportWidth) || metrics.viewportWidth <= 0) return false;
  if (!finiteNumber(metrics.viewportHeight) || metrics.viewportHeight <= 0) return false;
  return true;
}

export function saveCalibration(identity: CalibrationIdentity, model: CalibrationModel): void {
  localStorage.setItem(key(identity), JSON.stringify(model));
}

export function loadCalibration(identity: CalibrationIdentity): CalibrationModel | null {
  const storageKey = key(identity);
  const serialized = localStorage.getItem(storageKey);
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isValidModel(parsed)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function removeCalibration(identity: CalibrationIdentity): void {
  localStorage.removeItem(key(identity));
}
