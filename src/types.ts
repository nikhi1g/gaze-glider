export interface NormalizedLandmarkLike {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface MatrixLike {
  rows: number;
  columns: number;
  data: number[];
}

export interface GazeResultLike {
  facialLandmarks: NormalizedLandmarkLike[];
  faceRt: MatrixLike;
  faceBlendshapes: unknown[];
  eyePatch: ImageData;
  headVector: number[];
  faceOrigin3D: number[];
  metric_transform: MatrixLike;
  gazeState: 'open' | 'closed';
  normPog: number[];
  durations: Record<string, number>;
  timestamp: number;
}

export interface GazeObservation {
  id: number;
  receivedAt: number;
  result: GazeResultLike;
  features: number[] | null;
  rawNormalized: Point2D | null;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CalibrationSample {
  features: number[];
  target: Point2D;
  phase: string;
}

export interface CalibrationMetrics {
  sampleCount: number;
  retainedSampleCount: number;
  rejectedSampleCount: number;
  trainingRmseNormalized: number;
  validationMedianPx: number | null;
  validationP95Px: number | null;
  calibratedAt: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface CalibrationModel {
  schemaVersion: 1;
  featureVersion: string;
  means: number[];
  scales: number[];
  coefficientsX: number[];
  coefficientsY: number[];
  lambda: number;
  metrics: CalibrationMetrics;
}

export interface DisplayInfo {
  id: number;
  label: string;
  internal: boolean;
  scaleFactor: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RuntimeInfo {
  platform: string;
  arch: string;
  appVersion: string;
  helperAvailable: boolean;
  packaged: boolean;
}

export type OverlayCursorStyle = 'orb' | 'eyes' | 'crosshair';

export interface OverlayTrackingState {
  visible: boolean;
  point: Point2D;
  cursorStyle: OverlayCursorStyle;
  valid: boolean;
  quality: number;
}

export interface OverlayCalibrationState {
  visible: boolean;
  point: Point2D;
  instruction: string;
  progress: number;
  index: number;
  total: number;
  phase: 'screen' | 'head-range' | 'validation';
}
