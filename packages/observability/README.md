# TailorKit observability

`@tailorkit/observability` contains shared tracing and telemetry code for the TailorKit platform.

Use `logger.info(event, attributes)`, `logger.warn`, or `logger.error` for structured JSON runtime logs. Entries include the event, level, selected scalar attributes, and the active OpenTelemetry `traceId` when available. Select safe fields explicitly; do not pass credentials, request bodies, model output, or raw errors.

The logger is exported from both `@tailorkit/observability` and `@tailorkit/observability/logging`. Use the `/logging` export in Workflow sandbox code: it depends only on the portable OpenTelemetry API and does not load Node instrumentation, environment configuration, or register an SDK. On the host, call `initializeObservability` at startup to enable tracing. Without an active span, logs still work and omit `traceId`.
