---
"@patchsmith/app": minor
"@patchsmith/app-db": minor
"@patchsmith/client-core": minor
"@patchsmith/client-platform": minor
"@patchsmith/core": minor
"@patchsmith/react": minor
"patchsmith": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"@patchsmith/sandbox": minor
---

Build packages with Vite+ instead of tsup while preserving public entry points and declaration paths.

Drop Node.js 20 support and target Node.js 22 for all public packages, including the CLI and sandbox library. Use Node.js 22 or newer. Public package manifests and generated apps declare `engines.node: ">=22"`. Internal builds and workspace manifests require Node.js 24.
