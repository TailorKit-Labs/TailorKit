import { afterEach, expect, it, vi } from "vite-plus/test";

import { readInitEnvironment } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  { expected: undefined, value: undefined },
  { expected: 0, value: "0" },
  { expected: 120, value: "120" },
  { expected: 120, value: " 120 " },
])("reads minimum release age $value as $expected", ({ expected, value }) => {
  vi.stubEnv("PNPM_CONFIG_MINIMUM_RELEASE_AGE", value);
  expect(readInitEnvironment().minimumReleaseAge).toBe(expected);
});

it.each(["", " ", "\t\n", "-1", "0.5", "invalid"])(
  "rejects invalid minimum release age %j",
  (value) => {
    vi.stubEnv("PNPM_CONFIG_MINIMUM_RELEASE_AGE", value);
    expect(() => readInitEnvironment()).toThrow();
  }
);
