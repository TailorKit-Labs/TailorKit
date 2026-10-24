import * as v from "valibot";
import { expect, it, vi } from "vite-plus/test";

import { resolveStaticInstances } from "./instances";

const entry = { data: { id: "reports" }, key: "reports", metadata: {} };

it("evaluates once without runtime capabilities and stores parsed schema output", async () => {
  const resolve = vi.fn(() => [entry]);

  const snapshots = await resolveStaticInstances([
    {
      dataSchema: v.object({
        id: v.pipe(
          v.string(),
          v.transform((id) => id.toUpperCase())
        ),
      }),
      name: "reports",
      resolve,
    },
    { dataSchema: v.object({}), name: "empty", resolve: () => [] },
  ]);

  expect(snapshots).toEqual({
    empty: [],
    reports: [{ ...entry, data: { id: "REPORTS" } }],
  });
  expect(resolve).toHaveBeenCalledExactlyOnceWith();
});

it.each([
  { entries: [entry, entry], schema: v.object({ id: v.string() }) },
  {
    entries: [{ ...entry, data: { id: 42 } }],
    schema: v.object({ id: v.string() }),
  },
  {
    entries: Array.from({ length: 1001 }, (_, index) => ({
      ...entry,
      key: String(index),
    })),
    schema: v.unknown(),
  },
])(
  "rejects duplicate keys, invalid data, and oversized snapshots",
  async ({ entries, schema }) => {
    await expect(
      resolveStaticInstances([
        { dataSchema: schema, name: "reports", resolve: () => entries },
      ])
    ).rejects.toThrow("Unable to build static instances for reports");
  }
);

interface Cycle {
  self?: Cycle;
}

const cycle: Cycle = {};

cycle.self = cycle;

it.each([
  undefined,
  1n,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  new Date(),
  new Map(),
  () => null,
  cycle,
  [undefined],
  // oxlint-disable-next-line unicorn/no-new-array -- Deliberately create a sparse array to check lossless JSON validation.
  new Array<null>(1),
])("rejects non-JSON schema output: %#", async (data) => {
  await expect(
    resolveStaticInstances([
      {
        dataSchema: v.unknown(),
        name: "invalid",
        resolve: () => [{ ...entry, data }],
      },
    ])
  ).rejects.toHaveProperty(
    "cause.message",
    "Static instances must contain at most 1000 entries with JSON-compatible data and metadata."
  );
});
