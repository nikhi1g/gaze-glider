# Accuracy and Evaluation

## What to measure

Do not evaluate a gaze tracker by whether a dot appears to follow the eyes. Record at least these metrics:

| Metric | Meaning |
|---|---|
| Median point error | Typical distance between predicted and known target positions |
| 95th-percentile error | Poor-case behavior that determines how often the cursor misses badly |
| Fixation jitter | Radius or standard deviation while the user holds gaze on one target |
| End-to-end latency | Camera exposure through visible overlay movement |
| Dropout rate | Percentage of frames rejected because the face or open eyes were unavailable |
| Edge bias | Error near corners and screen edges versus the center |
| Head-range robustness | Error after small lateral and depth changes within the calibrated range |

GazeGlider reports median and 95th-percentile error from a five-position validation pass. For development, add a longer randomized test and log each sample rather than relying only on the displayed summary.

## Recommended test protocol

1. Disable Center Stage and all automatic reframing.
2. Use a fixed display resolution and scaling mode.
3. Place the laptop at a repeatable viewing distance.
4. Calibrate once.
5. Present 30 to 50 randomized targets with at least 500 ms of fixation collection per target.
6. Repeat the test under these conditions:
   - neutral head position;
   - head shifted left and right;
   - closer and farther viewing distance;
   - glasses on and off, when applicable;
   - brighter and dimmer front lighting.
7. Report per-condition median, P95, jitter, and dropout rate.

## Practical interpretation

Dedicated infrared systems can estimate gaze much more precisely and consistently than a laptop RGB camera. GazeGlider should initially be used for:

- moving a large visual element;
- selecting broad screen regions;
- attention visualization;
- snapping to large nearby controls;
- combining gaze location with an explicit trackpad or keyboard confirmation.

Direct pixel-level selection of dense toolbars or text insertion points is not an appropriate baseline expectation.

## Improving accuracy

The highest-value improvements are usually:

1. Better and more consistent lighting.
2. Turning off dynamic camera cropping.
3. Recalibrating after changing posture, display scale, or laptop position.
4. Collecting calibration examples across the natural head-movement range.
5. Target snapping or probabilistic UI selection rather than raw pointer coordinates.
6. Moving inference to a dedicated worker and preserving stable frame timing.
7. Training a MacBook-camera-specific gaze model using consented, labeled data.

Increasing smoothing alone can make the cursor look better while increasing latency and hiding systematic error. Always evaluate error and latency together.
