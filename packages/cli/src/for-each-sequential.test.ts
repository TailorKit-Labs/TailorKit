import { expect, it } from "vite-plus/test";

import { forEachSequential } from "./for-each-sequential";

it("waits for each operation and stops before starting later work after a failure", async () => {
  const first = Promise.withResolvers<boolean>();
  const started: number[] = [];
  const completed: number[] = [];
  const failure = new Error("Second operation failed");
  const run = forEachSequential([1, 2, 3], async (value) => {
    started.push(value);
    if (value === 1) {
      await first.promise;
    }
    if (value === 2) {
      throw failure;
    }
    completed.push(value);
  });
  expect(started).toEqual([1]);
  expect(completed).toEqual([]);
  first.resolve(true);
  await expect(run).rejects.toBe(failure);
  expect(started).toEqual([1, 2]);
  expect(completed).toEqual([1]);
});
