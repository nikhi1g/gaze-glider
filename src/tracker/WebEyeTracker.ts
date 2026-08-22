import { WebEyeTrack } from 'webeyetrack';
import type { GazeObservation, GazeResultLike } from '../types';
import { extractGazeFeatures, rawPointFromResult } from './FeatureExtractor';

type ObservationListener = (observation: GazeObservation) => void;
type StateListener = (state: TrackerState) => void;
type ErrorListener = (error: Error) => void;

export type TrackerState =
  | 'idle'
  | 'requesting-camera'
  | 'loading-models'
  | 'ready'
  | 'running'
  | 'stopped'
  | 'error';

export interface CameraInfo {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  frameRate: number | null;
}

export class WebEyeTrackerController {
  private readonly video: HTMLVideoElement;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly observationListeners = new Set<ObservationListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private tracker: WebEyeTrack | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private processing = false;
  private scheduledFrame: number | null = null;
  private observationId = 0;
  private state: TrackerState = 'idle';
  private lastProcessedAt = 0;
  private readonly minimumFrameIntervalMs: number;

  public latestObservation: GazeObservation | null = null;
  public cameraInfo: CameraInfo | null = null;

  constructor(video: HTMLVideoElement, maximumFps = 24) {
    this.video = video;
    const context = this.canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: true,
    });
    if (!context) throw new Error('Could not create the video frame canvas.');
    this.context = context;
    this.minimumFrameIntervalMs = 1000 / Math.max(1, maximumFps);
  }

  onObservation(listener: ObservationListener): () => void {
    this.observationListeners.add(listener);
    return () => this.observationListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private setState(next: TrackerState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.setState('error');
    for (const listener of this.errorListeners) listener(normalized);
  }

  async start(deviceId?: string): Promise<CameraInfo> {
    if (this.running && this.cameraInfo) return this.cameraInfo;

    try {
      this.setState('requesting-camera');
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'user',
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = this.stream.getVideoTracks()[0];
      if (!track) throw new Error('No camera video track was returned.');

      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      await this.waitForVideoDimensions();

      const settings = track.getSettings();
      this.cameraInfo = {
        deviceId: settings.deviceId ?? deviceId ?? 'default',
        label: track.label || 'Mac camera',
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        frameRate: settings.frameRate ?? null,
      };

      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      this.setState('loading-models');
      this.tracker = new WebEyeTrack(160, 60 * 60);
      await this.tracker.initialize();

      this.running = true;
      this.setState('running');
      this.scheduleNextFrame();
      return this.cameraInfo;
    } catch (error) {
      this.stop();
      this.reportError(error);
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    if (this.scheduledFrame !== null) {
      this.video.cancelVideoFrameCallback(this.scheduledFrame);
      this.scheduledFrame = null;
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.processing = false;
    this.latestObservation = null;
    this.cameraInfo = null;
    this.tracker = null;
    if (this.state !== 'error') this.setState('stopped');
  }

  private async waitForVideoDimensions(): Promise<void> {
    if (this.video.videoWidth > 0 && this.video.videoHeight > 0) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('The camera opened but did not provide video frames.'));
      }, 8000);

      const onReady = (): void => {
        if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
          cleanup();
          resolve();
        }
      };

      const cleanup = (): void => {
        window.clearTimeout(timeout);
        this.video.removeEventListener('loadedmetadata', onReady);
        this.video.removeEventListener('loadeddata', onReady);
      };

      this.video.addEventListener('loadedmetadata', onReady);
      this.video.addEventListener('loadeddata', onReady);
    });
  }

  private scheduleNextFrame(): void {
    if (!this.running) return;

    this.scheduledFrame = this.video.requestVideoFrameCallback((now) => {
      void this.handleFrame(now);
    });
  }

  private async handleFrame(now: number): Promise<void> {
    this.scheduledFrame = null;
    if (!this.running) return;

    if (
      this.processing ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      now - this.lastProcessedAt < this.minimumFrameIntervalMs
    ) {
      this.scheduleNextFrame();
      return;
    }

    this.processing = true;
    this.lastProcessedAt = now;

    try {
      const width = this.video.videoWidth;
      const height = this.video.videoHeight;
      if (width !== this.canvas.width || height !== this.canvas.height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      this.context.drawImage(this.video, 0, 0, width, height);
      const frame = this.context.getImageData(0, 0, width, height);
      const result = await this.tracker?.step(frame, performance.now());
      if (!result) throw new Error('The gaze model did not return a result.');

      const typedResult = result as unknown as GazeResultLike;
      const observation: GazeObservation = {
        id: ++this.observationId,
        receivedAt: performance.now(),
        result: typedResult,
        features: extractGazeFeatures(typedResult),
        rawNormalized: rawPointFromResult(typedResult),
      };
      this.latestObservation = observation;
      for (const listener of this.observationListeners) listener(observation);
    } catch (error) {
      this.stop();
      this.reportError(error);
    } finally {
      this.processing = false;
      this.scheduleNextFrame();
    }
  }
}
