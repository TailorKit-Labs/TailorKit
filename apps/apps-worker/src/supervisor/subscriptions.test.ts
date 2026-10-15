/* oxlint-disable typescript/no-unsafe-return -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Invocation, SubscriptionClient } from "@tailorkit/app/protocol";
import type { Identity } from "@tailorkit/app/server";
import { Effect, Semaphore } from "effect";
import { expect, it, vi } from "vite-plus/test";

import { createSubscriptionHandler, subscriptionStream } from "../transport";
import { createSubscriptions } from "./subscriptions";
import type {
  SubscriptionConnection,
  SubscriptionSession,
} from "./subscriptions";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const setup = () => {
  // Model durable records: reads copy data, rather than retaining live object references.
  const records = new Map<string, string>();
  const events = new EventTarget();
  const coordinator = Semaphore.makeUnsafe(1);
  const queue = {
    run: async <A>(operation: () => Promise<A>) =>
      await Effect.runPromise(
        coordinator.withPermits(1)(
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
          Effect.tryPromise({ catch: (error) => error, try: operation })
        )
      ),
  };
  const values = { private: 2, public: 1 };
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const query = vi.fn(async (input: Invocation, identity: Identity) => ({
    tables: [input.name],
    value: `${identity.subjectId}:${Object.entries(values).find(([name]) => name === input.name)?.[1]}`,
  }));
  const connection = (user = "alice"): SubscriptionConnection => {
    records.set(
      user,
      JSON.stringify({
        identity: { expiresAt: Date.now() + 120_000, subjectId: user },
        subscriptions: [],
      })
    );
    return {
      read: () => {
        const record = records.get(user);
        // SAFETY: The serialized fixture is produced by this test from the matching session contract before it is read back.
        return record !== undefined && record !== null && record !== ""
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
            (JSON.parse(record) as SubscriptionSession)
          : undefined;
      },
      send: (data: string | Uint8Array<ArrayBuffer>) => {
        events.dispatchEvent(new MessageEvent("message", { data }));
      },
      write: (session) => {
        records.set(user, JSON.stringify(session));
      },
    };
  };
  const socket = connection();
  const sockets = [socket];
  // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

  const ctx =
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This builder or fixture preserves the declared capabilities across an erased generic boundary. */
    {
      getWebSockets: () =>
        sockets.map((socketValue: SubscriptionConnection) => ({
          close: vi.fn(),
          deserializeAttachment: () =>
            requireValue(socketValue.read()).identity.subjectId,
          send: (data: string | Uint8Array<ArrayBuffer>) => {
            socketValue.send(data);
          },
        })),
      storage: {
        kv: {
          delete: (key: string) => records.delete(key.slice(7)),
          get: (key: string) => {
            const value = records.get(key.slice(7));
            return value !== undefined && value !== null && value !== ""
              ? JSON.parse(value)
              : undefined;
          },
          put: (key: string, value: SubscriptionSession) =>
            records.set(key.slice(7), JSON.stringify(value)),
        },
      },
    } as unknown as DurableObjectState;
  /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
  const create = () =>
    createSubscriptions(
      ctx,
      (input, identity) =>
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
        Effect.tryPromise({
          catch: (error) => error,
          try: async () => await query(input, identity),
        }),
      coordinator
    );
  let subscriptions = create();
  let handler = createSubscriptionHandler();
  const subscribe = (input: Invocation) =>
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
    subscriptionStream((id) => subscriptions.subscribe(socket, input, id));
  const pending: Promise<void>[] = [];
  const client = createORPCClient<SubscriptionClient>(
    new RPCLink({
      connect: () => ({
        addEventListener: events.addEventListener.bind(events),
        readyState: 1,
        removeEventListener: events.removeEventListener.bind(events),
        send: (data: string | Uint8Array<ArrayBuffer>) => {
          pending.push(
            handler.message(
              socket,
              isStringValue(data) ? data : new TextDecoder().decode(data),
              subscribe,
              async (id) => {
                await Effect.runPromise(subscriptions.cancel(socket, id));
              }
            )
          );
        },
      }),
    })
  );
  return {
    client,
    connection,
    flush: async () => {
      await Promise.all(pending);
      await queue.run(async () => {});
    },
    query,
    records,
    recreate: () => {
      subscriptions = create();
      handler = createSubscriptionHandler();
    },
    refresh: async (tables: string[]) => {
      await Effect.runPromise(
        coordinator.withPermits(1)(subscriptions.refresh(tables))
      );
    },
    socket,
    sockets,
    subscribe: (socketValue2: SubscriptionConnection, input: Invocation) =>
      subscriptionStream((id) =>
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
        subscriptions.subscribe(socketValue2, input, id)
      ),
    values,
  };
};

it("restores multiple subscriptions and cancellation after recreation with isolated dependencies", async () => {
  const test = setup();
  const publicStream = await test.client.subscribe({ name: "public" });
  const privateStream = await test.client.subscribe({ name: "private" });
  expect(await publicStream.next()).toMatchObject({ value: "alice:1" });
  expect(await privateStream.next()).toMatchObject({ value: "alice:2" });
  await test.flush();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(2);
  test.recreate();
  test.values.public = 3;
  test.query.mockClear();
  await test.refresh(["public"]);
  expect(await publicStream.next()).toMatchObject({ value: "alice:3" });
  expect(test.query).toHaveBeenCalledTimes(1);
  await publicStream.return?.();
  await test.flush();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(1);
  test.recreate();
  test.values.private = 4;
  await test.refresh(["private"]);
  expect(await privateStream.next()).toMatchObject({ value: "alice:4" });
  await privateStream.return?.();
  await test.flush();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(0);
});

