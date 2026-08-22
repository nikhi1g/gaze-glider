import type {
  CalibrationMetrics,
  CalibrationModel,
  CalibrationSample,
  Point2D,
} from '../types';
import { FEATURE_VERSION } from './FeatureExtractor';

interface FitOptions {
  lambda?: number;
  viewportWidth: number;
  viewportHeight: number;
  calibratedAt?: string;
}

interface FitResult {
  model: CalibrationModel;
  retainedSamples: CalibrationSample[];
}

const SCALE_EPSILON = 1e-4;
const NORMALIZED_FEATURE_LIMIT = 8;
const PIVOT_EPSILON = 1e-10;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] ?? upper;
  return (lower + upper) / 2;
}

function computeNormalization(samples: readonly CalibrationSample[]): {
  means: number[];
  scales: number[];
} {
  const featureCount = samples[0]?.features.length ?? 0;
  const means = Array<number>(featureCount).fill(0);
  const sumsOfSquares = Array<number>(featureCount).fill(0);

  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      means[index] = (means[index] ?? 0) + (sample.features[index] ?? 0);
    }
  }

  for (let index = 0; index < featureCount; index += 1) {
    means[index] = (means[index] ?? 0) / samples.length;
  }

  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      const delta = (sample.features[index] ?? 0) - (means[index] ?? 0);
      sumsOfSquares[index] = (sumsOfSquares[index] ?? 0) + delta * delta;
    }
  }

  const scales = sumsOfSquares.map((sum) => {
    const variance = sum / Math.max(samples.length - 1, 1);
    const standardDeviation = Math.sqrt(variance);
    return standardDeviation >= SCALE_EPSILON ? standardDeviation : 1;
  });

  return { means, scales };
}


function normalizeFeature(value: number, mean: number, scale: number): number {
  const normalized = (value - mean) / scale;
  return Math.min(Math.max(normalized, -NORMALIZED_FEATURE_LIMIT), NORMALIZED_FEATURE_LIMIT);
}

function makeDesignRows(
  samples: readonly CalibrationSample[],
  means: readonly number[],
  scales: readonly number[],
): number[][] {
  return samples.map((sample) => [
    1,
    ...sample.features.map((value, index) => {
      const mean = means[index] ?? 0;
      const scale = scales[index] ?? 1;
      return normalizeFeature(value, mean, scale);
    }),
  ]);
}

/**
 * Solves a dense linear system using Gaussian elimination with partial pivoting.
 * Calibration matrices are small (currently 23x23 including the intercept), so
 * this avoids shipping another numerical dependency while remaining stable once
 * ridge regularization is applied.
 */
