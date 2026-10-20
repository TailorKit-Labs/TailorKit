import { z } from "zod";

import { defineContract } from "./index";
import { createServer, defineServer, query } from "./server";

const scopes = { workspace: { workspaceId: "workspace" } };
const host = createServer({
  baseUrl: "https://host.test/api/patchsmith",
  contract: defineContract({
    scopes: { workspace: z.object({ workspaceId: z.string() }) },
  }),
});
const request = new Request("https://host.test/api/patchsmith/apps");

void host.handler(request, {
  authenticate: () => ({ scopes, subjectId: "user" }),
});
void host.handler(request, {
  // @ts-expect-error The public host API requires an authenticated subject alongside scopes.
  authenticate: () => ({ scopes }),
});
void host.handler(request, {
  // @ts-expect-error Async authentication must also return a verified subject.
  authenticate: async () => await Promise.resolve({ scopes }),
});

defineServer({
  subject: query({
    args: z.undefined(),
    handler: ({ identity }) => identity.subjectId satisfies string,
  }),
});
