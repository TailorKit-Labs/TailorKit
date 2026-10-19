import * as v from "valibot";
import { vi } from "vite-plus/test";
import { z } from "zod";

import { defineServer, fn } from "./server";
import { defineView } from "./views";

const server = defineServer({
  reports: {
    count: fn.query.handler(() => 1),
    fetch: fn.action.handler(
      vi.fn<() => Promise<null>>().mockResolvedValue(null)
    ),
    list: fn.query
      .input(z.object({ userId: z.string() }))
      .handler(({ input }) => [{ id: input.userId }]),
    write: fn.mutation.handler(() => null),
  },
});
type ServerFunctions = typeof server.functions;
declare module "./views" {
  // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Generated bindings augment this public interface through declaration merging.
  interface PatchSmithServerFunctions extends ServerFunctions {}
}

defineView({
  component: () => null,
  instances: {
    dataSchema: z.object({ reportId: z.string() }),
    resolve: async ({ context, queries, identity, signal, ...other }) => {
      const user: string = context.userId;
      const count: number = await queries.reports.count();
      const reports: { id: string }[] = await queries.reports.list({
        userId: user,
      });
      const installationId: string = identity.installationId;
      const abort: boolean = signal.aborted;
      void count;
      void installationId;
      void abort;
      // @ts-expect-error Query inputs are inferred from the server definition.
      void queries.reports.list({ userId: 123 });
      // @ts-expect-error Required query inputs cannot be omitted.
      void queries.reports.list();
      // @ts-expect-error Mutation functions are not exposed.
      void queries.reports.write;
      // @ts-expect-error Action functions are not exposed.
      void queries.reports.fetch;
      // @ts-expect-error Resolver context has no arbitrary input.
      void other.input;
      // @ts-expect-error Resolver context has no mutation capability.
      void other.mutations;
      return reports.map((report) => ({
        data: { reportId: report.id },
        key: report.id,
        metadata: { title: "Report" },
      }));
    },
  },
  slot: "page",
  view: "/users",
});
defineView({
  component: () => null,
  instances: {
    dataSchema: z.object({ reportId: z.string() }),
    // @ts-expect-error Each instance's data must match dataSchema.
    resolve: () => [{ data: { reportId: 123 }, key: "overview", metadata: {} }],
  },
  slot: "page",
  view: "/",
});

const instanceView = defineView({
  component: () => null,
  instances: {
    dataSchema: v.object({ count: v.pipe(v.string(), v.transform(Number)) }),
    resolve: () => [{ data: { count: "42" }, key: "summary", metadata: {} }],
  },
  slot: "page",
  view: "/",
});
const selected = instanceView.useInstance();
const selectedKey: string = selected.key;
const parsedCount: number = selected.data.count;
void selectedKey;
void parsedCount;
// @ts-expect-error instance data is the parsed schema output
const _rawCount: string = selected.data.count;
// @ts-expect-error instance data fields are inferred from the schema
void selected.data.missing;
