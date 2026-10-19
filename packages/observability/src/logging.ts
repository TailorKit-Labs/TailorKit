import { context, trace } from "@opentelemetry/api";

type LogAttributes = Record<string, string | number | boolean | undefined>;
type LogLevel = "info" | "warn" | "error";

export const getTraceId = () => {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
};

const writeLog = (
  level: LogLevel,
  event: string,
  attributes: LogAttributes
) => {
  // Callers select safe fields; never pass request bodies or raw errors here.
  console[level](
    JSON.stringify({ ...attributes, event, level, traceId: getTraceId() })
  );
};

/** Structured runtime logs correlated with the active OpenTelemetry trace. */
export const logger = {
  error: (event: string, attributes: LogAttributes = {}) => {
    writeLog("error", event, attributes);
  },
  info: (event: string, attributes: LogAttributes = {}) => {
    writeLog("info", event, attributes);
  },
  warn: (event: string, attributes: LogAttributes = {}) => {
    writeLog("warn", event, attributes);
  },
};
