---
"@patchsmith/app": patch
"@patchsmith/vite": patch
"@patchsmith/cli": patch
"@patchsmith/core": patch
"@patchsmith/sandbox": patch
"@patchsmith/client-platform": patch
"patchsmith": patch
---

Publish files from an app's `assets/` directory with SHA-256 URLs that remain stable across deployments. Resolve files with `assetUrl()` from `patchsmith/client` or Vite `?url` imports. Deployments track their asset references and reuse existing uploads. Upgrade the platform database and backend, then the host SDK, before deploying apps with assets.
