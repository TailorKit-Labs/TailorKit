---
"@tailorkit/app": minor
"@tailorkit/app-db": minor
"@tailorkit/client-core": minor
"@tailorkit/client-platform": minor
"@tailorkit/core": minor
"@tailorkit/react": minor
"tailorkit": minor
"@tailorkit/vite": minor
"@tailorkit/cli": minor
"@tailorkit/sandbox": minor
---

Build packages with Vite+ instead of tsup while preserving public entry points and declaration paths.

Drop Node.js 20 support and target Node.js 22 for all public packages, including the CLI and sandbox library. Use Node.js 22 or newer. Public package manifests and generated apps declare `engines.node: ">=22"`. Internal builds and workspace manifests require Node.js 24.
