import { handlerGen, middlewareGen } from "@orpc/experimental-effect";
import {
  encodeHibernationRPCEvent,
  HibernationAsyncIteratorClass,
  HibernationHandlerPlugin,
} from "@orpc/hibernation";
import {
  ORPCError,
  COMMON_ERROR_STATUS_MAP,
  onError,
  implement,
} from "@orpc/server";
import { RPCHandler as FetchHandler } from "@orpc/server/fetch";
import { CORSHandlerPlugin } from "@orpc/server/plugins";
import { RPCHandler as WebSocketHandler } from "@orpc/server/websocket";
import { appContract } from "@patchsmith/app/protocol";
import type { Invocation, MutationInvocation } from "@patchsmith/app/protocol";
import { decodePeerMessage, isPeerCancelMessage } from "@standard-server/peer";
import { Effect } from "effect";
import { z } from "zod";

import type { SubscriptionConnection } from "./supervisor/subscriptions";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

export const wireError = (cause: unknown) => {
  if (cause instanceof ORPCError) {
    return cause;
  }
  const parsed = z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .safeParse(cause);
  const failure = parsed.success ? parsed.data : undefined;
  const code = failure?.code ?? "INTERNAL_SERVER_ERROR";
  return new ORPCError(code, {
    message:
      failure?.code !== undefined &&
      failure?.code !== null &&
      failure?.code !== ""
        ? failure.message
        : "App function failed",
  });
};

export const errorStatusMap = {
  ...COMMON_ERROR_STATUS_MAP,
  INCOMPATIBLE_VERSION: 409,
  UNAVAILABLE: 503,
};

/** Authentication failures must use the same oRPC wire format as procedure errors. */
const rpcStatusByCode = new Map(Object.entries(errorStatusMap));

export const rpcErrorResponse = (cause: unknown) => {
  const failure = wireError(cause);
  return Response.json(
    { json: failure.toJSON() },
    {
      status:
        rpcStatusByCode.get(z.string().safeParse(failure.code).data ?? "") ??
        500,
    }
  );
};

/** The installation supplies these operations with its verified identity captured. */
export interface Installation {
  query: (input: Invocation) => Effect.Effect<unknown, unknown>;
  mutate: (input: MutationInvocation) => Effect.Effect<unknown, unknown>;
  action: (
    input: Invocation,
    signal?: AbortSignal
  ) => Effect.Effect<unknown, unknown>;
}

const base = implement(appContract);
const errors = middlewareGen(function* errors({ next }) {
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
  return yield* next().pipe(Effect.mapError(wireError));
});
const http = base.$context<{ installation: Installation }>().use(errors);
const subscriptions = base
  .$context<{
    subscribe: (input: Invocation) => HibernationAsyncIteratorClass<unknown>;
  }>()
  .use(errors);
export const router = base.router({
  actions: http.actions.handler(
    handlerGen(function* actions({ input, context, signal }) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
      return yield* context.installation.action(input, signal);
    })
  ),

  mutations: http.mutations.handler(
    handlerGen(function* mutations({ input, context }) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
      return yield* context.installation.mutate(input);
    })
  ),

  queries: http.queries.handler(
    handlerGen(function* queries({ input, context }) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
      return yield* context.installation.query(input);
    })
  ),

  // The public pass-through output schema preserves the hibernation callback.
  subscribe: subscriptions.subscribe.handler(
    handlerGen(function* subscribe({ input, context }) {
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
      return yield* Effect.try({
        catch: (err3) => err3,
        try: () => context.subscribe(input),
      });
    })
  ),
});

/** The gateway and installation accept the same procedure routes. */
export const requestRoute = (request: Request) => {
  const path = new URL(request.url).pathname.replace(/\/$/u, "");
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return request.method === "GET" && path === "/rpc/queries"
      ? "subscriptions"
      : undefined;
  }
  return request.method === "POST" &&
    !request.headers.has("upgrade") &&
    ["/rpc/queries", "/rpc/mutations", "/rpc/actions"].includes(path)
    ? "http"
    : undefined;
};