it("refreshes view subscriptions on table writes after recreation without broadening table subscriptions", async () => {
  const test = setup();
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  test.query.mockImplementation(async (input, identity) => ({
    tables: input.name === "public" ? ["*"] : ["private"],
    value: `${identity.subjectId}:${Object.entries(test.values).find(([name]) => name === input.name)?.[1]}`,
  }));
  const viewStream = await test.client.subscribe({ name: "public" });
  const tableStream = await test.client.subscribe({ name: "private" });
  expect(await viewStream.next()).toMatchObject({ value: "alice:1" });
  expect(await tableStream.next()).toMatchObject({ value: "alice:2" });
  await test.flush();
  test.recreate();
  test.query.mockClear();
  await test.refresh([]);
  expect(test.query).not.toHaveBeenCalled();
  test.values.public = 3;
  await test.refresh(["underlying_table"]);
  expect(test.query.mock.calls.map(([input]) => input.name)).toEqual([
    "public",
  ]);
  expect(await viewStream.next()).toMatchObject({ value: "alice:3" });
  test.query.mockClear();
  test.values.private = 4;
  await test.refresh(["private"]);
  expect(await viewStream.next()).toMatchObject({ value: "alice:3" });
  expect(await tableStream.next()).toMatchObject({ value: "alice:4" });
  expect(test.query).toHaveBeenCalledTimes(2);
  await viewStream.return?.();
  await tableStream.return?.();
  await test.flush();
});

it("delivers typed errors and removes failed subscriptions after recreation", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  await test.flush();
  test.recreate();
  test.query.mockRejectedValueOnce({
    code: "UNAUTHORIZED",
    message: "Expired",
  });
  await test.refresh(["public"]);
  await expect(stream.next()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Expired",
  });
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(0);
});

it("does not register a snapshot after the connection disappears during its query", async () => {
  const test = setup();
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  test.query.mockImplementationOnce(async () => {
    test.records.delete("alice");
    return { tables: ["public"], value: "gone" };
  });
  const stream = await test.client.subscribe({ name: "public" });
  await test.flush();
  expect(test.records.size).toBe(0);
  await stream.return?.();
  await test.flush();
});

it("does not fail mutation delivery when a disconnected socket throws", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  await test.flush();
  test.socket.send = () => {
    throw new Error("Socket closed");
  };
  await expect(test.refresh(["public"])).resolves.toBeUndefined();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(0);
  await stream.return?.();
  await test.flush();
});

it("registers the first snapshot before a concurrent mutation and replaces dependencies", async () => {
  const test = setup();
  let ready!: () => void;
  const started = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();
    try {
      ready = resolve;
    } catch (error) {
      rejectPending(error);
    }
    await pendingPromise;
  })();
  let finish!: (snapshot: { value: string; tables: string[] }) => void;
  const initial = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<{ value: string; tables: string[] }>();
    try {
      finish = resolve;
    } catch (error) {
      rejectPending(error);
    }
    return await pendingPromise;
  })();
  test.query.mockImplementationOnce(async () => {
    ready();
    return await initial;
  });
  test.query.mockResolvedValueOnce({ tables: ["private"], value: "alice:3" });
  const stream = await test.client.subscribe({ name: "public" });
  await started;
  const mutation = test.refresh(["public"]);
  finish({ tables: ["public"], value: "alice:0" });
  await mutation;
  expect(await stream.next()).toMatchObject({ value: "alice:0" });
  expect(await stream.next()).toMatchObject({ value: "alice:3" });
  await test.refresh(["public"]);
  expect(test.query).toHaveBeenCalledTimes(2);
  await test.refresh(["private"]);
  expect(test.query).toHaveBeenCalledTimes(3);
  await stream.return?.();
  await test.flush();
});

it("reruns as each stored identity and isolates failures on different connections", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  const bob = test.connection("bob");
  test.sockets.push(bob);
  await requireValue(test.subscribe(bob, { name: "public" })["~callback"])(
    "bob-subscription"
  );
  await test.flush();
  test.recreate();
  test.query.mockClear();
  test.query.mockRejectedValueOnce({ code: "FORBIDDEN", message: "Denied" });
  await test.refresh(["public"]);
  await expect(stream.next()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(test.query.mock.calls.map((call) => call[1].subjectId)).toEqual([
    "alice",
    "bob",
  ]);
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(0);
  expect(requireValue(bob.read()).subscriptions).toHaveLength(1);
});

it("reports an initial query error through the stream and removes its persisted registration", async () => {
  const test = setup();
  test.query.mockRejectedValueOnce({
    code: "NOT_FOUND",
    message: "Missing query",
  });
  const stream = await test.client.subscribe({ name: "public" });
  await expect(stream.next()).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Missing query",
  });
  await test.flush();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(0);
});

it("enforces the installation subscription limit using persisted state", async () => {
  const test = setup();
  const session = requireValue(test.socket.read());
  session.subscriptions = Array.from({ length: 256 }, (_, index) => ({
    id: String(index),
    input: { name: "public" },
    tables: ["public"],
  }));
  test.socket.write(session);
  test.recreate();
  const stream = await test.client.subscribe({ name: "public" });
  await expect(stream.next()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await test.flush();
  expect(requireValue(test.socket.read()).subscriptions).toHaveLength(256);
  expect(test.query).not.toHaveBeenCalled();
});
