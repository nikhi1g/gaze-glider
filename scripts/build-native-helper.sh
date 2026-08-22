#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$ROOT/native/build/GazeCursorHelper"
SOURCE="$ROOT/native/GazeCursorHelper.swift"

mkdir -p "$(dirname "$OUTPUT")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping GazeCursorHelper build: macOS is required."
  exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required. Install Apple's Command Line Tools with: xcode-select --install" >&2
  exit 1
fi

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

xcrun --sdk macosx swiftc \
  -target arm64-apple-macos14.0 \
  -sdk "$SDK_PATH" \
  -O \
  -whole-module-optimization \
  -framework ApplicationServices \
  -framework CoreGraphics \
  "$SOURCE" \
  -o "$OUTPUT"

chmod 755 "$OUTPUT"
codesign --force --sign - "$OUTPUT" >/dev/null 2>&1 || true
echo "✓ Built native/build/GazeCursorHelper for $(uname -m)"
