import type { Invocation } from "@tailorkit/app/protocol";
import type { Identity } from "@tailorkit/app/server";
import { AppError } from "@tailorkit/app/server";
import { Effect } from "effect";
import type { Semaphore } from "effect";
import { catch as catchEffect } from "effect/Effect";

import { ALL_DATABASE_TABLES } from "../runtime/database/dependencies";
import {
  subscriptionStream,
  deliverSubscription,
  createSubscriptionHandler,
} from "../transport";

export interface SubscriptionSession {
  identity: Identity;
  subscriptions: { id: string; input: Invocation; tables: string[] }[];
}
export interface SubscriptionConnection {
  read: () => SubscriptionSession | undefined;
  write: (session: SubscriptionSession) => void;
  send: (data: string | Uint8Array<ArrayBuffer>) => unknown;
}

/** Dependency tracking is independent of socket encoding and provider storage. */
const removeImplementation = (
  connectionValue: SubscriptionConnection,
  id: string
) =>
  Effect.sync(() => {
    const session = connectionValue.read();
    if (!session) {
      return;
    }
    session.subscriptions = session.subscriptions.filter(
      (subscription) => subscription.id !== id
    );
    connectionValue.write(session);
  });

const keyImplementation = (socket: WebSocket) =>
  `socket:${socket.deserializeAttachment() as string}`;

export const createSubscriptions = (
  ctx: DurableObjectState,
  query: (
    input: Invocation,
    identity: Identity
  ) => Effect.Effect<{ value: unknown; tables: string[] }, unknown>,
  queue: Semaphore.Semaphore
) => {
  const handler = createSubscriptionHandler();
  const key = keyImplementation;
  const connection = (socket: WebSocket): SubscriptionConnection => ({
    read: () => ctx.storage.kv.get<SubscriptionSession>(key(socket)),
    send: (data) => {
      const session = ctx.storage.kv.get<SubscriptionSession>(key(socket));
      if (!session || session.identity.expiresAt <= Date.now()) {
        socket.close(1008, "Authentication expired");
        throw new AppError("UNAUTHORIZED", "App token expired");
      }
      socket.send(data);
    },
    write: (session) => {
      if (ctx.storage.kv.get(key(socket))) {
        ctx.storage.kv.put(key(socket), session);
      }
    },
  });
  const connections = () =>
    ctx
      .getWebSockets()
      .map(connection)
      .filter((current) => current.read());
  const arm = async () => {
    // Read after the await so concurrently accepted sockets are included.
    const current = await ctx.storage.getAlarm();
    const expiries = connections().flatMap((socket) => {
      const session = socket.read();
      return session ? [session.identity.expiresAt] : [];
    });
    if (!expiries.length) {
      await ctx.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...expiries);
    if (current !== next) {
      await ctx.storage.setAlarm(next);
    }
  };
  const remove = removeImplementation;
  const deliver = (
    connectionValue2: SubscriptionConnection,
    id: string,
    execute = query
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* deliverSnapshot() {
      const session = connectionValue2.read();
      const subscription = session?.subscriptions.find(
        (entry) => entry.id === id
      );
      if (!session || !subscription) {
        return;
      }
      const snapshot = yield* execute(subscription.input, session.identity);
      const current = connectionValue2.read();
      const active = current?.subscriptions.find((entry) => entry.id === id);
      if (!current || !active) {
        return;
      }
      active.tables = snapshot.tables;
      connectionValue2.write(current);
      yield* deliverSubscription(connectionValue2, id, snapshot.value);
    }).pipe(
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This is an Effect recovery operator or transport callback, not a Node-style completion callback.
      catchEffect((err) =>
        remove(connectionValue2, id).pipe(
          Effect.andThen(deliverSubscription(connectionValue2, id, err, true))
        )
      ),
      catchEffect(() => Effect.void)
    );
  const subscribe = (
    connectionValue3: SubscriptionConnection,
    input: Invocation,
    id: string
  ) =>
    queue.withPermits(1)(
      Effect.gen(function* subscribeValue() {
        const session = connectionValue3.read();
        if (!session) {
          return;
        }
        const count = connections().reduce(
          (total, current) =>
            total + (current.read()?.subscriptions.length ?? 0),
          0
        );
        if (count >= 256) {
          yield* deliverSubscription(
            connectionValue3,
            id,
            new AppError(
              "BAD_REQUEST",
              "Installation subscription limit exceeded"
            ),
            true
          );
          return;
        }
        session.subscriptions.push({ id, input, tables: [] });
        connectionValue3.write(session);
        yield* deliver(connectionValue3, id);
      })
    );
  return {
    async alarm() {
      const sockets = ctx.getWebSockets();
      const active = new Set(sockets.map(key));
      for (const [stored] of ctx.storage.kv.list({ prefix: "socket:" })) {
        if (!active.has(stored)) {
          ctx.storage.kv.delete(stored);
        }
      }
      for (const socket of sockets) {
        const session = connection(socket).read();
        if (!session || session.identity.expiresAt <= Date.now()) {
          ctx.storage.kv.delete(key(socket));
          socket.close(1008, "Authentication expired");
        }
      }
      await arm();
    },
    cancel: (connectionValue4: SubscriptionConnection, id: string) =>
      queue.withPermits(1)(remove(connectionValue4, id)),
    async close(socket: WebSocket, code = 1000, reason = "") {
      ctx.storage.kv.delete(key(socket));
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.close(code, reason);
      }
      await handler.close(socket);
      await arm();
    },
    connections,
    message(socket: WebSocket, message: string | ArrayBuffer) {
      const current = connection(socket);
      const session = current.read();
      if (!session || session.identity.expiresAt <= Date.now()) {
        ctx.storage.kv.delete(key(socket));
        socket.close(1008, "Authentication expired");
        return Promise.resolve();
      }
      return handler.message(
        socket,
        message,
        (input) => subscriptionStream((id) => subscribe(current, input, id)),
        (id) => Effect.runPromise(queue.withPermits(1)(remove(current, id)))
      );
    },
    async open(identity: Identity) {
      if (connections().length >= 128) {
        throw new AppError(
          "BAD_REQUEST",
          "Installation connection limit exceeded"
        );
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      ctx.acceptWebSocket(server);
      server.serializeAttachment(crypto.randomUUID());
      ctx.storage.kv.put(key(server), {
        identity,
        subscriptions: [],
      } satisfies SubscriptionSession);
      await arm();
      return new Response(null, {
        headers: { "sec-websocket-protocol": "tailorkit" },
        status: 101,
        webSocket: client,
      });
    },
    /** External mutations and local action notifications serialize subscriber refreshes. */
    refresh(tables: string[], execute = query) {
      if (!tables.length) {
        return Effect.void;
      }
      return Effect.gen(function* refresh() {
        for (const connectionValue5 of connections()) {
          for (const subscription of connectionValue5.read()?.subscriptions ??
            []) {
            if (
              subscription.tables.some(
                (table) =>
                  table === ALL_DATABASE_TABLES || tables.includes(table)
              )
            ) {
              yield* deliver(connectionValue5, subscription.id, execute);
            }
          }
        }
      });
    },
    subscribe,
  };
};