/** Authenticate before selecting an installation; WebSocket JWTs arrive as subprotocols. */
export const routeInstallation = <Identity, Error>(
  request: Request,
  options: {
    verify: (token: string) => Effect.Effect<Identity, Error>;
    installation: (identity: Identity) => {
      fetch: (request: Request) => Promise<Response>;
    };
  }
) =>
  Effect.gen(function* routeInstallationValue() {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    const route = requestRoute(request);
    if (!route) {
      return new Response("Not found", { status: 404 });
    }
    let token: string | undefined;
    if (route === "subscriptions") {
      const protocols =
        request.headers
          .get("sec-websocket-protocol")
          ?.split(",")
          .map((value) => value.trim()) ?? [];
      if (protocols.includes("patchsmith")) {
        token = protocols.find((value) => value.startsWith("jwt."))?.slice(4);
      }
    } else {
      token = request.headers
        .get("authorization")
        ?.match(/^Bearer (?<token>\S+)$/u)?.[1];
    }
    if (!(token !== undefined && token !== null && token !== "")) {
      return yield* Effect.fail(
        new ORPCError("UNAUTHORIZED", { message: "App token required" })
      );
    }
    const identity = yield* options.verify(token);
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
    return yield* Effect.tryPromise({
      catch: (err4) => err4,
      try: async () => {
        if (route === "subscriptions") {
          const headers = new Headers(request.headers);
          headers.set("authorization", `Bearer ${token}`);
          return await options
            .installation(identity)
            .fetch(
              new Request(request.url, { headers, signal: request.signal })
            );
        }
        return await options.installation(identity).fetch(request);
      },
    });
  });

export const createInstallationHandler = () =>
  new FetchHandler(
    {
      actions: router.actions,
      mutations: router.mutations,
      queries: router.queries,
    },
    {
      errorStatusMap,
      interceptors: [
        onError((err5) => {
          if (
            !(err5 instanceof ORPCError) ||
            err5.code === "INTERNAL_SERVER_ERROR" ||
            err5.code === "UNAVAILABLE"
          ) {
            console.error(err5);
          }
        }),
      ],
      plugins: [new CORSHandlerPlugin()],
    }
  );

/** Call message immediately from the host's socket event to preserve oRPC ordering. */
export const createSubscriptionHandler = () => {
  const handler = new WebSocketHandler(
    { subscribe: router.subscribe },
    {
      plugins: [new HibernationHandlerPlugin()],
    }
  );
  return {
    close: async (socket: {
      send: (data: string | Uint8Array<ArrayBuffer>) => void;
    }) => {
      await handler.close(socket);
    },
    message: async (
      socket: { send: (data: string | Uint8Array<ArrayBuffer>) => void },
      message: string | ArrayBuffer,
      subscribe: (input: Invocation) => HibernationAsyncIteratorClass<unknown>,
      cancel: (id: string) => Promise<void>
    ) => {
      const dispatched = handler.message(socket, message, {
        context: { subscribe },
      });
      // Hibernation detaches the iterator from the peer. Cancellation must also
      // remove persisted subscriptions, including after a new handler is created.
      const decoded = decodePeerMessage(
        isStringValue(message) ? message : new Uint8Array(message)
      );
      if (decoded.matched && isPeerCancelMessage(decoded.message)) {
        await (async () => {
          await Promise.all([dispatched, cancel(decoded.message.id)]);
        })();
        return;
      }
      await (async () => {
        await dispatched;
      })();
    },
  };
};

/** Promise/iterator conversion belongs at the oRPC transport boundary. */
export const subscriptionStream = (
  register: (id: string) => Effect.Effect<void, unknown>
) =>
  new HibernationAsyncIteratorClass<unknown>(async (id: string) => {
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
    await Effect.runPromise(register(id));
  });

export const deliverSubscription = (
  connection: SubscriptionConnection,
  id: string,
  value: Parameters<typeof encodeHibernationRPCEvent>[1],
  err6 = false
) =>
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
  Effect.tryPromise({
    catch: (cause: unknown) => cause,
    try: async () => {
      connection.send(
        await encodeHibernationRPCEvent(
          id,
          err6 ? wireError(value) : value,
          err6 ? { event: "error" } : undefined
        )
      );
    },
  });
