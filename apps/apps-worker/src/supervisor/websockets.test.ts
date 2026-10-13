import type { Identity } from "@tailorkit/app/server";
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

const setup = () => {
  const now = Date.now();
  const records = new Map<string, SubscriptionSession>();
  let alarm: number | null = null;
  const sockets: WebSocket[] = [];
  const operations = vi.fn();
  const cancel = vi.fn();
  const ctx = {
    getWebSockets: () => sockets,
    storage: {
      // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
      deleteAlarm: async () => {
        alarm = null;
      },
      getAlarm: async () => await alarm,
      kv: {
        delete: (key: string) => records.delete(key),
        get: (key: string) => records.get(key),
        list: () => records.entries(),
        put: (key: string, value: SubscriptionSession) =>
          records.set(key, value),
      },
      // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
      setAlarm: async (time: number) => {
        alarm = time;
      },
    },
  } as unknown as DurableObjectState;
  vi.stubGlobal("WebSocket", { CLOSED: 3 });
  const socket = (id: string, expiresAt: number) => {
    const socketValue = {
      close: vi.fn(),
      deserializeAttachment: () => id,
      readyState: 2,
      send: vi.fn(),
    } as unknown as WebSocket;
    records.set(`socket:${id}`, {
      identity: { expiresAt } as Identity,
      subscriptions: [],
    });
    sockets.push(socketValue);
    return socketValue;
  };
  return {
    cancel,
    create: () =>
      createSubscriptions(
        ctx,
        (input, identity) => Effect.promise(() => operations(input, identity)),
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
  const socket = test.socket("expired", test.now - 1);
  await test.create().message(socket, "{}");
  expect(socket.close).toHaveBeenCalledWith(1008, "Authentication expired");
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
  await test.create().close(active, 1000, "Renew authentication");
  expect(active.close).toHaveBeenCalledWith(1000, "Renew authentication");
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});

it("rejects delivery for expired sessions and cannot recreate closed records", () => {
  const test = setup();
  test.socket("expired", test.now - 1);
  const connection = requireValue(test.create().connections()[0]);
  expect(() => connection.send("snapshot")).toThrow("App token expired");
  const session = requireValue(connection.read());
  test.records.clear();
  connection.write(session);
  expect(test.records.size).toBe(0);
});

it("removes abandoned durable records when an alarm wakes an installation with no sockets", async () => {
  const test = setup();
  test.records.set("socket:orphan", {
    identity: { expiresAt: test.now - 1 } as Identity,
    subscriptions: [],
  });
  await test.create().alarm();
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});
