# Security and Privacy

## Camera data

GazeGlider processes webcam frames in the Electron renderer. The application contains no upload endpoint, analytics SDK, account system, or remote logging service. Frames are discarded after inference.

## Local network surface

Production assets are served from a loopback-only HTTP server bound to `127.0.0.1` on a fixed application port. The server exposes the packaged `dist` directory and rejects path traversal. It does not accept writes. GazeGlider holds a single-instance lock and fails closed if its fixed local port cannot be bound.

## Privileged behavior

The optional Swift helper can move the pointer but has no click command. It receives only newline-delimited permission commands or normalized coordinates plus a display ID from the Electron main process. Cursor movement is disabled by default and gated on macOS Accessibility trust.

## Reporting

Do not include webcam frames, face images, or personal calibration data in public bug reports. Report security issues privately to the repository owner through GitHub's private vulnerability reporting feature when enabled.
