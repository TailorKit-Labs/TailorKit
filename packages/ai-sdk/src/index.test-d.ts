import { defineContract } from "@tailorkit/core/schema";
import { createServer } from "@tailorkit/core/server";
import { z } from "zod";

import { createTools } from "./index";

const server = createServer({
  baseUrl: "https://host.test/api/tailorkit",
  contract: defineContract({
    scopes: { org: z.object({ tenant: z.string() }) },
  }),
});

const tools = createTools(server, {
  scopes: { org: { tenant: "one" } },
  subjectId: "user-one",
});
void tools.create_app;
void tools.edit_app;
void tools.list_apps;

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
