import type { Invocation } from "@tailorkit/app/protocol";
import type { Identity } from "@tailorkit/app/server";
import { asyncFixture } from "@tailorkit/config/testing";
import { Effect, Semaphore } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { SubscriptionSession } from "./subscriptions";
import { createSubscriptions } from "./subscriptions";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const createIdentity = (expiresAt: number): Identity => ({
  appId: "app",
  deploymentId: "deployment",
  expiresAt,
  installationId: "installation",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/tools",
});

const setup = () => {
  const now = Date.now();
  const records = new Map<string, SubscriptionSession>();
  let alarm: number | null = null;
  const sockets: WebSocket[] = [];
  const operations =
    vi.fn<
      (
        input: Invocation,
        identity: Identity
      ) => Promise<{ value: unknown; tables: string[] }>
    >();
  const cancel = vi.fn();
  // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

  const ctx =
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
    {
      getWebSockets: () => sockets,
      storage: {
        deleteAlarm: asyncFixture(() => {
          alarm = null;
        }),
        getAlarm: asyncFixture(() => alarm),
        kv: {
          delete: (key: string) => records.delete(key),
          get: (key: string) => records.get(key),
          list: () => records.entries(),
          put: (key: string, value: SubscriptionSession) =>
            records.set(key, value),
        },
        setAlarm: asyncFixture((time: number) => {
          alarm = time;
        }),
      },
    } as unknown as DurableObjectState;
  /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
  vi.stubGlobal("WebSocket", { CLOSED: 3 });
  const socket = (id: string, expiresAt: number) => {
    const close = vi.fn();
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    const socketValue =
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        close,
        deserializeAttachment: () => id,
        readyState: 2,
        send: vi.fn(),
      } as unknown as WebSocket;
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    records.set(`socket:${id}`, {
      identity: createIdentity(expiresAt),
      subscriptions: [],
    });
    sockets.push(socketValue);
    return { close, value: socketValue };
  };
  return {
    cancel,
    create: () =>
      createSubscriptions(
        ctx,
        (input, identity) =>
          Effect.promise(async () => await operations(input, identity)),
        Semaphore.makeUnsafe(1)
      ),
    ctx,
    getAlarm: () => alarm,
    now,
    operations,
    records,
    socket,
  };
};

afterEach(() => vi.unstubAllGlobals());

it("rejects expired frames before decoding or executing a procedure", async () => {
  const test = setup();
  const { close, value: socket } = test.socket("expired", test.now - 1);
  await test.create().message(socket, "{}");
  expect(close).toHaveBeenCalledWith(1008, "Authentication expired");
  expect(test.operations).not.toHaveBeenCalled();
  expect(test.records.size).toBe(0);
});

it("expires idle connections after recreation and schedules the next durable alarm", async () => {
  const test = setup();
  const expired = test.socket("expired", test.now - 1);
  const active = test.socket("active", test.now + 60_000);
  await test.create().alarm();
  expect(expired.close).toHaveBeenCalledWith(1008, "Authentication expired");
  expect(active.close).not.toHaveBeenCalled();
  expect(test.getAlarm()).toBe(test.now + 60_000);
  expect(test.create().connections()).toHaveLength(1);
  await test.create().close(active.value, 1000, "Renew authentication");
  expect(active.close).toHaveBeenCalledWith(1000, "Renew authentication");
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});

it("rejects delivery for expired sessions and cannot recreate closed records", () => {
  const test = setup();
  test.socket("expired", test.now - 1);
  const connection = requireValue(test.create().connections()[0]);
  expect(() => {
    connection.send("snapshot");
  }).toThrow("App token expired");
  const session = requireValue(connection.read());
  test.records.clear();
  connection.write(session);
  expect(test.records.size).toBe(0);
});

it("removes abandoned durable records when an alarm wakes an installation with no sockets", async () => {
  const test = setup();
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  test.records.set("socket:orphan", {
    identity: createIdentity(test.now - 1),
    subscriptions: [],
  });
  await test.create().alarm();
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});
