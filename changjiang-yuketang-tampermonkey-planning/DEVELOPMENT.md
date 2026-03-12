# BetterYuKeTang Development

## Current Setup

This repository now contains a minimal Tampermonkey development scaffold.

## Build

Run:

```bash
npm run build
```

The generated userscript will be written to `dist/better-yuketang.user.js`.

## Current Capabilities

- Userscript metadata header
- Local settings persistence
- Basic logger
- Heuristic page detection
- Floating panel for debug and module status
- Route change re-detection for SPA-like pages

## Next Implementation Targets

1. Replace heuristic page detection with real YukeTang selectors.
2. Add course content parsing for assignments, experiments, and PPTs.
3. Add deadline extraction and dashboard rendering.
4. Add PPT reader state detection.
5. Add print entry detection and export hints.
