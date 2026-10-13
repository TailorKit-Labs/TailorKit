import type { Invocation } from "@tailorkit/app/protocol";
import type { Identity } from "@tailorkit/app/server";
import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import type { ActionCapability } from "../runtime/actions";
import { createApplicationExecution } from "../runtime/bundle";
import { cancellationStream, abortable } from "../runtime/cancellation";
import { installFetchGuard } from "../runtime/context";

installFetchGuard();

export class AppFacet extends DurableObject<Record<string, never>> {
  #execution = this.ctx.blockConcurrencyWhile(async () => {
    const application = await import("application.js");
    return createApplicationExecution(application, {
      execute: (sql, params) => {
        const cursor = this.ctx.storage.sql.exec(
          sql,
          ...(params as SqlStorageValue[])
        );
        return {
          changes: cursor.rowsWritten,
          columns: cursor.columnNames,
          rows: [...cursor.raw()],
        };
      },
      transaction: (run) => this.ctx.storage.transactionSync(run),
    });
  });

  async query(input: Invocation, identity: Identity) {
    const execution = await this.#execution;
    return Effect.runSync(execution.call("query", input, identity));
  }

  async mutate(input: Invocation & { requestId: string }, identity: Identity) {
    const execution = await this.#execution;
    return Effect.runSync(execution.call("mutation", input, identity));
  }

  async action(
    input: Invocation,
    identity: Identity,
    capability: ActionCapability,
    cancellation: ReadableStream
  ) {
    const execution = await this.#execution;
    const controller = new AbortController();
    const reader = cancellation.getReader();
    const cancel = () => controller.abort();
    void (async () => {
      try {
        await reader.read();
      } catch {
        /* Either settlement cancels the action. */
      }
      cancel();
    })();
    return Effect.runPromise(
      execution
        .action(
          input,
          identity,
          {
            committed: (tables) => capability.committed(tables),
            fetch: (inputValue, init) => {
              const request = new Request(inputValue, init);
              const { signal } = request;
              signal.throwIfAborted();
              // Attached AbortSignals cannot be serialized by Workers RPC.
              const transferable = new Request(request.url, {
                body: request.body,
                headers: request.headers,
                method: request.method,
                redirect: request.redirect,
              });
              return abortable(
                capability.fetch(transferable, cancellationStream(signal)),
                signal
              );
            },
            tool: (path, inputValue2) => capability.tool(path, inputValue2),
          },
          controller.signal
        )
        .pipe(
          Effect.ensuring(
            Effect.promise(() =>
              (async () => {
                try {
                  return await reader.cancel();
                } catch {
                  /* Intentionally no action is needed. */
                }
              })()
            )
          )
        )
    );
  }
}
