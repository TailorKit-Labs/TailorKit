import type { StandardSchemaV1 } from "@standard-schema/spec";
import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

import { createTailorKitServer } from "./handler";
import type { TailorKitServerOptions, TailorKitHostContext } from "./types";

expectTypeOf<TailorKitHostContext<{ org: { orgId: string } }>>().toEqualTypeOf<{
  scopes: { org: { orgId: string } };
  subjectId?: string;
}>();

createTailorKitServer({
  baseUrl: "https://example.com/api/tailorkit",
  components: {},
  scopes: { account: z.object({ accountId: z.string() }) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
  views: { "/": z.object({}), "/users": z.object({}) },
});
createTailorKitServer({
  baseUrl: "https://example.com/api/tailorkit",

  components: {},

  scopes: { account: z.object({ accountId: z.string() }) },

  // @ts-expect-error A slot cannot reference an undeclared global view.
  slots: { panel: { views: ["/missing"] } },

  views: { "/": z.object({}) },
});

const namedScopes = {
  org: z.object({ orgId: z.string() }),
  userOrg: z.object({ orgId: z.string(), userId: z.string() }),
};
const scopedServer = createTailorKitServer({
  baseUrl: "https://example.com/api/tailorkit",
  components: {},
  scopes: namedScopes,
});
const explicitlyTypedOptions: TailorKitServerOptions<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  typeof namedScopes
> = {
  baseUrl: "https://example.com/api/tailorkit",
  components: {},
  scopes: namedScopes,
};
const explicitlyTypedServer = createTailorKitServer(explicitlyTypedOptions);
explicitlyTypedServer.handler(
  new Request("https://example.com/api/tailorkit/apps"),
  {
    authenticate: () => ({
      scopes: {
        // @ts-expect-error explicit options retain the org schema's required orgId
        org: {},
      },
    }),
  }
);
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    scopes: {
      org: { orgId: "org_1" },
      userOrg: { orgId: "org_1", userId: "user_1" },
    },
  }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  // @ts-expect-error authenticate must provide at least one declared scope
  authenticate: () => ({ scopes: {} }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    scopes: {
      // @ts-expect-error org is inferred from its schema and requires orgId
      org: {},
    },
  }),
});

const nonJsonSchemaScope = {
  "~standard": {
    types: {} as StandardSchemaV1.Types<
      { accountId: string },
      { accountId: string }
    >,
    validate: (value: unknown) => ({ value: value as { accountId: string } }),
    vendor: "core-type-test",
    version: 1 as const,
  },
} satisfies StandardSchemaV1<{ accountId: string }, { accountId: string }>;

const standardOnlyServer = createTailorKitServer({
  baseUrl: "https://example.com/api/tailorkit",
  components: {},
  scopes: { account: nonJsonSchemaScope },
});
standardOnlyServer.handler(
  new Request("https://example.com/api/tailorkit/apps"),
  {
    authenticate: () => ({ scopes: { account: { accountId: "acct_1" } } }),
  }
);
