---
"@patchsmith/app": minor
"@patchsmith/sandbox": minor
---

Pace canvas draws on the host clock so Chrome's hidden-iframe timer throttling does not reduce requested frame rates to roughly one frame per second. Preserve cancellation, backpressure, and host frame-rate limits, including draws that skip bitmap presentation.

The experimental canvas surface now requires `waitForFrame(milliseconds, signal)`, and capped or skipped draws use a new pacing exchange. Upgrade the host SDK before rebuilding installed apps with this release. Existing apps remain supported by the upgraded host. Custom surface implementations must provide the cancellable wait method.
