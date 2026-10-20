import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  createEffectClient,
  catchORPCErrorCode,
} from "@orpc/experimental-effect";
import { call, createRouterClient } from "@orpc/server";
import type { PlatformClient } from "@patchsmith/app/protocol";
import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";

import {
  router,
  createInstallationHandler,
  rpcErrorResponse,
} from "./transport";
import type { Installation } from "./transport";

const installation = (): Installation => ({
  action: vi.fn(() => Effect.succeed("action")),
  mutate: vi.fn<Installation["mutate"]>((input) =>
    Effect.succeed(input.requestId)
  ),
  query: vi.fn<Installation["query"]>((input) => Effect.succeed(input.name)),
});

it("validates calls before dispatching installation operations", async () => {
  const operations = installation();
  const options = { context: { installation: operations } };
  await expect(
    call(
      router.mutations,
      { name: "nested.add", requestId: "invalid" },
      options
    )
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    call(router.queries, { name: "nested..list" }, options)
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(operations.mutate).not.toHaveBeenCalled();
  expect(operations.query).not.toHaveBeenCalled();
  const input = { args: { filter: "open" }, name: "nested.list" };
  await expect(call(router.queries, input, options)).resolves.toBe(
    "nested.list"
  );
  expect(operations.query).toHaveBeenCalledWith(input);
});

it("preserves procedure failures for Effect client recovery", async () => {
  const operations = installation();

  operations.query = () =>
    Effect.fail({ code: "NOT_FOUND", message: "Missing query" });

  const client = createEffectClient(
    createRouterClient(
      {
        actions: router.actions,
        mutations: router.mutations,
        queries: router.queries,
      },
      { context: { installation: operations } }
    )
  );

  const result = await Effect.runPromise(
    client
      .queries({ name: "list" })
      .pipe(
        catchORPCErrorCode("NOT_FOUND", (error) =>
          Effect.succeed(error.message)
        )
      )
  );

  expect(result).toBe("Missing query");
});

it("propagates cancellation through an Effect handler to the action", async () => {
  const controller = new AbortController();
  let started!: () => void;

  const ready = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();

    try {
      started = resolve;
    } catch (error) {
      rejectPending(error);
    }

    await pendingPromise;
  })();

  let actionSignal: AbortSignal | undefined;
  const finalized = vi.fn();
  const operations = installation();
  operations.action = (_input, signal) => {
    if (!signal) {
      throw new Error("Action signal required");
    }

    actionSignal = signal;
    started();

    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
    return Effect.tryPromise({
      catch: (error) => error,
      try: async () =>
        await (async () => {
          const {
            promise: pendingPromise,
            resolve: _resolve,
            reject,
          } = Promise.withResolvers();

          try {
            signal.addEventListener(
              "abort",
              () => {
                reject(signal.reason);
              },
              {
                once: true,
              }
            );
          } catch (error) {
            reject(error);
          }

          return await pendingPromise;
        })(),
    }).pipe(Effect.ensuring(Effect.sync(finalized)));
  };

  const client = createRouterClient(
    {
      actions: router.actions,
      mutations: router.mutations,
      queries: router.queries,
    },
    { context: { installation: operations } }
  );

  const result = client.actions(
    { name: "import" },
    { signal: controller.signal }
  );

  const rejected = expect(result).rejects.toBeDefined();
  await ready;
  controller.abort();
  await rejected;
  expect(actionSignal?.aborted).toBe(true);
  expect(finalized).toHaveBeenCalledOnce();
});

it("routes HTTP calls with shared client types, CORS and typed error statuses", async () => {
  const operations = installation();
  const handler = createInstallationHandler();

  const client = createORPCClient<PlatformClient>(
    new RPCLink({
      fetch: async (url, init) => {
        const result = await handler.handle(new Request(url, init), {
          context: { installation: operations },
          prefix: "/rpc",
        });

        expect(result.matched).toBe(true);

        if (!result.response) {
          throw new Error("Missing RPC response");
        }

        return result.response;
      },
      origin: "https://runtime.test",
      url: "/rpc",
    })
  );

  expect(await client.queries({ name: "nested.list" })).toBe("nested.list");
  const requestId = crypto.randomUUID();
  expect(await client.mutations({ name: "nested.add", requestId })).toBe(
    requestId
  );
  expect(await client.actions({ name: "import" })).toBe("action");

  const instances = {
    args: {
      context: { subjectId: "user" },
      path: "/reports/annual.summary",
      slot: "page.links",
    },
    name: "_patchsmith.instances.resolve",
  };

  expect(await client.actions(instances)).toBe("action");
  expect(operations.action).toHaveBeenCalledWith(
    instances,
    expect.any(AbortSignal)
  );
  await expect(
    client.actions({ name: "_other.instances.page" })
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(operations.action).toHaveBeenCalledTimes(2);

  operations.query = () =>
    Effect.fail({ code: "INCOMPATIBLE_VERSION", message: "Reload" });
  await expect(client.queries({ name: "list" })).rejects.toMatchObject({
    code: "INCOMPATIBLE_VERSION",
    message: "Reload",
  });

  const preflight = await handler.handle(
    new Request("https://runtime.test/rpc/queries", {
      headers: {
        "access-control-request-method": "POST",
        origin: "https://host.test",
      },
      method: "OPTIONS",
    }),
    { context: { installation: operations }, prefix: "/rpc" }
  );

  expect(preflight.response?.headers.get("access-control-allow-origin")).toBe(
    "*"
  );
});

it("encodes gateway authentication errors in the oRPC format", async () => {
  const client = createORPCClient<PlatformClient>(
    new RPCLink({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          rpcErrorResponse({ code: "UNAUTHORIZED", message: "Expired" })
        ),
      origin: "https://runtime.test",
      url: "/rpc",
    })
  );

  await expect(client.queries({ name: "list" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Expired",
  });
});
