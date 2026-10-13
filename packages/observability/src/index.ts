import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Attributes, Span, SpanOptions } from "@opentelemetry/api";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { ORPCInstrumentation } from "@orpc/opentelemetry";

import { env } from "#env";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

const isBooleanValue = <TValue>(value: TValue): value is TValue & boolean =>
  typeof value === "boolean";

const isSpanHandler = <T>(
  value: SpanOptions | ((span: Span) => T | Promise<T>)
): value is (span: Span) => T | Promise<T> => typeof value === "function";

interface TelemetryState {
  initializing?: Promise<void>;
  serviceName?: string;
  started: boolean;
}

interface VercelOtelModule {
  registerOTel: (config: {
    attributes?: Attributes;
    instrumentations?: unknown[];
    serviceName: string;
    traceSampler?: unknown;
  }) => void;
}

const stateKey = Symbol.for("tailorkit.observability.state");

const sensitiveAttributePattern =
  /(?:authorization|cookie|password|secret|token|key|body|headers|email|url)$/iu;

// SAFETY: This module owns the telemetry symbol state and initializes it with TelemetryState; the optional SDK import is the installed @vercel/otel API.
const globalState = globalThis as typeof globalThis & {
  [stateKey]?: TelemetryState;
};

globalState[stateKey] ??= { started: false };
const state = globalState[stateKey];

const isTracingDisabled = () =>
  env.TAILORKIT_OTEL_DISABLED || env.NODE_ENV === "test";

const resolveServiceName = (serviceName?: string) =>
  serviceName ?? env.OTEL_SERVICE_NAME ?? "tailorkit-web";

const resolveDeploymentEnvironment = () => env.VERCEL_ENV ?? env.NODE_ENV;

const resolveServiceVersion = () => env.VERCEL_GIT_COMMIT_SHA;

export const safeAttributeValue = <TValue>(
  value: TValue
): string | number | boolean | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (isStringValue(value) || isNumberValue(value) || isBooleanValue(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

export const safeAttributes = <TAttributes extends object>(
  attributes?: TAttributes
): Attributes =>
  Object.fromEntries(
    Object.entries(attributes ?? {})
      .filter(([key]) => !sensitiveAttributePattern.test(key))
      .map(([key, value]) => [key, safeAttributeValue(value)])
      .filter(
        (entry): entry is [string, string | number | boolean] =>
          entry[1] !== undefined
      )
  );

const createResourceAttributes = (serviceName: string): Attributes =>
  safeAttributes({
    "cloud.region": env.VERCEL_REGION,
    "deployment.environment.name": resolveDeploymentEnvironment(),
    "service.name": serviceName,
    "service.version": resolveServiceVersion(),
    "tailorkit.package": "observability",
  });

const resolveSampleRate = () => {
  const configuredRate =
    env.TAILORKIT_OTEL_SAMPLE_RATE ?? env.OTEL_TRACES_SAMPLER_ARG;

  if (!configuredRate) {
    return 1;
  }

  const rate = Number(configuredRate);
  if (!Number.isFinite(rate)) {
    return 1;
  }

  return Math.min(Math.max(rate, 0), 1);
};

const createSampler = () =>
  new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(resolveSampleRate()),
  });

const createInstrumentations = () => [
  "auto",
  new ORPCInstrumentation(),
  new PgInstrumentation({
    enhancedDatabaseReporting: false,
    requestHook: (span, queryInfo) => {
      const operation =
        queryInfo.query.text.trim().split(/\s+/u)[0]?.toLowerCase() ?? "query";
      span.setAttributes(
        safeAttributes({
          "operation.name": `db.${operation}`,
          "resource.name": `postgres ${operation}`,
          "tailorkit.package": "db",
        })
      );
    },
    requireParentSpan: false,
    responseHook: (span, responseInfo) => {
      span.setAttributes(
        safeAttributes({
          "db.response.rows": responseInfo.data.rowCount,
        })
      );
    },
  }),
  new HttpInstrumentation({
    requireParentforIncomingSpans: false,
    requireParentforOutgoingSpans: true,
  }),
  new UndiciInstrumentation(),
];

