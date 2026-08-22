declare module 'webeyetrack' {
  export interface NormalizedLandmark {
    x: number;
    y: number;
    z?: number;
    visibility?: number;
    presence?: number;
  }

  export interface Matrix {
    rows: number;
    columns: number;
    data: number[];
  }

  export interface GazeResult {
    facialLandmarks: NormalizedLandmark[];
    faceRt: Matrix;
    faceBlendshapes: unknown[];
    eyePatch: ImageData;
    headVector: number[];
    faceOrigin3D: number[];
    metric_transform: Matrix;
    gazeState: 'open' | 'closed';
    normPog: number[];
    durations: Record<string, number>;
    timestamp: number;
  }

  export class WebEyeTrack {
    loaded: boolean;
    latestGazeResult: GazeResult | null;
    maxPoints: number;
    clickTTL: number;
    constructor(maxPoints?: number, clickTTL?: number);
    initialize(): Promise<void>;
    step(frame: ImageData, timestamp: number): Promise<GazeResult>;
    adapt(
      eyePatches: ImageData[],
      headVectors: number[][],
      faceOrigins3D: number[][],
      normPogs: number[][],
      stepsInner?: number,
      innerLR?: number,
      ptType?: 'calib' | 'click',
    ): void;
  }
}