function solveLinearSystem(matrix: number[][], rhs: readonly number[]): number[] {
  const size = matrix.length;
  if (size === 0 || rhs.length !== size || matrix.some((row) => row.length !== size)) {
    throw new Error('Invalid linear system dimensions.');
  }

  const augmented = matrix.map((row, index) => [
    ...row,
    rhs[index] ?? 0,
  ]);

  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotMagnitude = Math.abs(augmented[pivotRow]?.[pivotColumn] ?? 0);

    for (let row = pivotColumn + 1; row < size; row += 1) {
      const magnitude = Math.abs(augmented[row]?.[pivotColumn] ?? 0);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = row;
      }
    }

    if (pivotMagnitude < PIVOT_EPSILON) {
      throw new Error('Calibration system is singular. Re-run calibration with more head movement.');
    }

    if (pivotRow !== pivotColumn) {
      const temporary = augmented[pivotColumn];
      augmented[pivotColumn] = augmented[pivotRow] ?? [];
      augmented[pivotRow] = temporary ?? [];
    }

    const pivot = augmented[pivotColumn]?.[pivotColumn] ?? 1;
    for (let column = pivotColumn; column <= size; column += 1) {
      if (augmented[pivotColumn]) {
        augmented[pivotColumn]![column] = (augmented[pivotColumn]![column] ?? 0) / pivot;
      }
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivotColumn) continue;
      const factor = augmented[row]?.[pivotColumn] ?? 0;
      if (Math.abs(factor) < PIVOT_EPSILON) continue;

      for (let column = pivotColumn; column <= size; column += 1) {
        if (augmented[row] && augmented[pivotColumn]) {
          augmented[row]![column] =
            (augmented[row]![column] ?? 0) - factor * (augmented[pivotColumn]![column] ?? 0);
        }
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function featurePenaltyMultiplier(coefficientIndex: number): number {
  if (coefficientIndex === 0) return 1e-4;
  const featureIndex = coefficientIndex - 1;
  if (featureIndex <= 1) return 0.12;
  if (featureIndex <= 4) return 0.7;
  if (featureIndex <= 13) return 40;
  return 120;
}

function fitCoefficients(
  designRows: readonly number[][],
  targets: readonly number[],
  lambda: number,
): number[] {
  const columns = designRows[0]?.length ?? 0;
  const normalMatrix = Array.from({ length: columns }, () => Array<number>(columns).fill(0));
  const normalRhs = Array<number>(columns).fill(0);

  for (let rowIndex = 0; rowIndex < designRows.length; rowIndex += 1) {
    const row = designRows[rowIndex] ?? [];
    const target = targets[rowIndex] ?? 0;

    for (let left = 0; left < columns; left += 1) {
      const leftValue = row[left] ?? 0;
      normalRhs[left] = (normalRhs[left] ?? 0) + leftValue * target;

      for (let right = left; right < columns; right += 1) {
        const value = leftValue * (row[right] ?? 0);
        normalMatrix[left]![right] = (normalMatrix[left]![right] ?? 0) + value;
        if (left !== right) {
          normalMatrix[right]![left] = (normalMatrix[right]![left] ?? 0) + value;
        }
      }
    }
  }

  for (let index = 0; index < columns; index += 1) {
    const penalty = lambda * featurePenaltyMultiplier(index);
    normalMatrix[index]![index] = (normalMatrix[index]![index] ?? 0) + penalty;
  }

  return solveLinearSystem(normalMatrix, normalRhs);
}

function predictWithParts(
  features: readonly number[],
  means: readonly number[],
  scales: readonly number[],
  coefficients: readonly number[],
): number {
  let prediction = coefficients[0] ?? 0;
  for (let index = 0; index < features.length; index += 1) {
    const normalized = normalizeFeature(
      features[index] ?? 0,
      means[index] ?? 0,
      scales[index] ?? 1,
    );
    prediction += normalized * (coefficients[index + 1] ?? 0);
  }
  return prediction;
}

function fitOnce(samples: readonly CalibrationSample[], options: FitOptions): CalibrationModel {
  if (samples.length < 24) {
    throw new Error(`At least 24 valid samples are required; received ${samples.length}.`);
  }

  const featureCount = samples[0]?.features.length ?? 0;
  if (featureCount === 0 || samples.some((sample) => sample.features.length !== featureCount)) {
    throw new Error('Calibration samples contain inconsistent feature vectors.');
  }

  const lambda = options.lambda ?? 0.055;
  const { means, scales } = computeNormalization(samples);
  const designRows = makeDesignRows(samples, means, scales);
  const targetsX = samples.map((sample) => sample.target.x);
  const targetsY = samples.map((sample) => sample.target.y);
  const coefficientsX = fitCoefficients(designRows, targetsX, lambda);
  const coefficientsY = fitCoefficients(designRows, targetsY, lambda);

  const squaredErrors = samples.map((sample) => {
    const x = predictWithParts(sample.features, means, scales, coefficientsX);
    const y = predictWithParts(sample.features, means, scales, coefficientsY);
    const dx = x - sample.target.x;
    const dy = y - sample.target.y;
    return dx * dx + dy * dy;
  });

  const trainingRmseNormalized = Math.sqrt(
    squaredErrors.reduce((sum, value) => sum + value, 0) / squaredErrors.length,
  );

  const metrics: CalibrationMetrics = {
    sampleCount: samples.length,
    retainedSampleCount: samples.length,
    rejectedSampleCount: 0,
    trainingRmseNormalized,
    validationMedianPx: null,
    validationP95Px: null,
    calibratedAt: options.calibratedAt ?? new Date().toISOString(),
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
  };

  return {
    schemaVersion: 1,
    featureVersion: FEATURE_VERSION,
    means,
    scales,
    coefficientsX,
    coefficientsY,
    lambda,
    metrics,
  };
}

export function predictCalibration(
  model: CalibrationModel,
  features: readonly number[],
): Point2D {
  if (model.featureVersion !== FEATURE_VERSION) {
    throw new Error('The saved calibration uses an incompatible feature version.');
  }
  if (features.length !== model.means.length) {
    throw new Error('The gaze feature vector does not match the saved calibration.');
  }

  return {
    x: predictWithParts(features, model.means, model.scales, model.coefficientsX),
    y: predictWithParts(features, model.means, model.scales, model.coefficientsY),
  };
}

export function fitRobustCalibration(
  samples: readonly CalibrationSample[],
  options: FitOptions,
): FitResult {
  const initial = fitOnce(samples, options);
  const residuals = samples.map((sample) => {
    const prediction = predictCalibration(initial, sample.features);
    return Math.hypot(prediction.x - sample.target.x, prediction.y - sample.target.y);
  });

  const residualMedian = median(residuals);
  const absoluteDeviations = residuals.map((value) => Math.abs(value - residualMedian));
  const robustSigma = median(absoluteDeviations) * 1.4826;
  const threshold = Math.max(0.09, residualMedian + 3 * robustSigma);
  const retainedSamples = samples.filter((_, index) => (residuals[index] ?? Infinity) <= threshold);
  const featureCount = samples[0]?.features.length ?? 0;
  const minimumRetained = Math.max(featureCount + 8, Math.ceil(samples.length * 0.68));

  const finalSamples = retainedSamples.length >= minimumRetained ? retainedSamples : [...samples];
  const model = fitOnce(finalSamples, options);
  model.metrics.sampleCount = samples.length;
  model.metrics.retainedSampleCount = finalSamples.length;
  model.metrics.rejectedSampleCount = samples.length - finalSamples.length;

  return { model, retainedSamples: finalSamples };
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(Math.max(quantile, 0), 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  const fraction = position - lowerIndex;
  return lower + (upper - lower) * fraction;
}
