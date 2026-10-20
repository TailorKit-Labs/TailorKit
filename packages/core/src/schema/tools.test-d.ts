import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

import { createServer } from "#server/contract";

import { defineContract } from "./contract";
import { tool } from "./tools";
import type { ToolCallers, ToolImplementations } from "./tools";

const contract = defineContract({
  tools: {
    data: {
      read: tool
        .server()
        .input(z.string().transform(Number))
        .output(z.number()),
      sync: tool.server(),
      transformed: tool
        .server()
        .output(z.string().transform(Number).pipe(z.number())),
    },
    ui: { open: tool.client().input(z.string()).output(z.boolean()) },
  },
});
declare const frontend: ToolCallers<typeof contract.tools>;
declare const backend: ToolCallers<typeof contract.tools, "server">;
expectTypeOf(frontend.ui.open("details")).toEqualTypeOf<Promise<boolean>>();
expectTypeOf(backend.data.read("1")).toEqualTypeOf<Promise<number>>();
expectTypeOf(backend.data.sync()).toEqualTypeOf<Promise<void>>();
expectTypeOf(backend.data.transformed()).toEqualTypeOf<Promise<number>>();
// @ts-expect-error client tools are unavailable in backend callers
void backend.ui;
// @ts-expect-error caller input uses the schema's input type
void backend.data.read(1);
const implementations: ToolImplementations<typeof contract.tools, "server"> = {
  data: {
    read: ({ input }) => input + 1,
    sync: () => {},
    transformed: () => "42",
  },
};
const server = createServer({
  baseUrl: "https://example.com/api/patchsmith",
  contract,
  tools: implementations,
});
// @ts-expect-error the public base URL is required
createServer({ contract, tools: implementations });
createServer({
  // @ts-expect-error authentication belongs in handler options
  authenticate: () => null,

  baseUrl: "https://example.com/api/patchsmith",

  contract,

  tools: implementations,
});
// @ts-expect-error handler authentication is required
void server.handler(new Request("https://example.com/api/patchsmith/apps"));
// @ts-expect-error handler options must include authentication
void server.handler(new Request("https://example.com/api/patchsmith/apps"), {});
void server.handler(new Request("https://example.com/api/patchsmith/apps"), {
  authenticate: () => null,
});
// @ts-expect-error declared server tools need implementations
createServer({ baseUrl: "https://example.com/api/patchsmith", contract });
createServer({
  baseUrl: "https://example.com/api/patchsmith",
  contract,
  // @ts-expect-error a server cannot implement client tools
  tools: { ...implementations, ui: { open: () => true } },
});
