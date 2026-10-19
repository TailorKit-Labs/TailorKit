---
"@patchsmith/react": minor
"@patchsmith/app": minor
"@patchsmith/cli": minor
"@patchsmith/core": minor
"@patchsmith/client-platform": minor
"patchsmith": minor
---

Add client-bound useViews with scopes, appIds, and slot filters. App builds and deployments include view manifests, including preview builds. useApps and useViews share one authenticated app request and filter locally; useApps also accepts appIds. Apps without a view manifest must be redeployed to appear in useViews.
