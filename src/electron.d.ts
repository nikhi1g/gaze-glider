import type {
  DisplayInfo,
  OverlayCalibrationState,
  OverlayCursorStyle,
  OverlayTrackingState,
  RuntimeInfo,
} from './types';

declare global {
  interface Window {
    gazeGlider?: {
      getRuntimeInfo(): Promise<RuntimeInfo>;
      listDisplays(): Promise<DisplayInfo[]>;
      beginCalibration(displayId: number): Promise<{ width: number; height: number }>;
      updateCalibration(payload: OverlayCalibrationState): void;
      endCalibration(): Promise<void>;
      setTrackingActive(payload: {
        active: boolean;
        displayId: number;
        cursorStyle: OverlayCursorStyle;
      }): Promise<void>;
      updateOverlay(payload: OverlayTrackingState): void;
      setCursorEnabled(enabled: boolean): Promise<{
        enabled: boolean;
        trusted: boolean;
        helperAvailable: boolean;
      }>;
      getCursorPermission(): Promise<{ trusted: boolean; helperAvailable: boolean }>;
      promptCursorPermission(): Promise<{ trusted: boolean; helperAvailable: boolean }>;
      moveCursor(payload: { x: number; y: number; displayId: number }): void;
      onCursorToggleRequested(callback: () => void): () => void;
      onEmergencyStop(callback: () => void): () => void;
      onOverlayTracking(callback: (payload: OverlayTrackingState) => void): () => void;
      onOverlayCalibration(callback: (payload: OverlayCalibrationState) => void): () => void;
    };
  }
}

export {};
