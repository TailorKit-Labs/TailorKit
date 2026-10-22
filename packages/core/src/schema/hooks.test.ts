import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineContract } from "./contract";
import { hook } from "./hooks";
import { createPatchsmithSchema } from "./schema";

it("serializes hook payloads in the direction seen by app handlers", () => {
  const contract = defineContract({
    hooks: {
      sync: hook()
        .input(
          z
            .string()
            .transform((value) => value.length)
            .pipe(z.number())
        )
        .output(
          z
            .string()
            .transform((value) => value.length)
            .pipe(z.number())
        ),
    },
  });

  const serialized = createPatchsmithSchema({ ...contract }).serialize();
  expect(serialized.hooks.sync?.input).toMatchObject({ type: "number" });
  expect(serialized.hooks.sync?.output).toMatchObject({ type: "string" });
});

it("rejects invalid hook names and keeps hook builders immutable", () => {
  const base = hook();
  const configured = base.input(z.string()).output(z.number());
  expect(base.definition).toEqual({ input: undefined, output: undefined });
  expect(configured.definition.input).toBeDefined();
  expect(
    defineContract({ hooks: { "customers.sync": configured } }).hooks[
      "customers.sync"
    ]
  ).toBe(configured);

  for (const name of [
    "",
    "a..b",
    "constructor",
    "a.prototype",
    "_private",
    "a/b",
  ]) {
    expect(() => defineContract({ hooks: { [name]: base } })).toThrow(
      "Invalid hook name"
    );
  }
});
