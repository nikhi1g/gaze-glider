# Development Notes

## Local loop

```bash
npm install
npm run setup
npm run dev
```

The development launcher runs asset preparation, starts Vite on `127.0.0.1:5173`, waits for it to respond, and then launches Electron with the development URL.

## Validation before committing

```bash
npm run check
npm run build
```

`npm run check` performs strict TypeScript checking, numerical unit tests, and syntax checks for the Electron CommonJS files.

## Model updates

Model URLs and WebEyeTrack Git blob hashes are declared in `scripts/fetch-webeyetrack-models.mjs`. Do not update a URL without also updating its integrity expectation and reviewing the upstream license and model interface.

The patcher intentionally fails when the installed WebEyeTrack bundle no longer contains the expected MediaPipe URLs. This is preferable to silently returning to remote asset loading.

## Release signing

The repository produces an ad hoc signed local build only. A distributable release needs:

- Apple Developer ID Application signing;
- hardened runtime;
- appropriate child-helper signing;
- notarization and stapling;
- validation of camera and Accessibility permission behavior in the signed bundle.