export const initializeObservability = async (serviceName?: string) => {
  if (state.started) {
    return;
  }

  if (state.initializing) {
    return state.initializing;
  }

  if (isTracingDisabled()) {
    return;
  }

  const resolvedServiceName = resolveServiceName(serviceName);
  state.serviceName = resolvedServiceName;

  state.initializing = (async () => {
    if (!env.VERCEL) {
      return;
    }

    // SAFETY: This module owns the telemetry symbol state and initializes it with TelemetryState; the optional SDK import is the installed @vercel/otel API.
    const { registerOTel } = (await import("@vercel/otel")) as VercelOtelModule;
    registerOTel({
      attributes: createResourceAttributes(resolvedServiceName),
      instrumentations: createInstrumentations(),
      serviceName: resolvedServiceName,
      traceSampler: createSampler(),
    });
  })();

  try {
    await state.initializing;
    state.started = true;
  } catch (error) {
    state.serviceName = undefined;
    throw error;
  } finally {
    state.initializing = undefined;
  }
};

export const shutdownObservability = () => {
  state.initializing = undefined;
  state.started = false;
  state.serviceName = undefined;
};

export const getTracer = (name = "tailorkit") => trace.getTracer(name);

export const setSpanAttributes = <TAttributes extends object>(
  attributes: TAttributes
) => {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(safeAttributes(attributes));
  }
};

export const recordException = <TAttributes extends object>(
  cause: unknown,
  attributes?: TAttributes
) => {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  if (attributes) {
    span.setAttributes(safeAttributes(attributes));
  }

  if (cause instanceof Error) {
    span.recordException(cause);
    span.setStatus({ code: SpanStatusCode.ERROR, message: cause.message });
    return;
  }

  span.recordException(String(cause));
  span.setStatus({ code: SpanStatusCode.ERROR });
};

export const withSpan = <T>(
  name: string,
  optionsOrHandler: SpanOptions | ((span: Span) => Promise<T> | T),
  maybeHandler?: (span: Span) => Promise<T> | T
): Promise<T> => {
  const tracer = getTracer("tailorkit.runtime");
  const options = isSpanHandler(optionsOrHandler)
    ? undefined
    : optionsOrHandler;
  const handler = isSpanHandler(optionsOrHandler)
    ? optionsOrHandler
    : maybeHandler;

  if (!handler) {
    throw new Error("withSpan requires a handler.");
  }

  return tracer.startActiveSpan(name, options ?? {}, async (span: Span) => {
    span.setAttributes(
      safeAttributes({
        "operation.name": name,
        "resource.name": name,
        ...options?.attributes,
      })
    );

    try {
      const result = await handler(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
};

const headersToCarrier = (headers: Headers): Record<string, string> =>
  Object.fromEntries(headers.entries());

export const withRequestSpan = <T>(
  request: Request,
  name: string,
  optionsOrHandler: SpanOptions | ((span: Span) => Promise<T> | T),
  maybeHandler?: (span: Span) => Promise<T> | T
): Promise<T> => {
  const carrier = headersToCarrier(request.headers);
  const parentContext = propagation.extract(context.active(), carrier);

  return context.with(parentContext, () => {
    const url = new URL(request.url);
    const options = isSpanHandler(optionsOrHandler)
      ? undefined
      : optionsOrHandler;
    const handler = isSpanHandler(optionsOrHandler)
      ? optionsOrHandler
      : maybeHandler;

    if (!handler) {
      throw new Error("withRequestSpan requires a handler.");
    }

    return withSpan(
      name,
      {
        kind: SpanKind.SERVER,
        ...options,
        attributes: safeAttributes({
          "http.request.method": request.method,
          "url.path": url.pathname,
          ...options?.attributes,
        }),
      },
      handler
    );
  });
};

export const getTraceId = () => {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  return spanContext?.traceId;
};

export const sanitizeErrorForLog = (cause: unknown) => {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      name: cause.name,
      traceId: getTraceId(),
    };
  }

  return {
    message: "Unknown error",
    name: "UnknownError",
    traceId: getTraceId(),
  };
};
