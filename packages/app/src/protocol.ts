import { oc, type } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import * as v from "valibot";

export const invocationSchema = v.strictObject({
  args: v.optional(v.unknown()),
  name: v.pipe(
    v.string(),
    v.maxLength(512),
    v.regex(
      /^(?:[a-zA-Z][a-zA-Z0-9_]{0,63}|_tailorkit)(?:\.[a-zA-Z][a-zA-Z0-9_]{0,63})*$/u
    )
  ),
});
export type Invocation = v.InferOutput<typeof invocationSchema>;
export type MutationInvocation = Invocation & { requestId: string };

const procedure = oc.errors({
  BAD_REQUEST: {},
  CONFLICT: {},
  FORBIDDEN: {},
  INCOMPATIBLE_VERSION: {},
  INTERNAL_SERVER_ERROR: {},
  NOT_FOUND: {},
  UNAUTHORIZED: {},
  UNAVAILABLE: {},
});

/** Public wire contract; implementations and clients both depend on this definition. */
export const appContract = {
  actions: procedure.input(invocationSchema).output(type<unknown>()),

  mutations: procedure
    .input(
      v.strictObject({
        ...invocationSchema.entries,
        requestId: v.pipe(v.string(), v.uuid()),
      })
    )
    .output(type<unknown>()),

  queries: procedure.input(invocationSchema).output(type<unknown>()),

  // A pass-through type schema preserves the private hibernation iterator instance.
  subscribe: procedure
    .input(invocationSchema)
    .output(type<AsyncIterableIterator<unknown>>()),
};
export type PlatformClient = ContractRouterClient<typeof appContract>;
export type SubscriptionClient = Pick<PlatformClient, "subscribe">;

/** Drizzle-generated SQL exported by application bundles. */
export interface AppMigration {
  id: string;
  hash: string;
  statements: string[];
}
