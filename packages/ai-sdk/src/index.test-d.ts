import { defineContract } from "@patchsmith/core/schema";
import { createServer } from "@patchsmith/core/server";
import * as v from "valibot";

import { createTools } from "./index";

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
