import { getOpenAPIMeta } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import {
  defineMeta,
  ORPCError,
  walkProcedureContractsSync,
} from "@orpc/server";
import type { Router } from "@orpc/server";
import {
  ResponseHeadersPlugin,
  RethrowHandlerPlugin,
} from "@orpc/server/plugins";

import type { Context } from "./context";

interface HttpPolicy {
  authenticate?: boolean;
  authTiming?: string;
  cors?: boolean;
  invalidInputMessage?: string;
  json?: boolean;
  maxBodyBytes?: number;
}

export const [httpPolicy, getHttpPolicy] = defineMeta(
  "patchsmith.http",
  (incoming: HttpPolicy, current) => ({ ...current, ...incoming })
);

const corsHeaders = {
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};

export const recordHttpTiming = (
  context: Context,
  stage: string,
  started: number
) => {
  context.resHeaders?.append(
    "server-timing",
    `${stage};dur=${(performance.now() - started).toFixed(1)}`
  );
};

/** The transport returns these responses directly, preserving upstream error bodies. */
class HttpResponseError extends Error {
  override readonly name = "HttpResponseError";
  readonly response: Response;

  constructor(response: Response) {
    super("Upstream HTTP response");
    this.response = response;
  }
}

/** Adapt browser HTML pages and upstream responses to oRPC's detailed output. */
export const httpOutput = (response: Response, context: Context) => {
  for (const [name, value] of response.headers) {
    context.resHeaders?.set(name, value);
  }

  if (response.status >= 400) {
    throw new HttpResponseError(response);
  }

  return { body: response.body ?? undefined, status: response.status };
};

const boundedBody = async (
  request: Request,
  limit: number
): Promise<string> => {
  if (Number(request.headers.get("content-length") ?? 0) > limit) {
    throw new ORPCError("PAYLOAD_TOO_LARGE");
  }

  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder();

  if (request.body) {
    for await (const chunk of request.body) {
      bytes += chunk.byteLength;

      if (bytes > limit) {
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }

      body += decoder.decode(chunk, { stream: true });
    }
  }

  return body + decoder.decode();
};

/** Authenticate and reject disallowed origins before the transport reads a body. */
const applyRequestPolicy = async (
  context: Context,
  policy: HttpPolicy | undefined
) => {
  context.resHeaders?.set("cache-control", "no-store");

  if (policy?.cors === true) {
    for (const [name, value] of Object.entries(corsHeaders)) {
      context.resHeaders?.set(name, value);
    }
  }

  if (policy?.json === true) {
    const origin = context.request.headers.get("origin");

    if (
      context.request.headers
        .get("content-type")
        ?.startsWith("application/json") !== true ||
      (origin !== null && origin !== "" && origin !== context.publicOrigin)
    ) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid request" });
    }
  }

  if (policy?.authenticate === true) {
    const started = performance.now();
    const viewer = await context.authenticate({ request: context.request });

    if (policy.authTiming !== undefined) {
      recordHttpTiming(context, policy.authTiming, started);
    }

    if (!viewer) {
      throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
    }
  }
};

/** HTTP routing belongs to oRPC; route metadata declares transport policy. */
export const createHttpHandler = (router: Router<Context>) => {
  const preflightPaths = new Set<string>();
  walkProcedureContractsSync(router, (procedure) => {
    const path = getOpenAPIMeta(procedure)?.path;

    if (getHttpPolicy(procedure)?.cors === true && path !== undefined) {
      preflightPaths.add(path);
    }
  });

  return new OpenAPIHandler(router, {
    customErrorResponseBodyEncoder: (error) =>
      new Blob([error.message], { type: "text/plain; charset=utf-8" }),
    interceptors: [
      async (options) => {
        try {
          return await options.next();
        } catch (error) {
          if (error instanceof HttpResponseError) {
            return {
              body: error.response.body ?? undefined,
              headers: {},
              status: error.response.status,
            };
          }

          throw error;
        }
      },
      async (options) => {
        const { context, procedure } = options;
        const policy = getHttpPolicy(procedure);
        await applyRequestPolicy(context, policy);

        try {
          if (policy?.maxBodyBytes !== undefined) {
            const body = await boundedBody(
              context.request,
              policy.maxBodyBytes
            );

            const input: unknown = JSON.parse(body);

            return await options.next({
              ...options,
              // oxlint-disable-next-line require-await -- oRPC requires an async decoder; bytes have already been bounded and read.
              decodeInput: async () => input,
            });
          }

          return await options.next();
        } catch (error) {
          if (
            error instanceof SyntaxError ||
            (policy?.invalidInputMessage !== undefined &&
              error instanceof ORPCError &&
              error.code === "BAD_REQUEST")
          ) {
            throw new ORPCError("BAD_REQUEST", {
              cause: error,
              message: policy?.invalidInputMessage ?? "Invalid JSON",
            });
          }

          throw error;
        }
      },
    ],
    plugins: [
      new ResponseHeadersPlugin(),
      new RethrowHandlerPlugin({
        filter: (error) => !(error instanceof ORPCError),
      }),
    ],
    routingInterceptors: [
      async (options) => {
        const { request, context, prefix } = options;

        const path = new URL(context.request.url).pathname.slice(
          prefix?.length ?? 0
        );

        if (request.method === "OPTIONS" && preflightPaths.has(path)) {
          return {
            matched: true,
            response: {
              body: undefined,
              headers: { ...corsHeaders, "cache-control": "no-store" },
              status: 204,
            },
          };
        }

        return await options.next();
      },
    ],
  });
};
