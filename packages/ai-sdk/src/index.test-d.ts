import { defineContract } from "@patchsmith/core/schema";
import { createServer } from "@patchsmith/core/server";
import type { InferToolInput, InferToolOutput } from "ai";
import * as v from "valibot";
import { expectTypeOf } from "vite-plus/test";

import { createTools } from "./index";
import type { PatchsmithToolOutput } from "./index";

const server = createServer({
  baseUrl: "https://host.test/api/patchsmith",
  contract: defineContract({
    scopes: { org: v.object({ tenant: v.string() }) },
  }),
});

const tools = createTools(server, {
  scopes: { org: { tenant: "one" } },
  subjectId: "user-one",
});

void tools.createApp;

void tools.editApp;

void tools.listApps;

expectTypeOf<InferToolInput<typeof tools.createApp>>().toEqualTypeOf<{
  description?: string;
  name: string;
  prompt: string;
  scope: string;
}>();

expectTypeOf<InferToolInput<typeof tools.editApp>>().toEqualTypeOf<{
  appId: string;
  prompt: string;
  threadId?: string;
}>();

expectTypeOf<InferToolInput<typeof tools.listApps>>().toEqualTypeOf<{
  page: number;
  pageSize: number;
}>();

expectTypeOf<
  InferToolOutput<typeof tools.createApp>
>().toEqualTypeOf<PatchsmithToolOutput>();

expectTypeOf<
  InferToolOutput<typeof tools.editApp>
>().toEqualTypeOf<PatchsmithToolOutput>();

expectTypeOf<
  InferToolOutput<typeof tools.listApps>
>().toEqualTypeOf<PatchsmithToolOutput>();

expectTypeOf(tools.createApp.execute).toBeFunction();

expectTypeOf(tools.editApp.execute).toBeFunction();

expectTypeOf(tools.listApps.execute).toBeFunction();

// @ts-expect-error The host context requires an authenticated subject.
createTools(server, { scopes: { org: { tenant: "one" } } });

createTools(server, {
  // @ts-expect-error Scope values retain the server contract's types.
  scopes: { org: { tenant: 1 } },
  subjectId: "user-one",
});

createTools(server, {
  // @ts-expect-error Scope names must match the server contract.
  scopes: { user: { tenant: "one" } },
  subjectId: "user-one",
});
