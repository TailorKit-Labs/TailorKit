---
"patchsmith": minor
"@patchsmith/core": minor
"@patchsmith/client-platform": minor
---

Add `patchsmith.experimental.installApp({ appId, scope: { name, value } })` to the host server SDK. Install an app's current published deployment into a declared scope in the same project, with an independent installation identity and runtime data. Validate scope inputs against the host contract, keep project credentials server-side, and return the installed app with its views and existing asset URLs. Installations stay pinned when the source app is redeployed.
