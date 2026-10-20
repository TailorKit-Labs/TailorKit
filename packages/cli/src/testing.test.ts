import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it, vi } from "vite-plus/test";

it("forwards fixture arguments and resolves the result of each invocation", async () => {
  let count = 0;
  const operation = vi.fn((name: string, amount: number) => {
    count += amount;
    return `${name}:${count}`;
  });
  const fixture = asyncFixture(operation);
  const first = fixture("first", 2);
  expect(first).toBeInstanceOf(Promise);
  await expect(first).resolves.toBe("first:2");
  await expect(fixture("second", 3)).resolves.toBe("second:5");
  expect(operation.mock.calls).toEqual([
    ["first", 2],
    ["second", 3],
  ]);
});

it("rejects synchronous failures without throwing at the call site", async () => {
  const failure = new Error("Fixture failure");
  const fixture = asyncFixture(() => {
    throw failure;
  });
  const result = fixture();
  await expect(result).rejects.toBe(failure);
});

it("awaits asynchronous results and preserves their original failures", async () => {
  const failure = new Error("Async fixture failure");
  const operation = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce("ready")
    .mockRejectedValueOnce(failure);
  const fixture = asyncFixture(operation);
  await expect(fixture()).resolves.toBe("ready");
  await expect(fixture()).rejects.toBe(failure);
});
