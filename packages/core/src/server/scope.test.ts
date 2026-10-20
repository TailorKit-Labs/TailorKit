import type { StandardSchemaV1 } from "@standard-schema/spec";
import { type as arktype } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import {
  normalizePatchsmithScope,
  validatePatchsmithScopeSchemas,
  validatePatchsmithScopes,
} from "./scope";

interface CyclicScopeFixture {
  ok: boolean;
  self?: CyclicScopeFixture;
}

interface NestedScopeFixture {
  child: string | NestedScopeFixture;
}

describe("Patchsmith named scope validation", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const input = {
      orgs: [{ a: 2, z: 1 }, { b: { a: 4, z: 3 } }],
      userId: "user_1",
    };

    const scope = normalizePatchsmithScope(input);

    expect(Object.keys(scope)).toEqual(["orgs", "userId"]);
    expect(scope).toEqual({
      orgs: [{ a: 2, z: 1 }, { b: { a: 4, z: 3 } }],
      userId: "user_1",
    });
    expect(scope).not.toBe(input);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(input).toEqual({
      orgs: [{ a: 2, z: 1 }, { b: { a: 4, z: 3 } }],
      userId: "user_1",
    });
  });

  it("validates each declared scope with its Standard Schema and uses the parsed output", async () => {
    const scopes = {
      org: z
        .object({ tenant: z.string() })
        .transform(({ tenant }) => ({ tenant: tenant.trim() })),
      user: z.object({ id: z.string() }),
    };

    await expect(
      validatePatchsmithScopes(scopes, {
        org: { tenant: "  org_1  " },
        user: { id: "user_1" },
      })
    ).resolves.toEqual({ org: { tenant: "org_1" }, user: { id: "user_1" } });
  });

  it("accepts Standard Schema validators without a JSON Schema converter", async () => {
    const schema: StandardSchemaV1<
      { workspaceId: string },
      { workspaceId: string }
    > = {
      "~standard": {
        validate: (value) => {
          const parsed = z.object({ workspaceId: z.string() }).safeParse(value);

          return parsed.success
            ? { value: parsed.data }
            : { issues: [{ message: "workspaceId is required" }] };
        },
        vendor: "scope-test",
        version: 1,
      },
    };

    await expect(
      validatePatchsmithScopes(
        { workspace: schema },
        { workspace: { workspaceId: "workspace_1" } }
      )
    ).resolves.toEqual({ workspace: { workspaceId: "workspace_1" } });
  });

  it("accepts Zod, ArkType, and Valibot Standard Schema validators with nested JSON values", async () => {
    const validators = {
      arktype: arktype({ payload: "unknown" }),
      valibot: v.object({ payload: v.unknown() }),
      zod: z.object({ payload: z.unknown() }),
    };

    const payload = [3, { a: 2, z: "last" }, 1];

    await expect(
      validatePatchsmithScopes(validators, {
        arktype: { payload },
        valibot: { payload },
        zod: { payload },
      })
    ).resolves.toEqual({
      arktype: { payload: [3, { a: 2, z: "last" }, 1] },
      valibot: { payload: [3, { a: 2, z: "last" }, 1] },
      zod: { payload: [3, { a: 2, z: "last" }, 1] },
    });
  });

  it("allows configured scopes to be absent for unauthenticated identities", async () => {
    const validators = {
      org: z.object({ orgId: z.string() }),
      userOrg: z.object({ orgId: z.string(), userId: z.string() }),
    };

    await expect(
      validatePatchsmithScopes(validators, { org: { orgId: "org_1" } })
    ).resolves.toEqual({ org: { orgId: "org_1" } });
  });

  it("requires at least one declared and authenticated scope", async () => {
    expect(() => validatePatchsmithScopeSchemas({})).toThrow(
      /at least one named scope/u
    );
    expect(() =>
      validatePatchsmithScopeSchemas(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`scope${index}`, z.any()])
        )
      )
    ).toThrow(/at most 32 named scopes/u);
    await expect(
      validatePatchsmithScopes({ org: z.object({ id: z.string() }) }, {})
    ).rejects.toThrow(/at least one scope/u);
    await expect(
      validatePatchsmithScopes(
        { org: z.object({ id: z.string() }) },
        { team: { id: "team_1" } }
      )
    ).rejects.toThrow(/undeclared scope "team"/u);
  });

  it("accepts explicit JSON values, including empty nested arrays and objects", () => {
    expect(
      normalizePatchsmithScope({
        values: ["", null, true, false, 0, 1.25, [], {}],
      })
    ).toEqual({ values: ["", null, true, false, 0, 1.25, [], {}] });
  });

  it("rejects __proto__ properties at every scope depth", () => {
    expect(() =>
      normalizePatchsmithScope(JSON.parse('{"__proto__":"value"}'))
    ).toThrow(/__proto__/u);
    expect(() =>
      normalizePatchsmithScope(JSON.parse('{"nested":{"__proto__":"value"}}'))
    ).toThrow(/__proto__/u);
  });

  it("rejects non-JSON values and non-plain objects", () => {
    const circular: CyclicScopeFixture = { ok: true };
    circular.self = circular;

    const withAccessor = Object.defineProperty({ ok: true }, "value", {
      enumerable: true,
      get: () => "not data",
    });

    const withSymbol = { ok: true, [Symbol("key")]: "not JSON" };
    const arrayWithHole: unknown[] = [];
    arrayWithHole.length = 1;
    const arrayWithExtra = Object.assign(["ok"], { extra: true });

    const withCustomPrototype: unknown = Object.assign(
      Object.create({ inherited: true }),
      { ok: true }
    );

    for (const value of [
      {},
      new Date(),
      { value: undefined },
      { value: () => "not JSON" },
      { value: Symbol("not JSON") },
      { value: 1n },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: -0 },
      { value: Number.MAX_SAFE_INTEGER + 1 },
      circular,
      withAccessor,
      withSymbol,
      { value: arrayWithHole },
      { value: arrayWithExtra },
      withCustomPrototype,
    ]) {
      expect(() => normalizePatchsmithScope(value)).toThrow();
    }
  });

  it("enforces key, value, array, depth, node, and serialized size limits", () => {
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`field${index}`, index])
    );

    const tooManyArrayItems = {
      value: Array.from({ length: 101 }, (_, index) => index),
    };

    let deepValue: string | NestedScopeFixture = "leaf";

    for (let index = 0; index < 17; index += 1) {
      deepValue = { child: deepValue };
    }

    const tooDeep = { value: deepValue };

    const tooLarge = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `field${index}`,
        "é".repeat(255),
      ])
    );

    const withinNodeLimit = {
      extra: Array.from({ length: 4 }, () => 0),
      groups: Array.from({ length: 5 }, () =>
        Array.from({ length: 100 }, () => 0)
      ),
      // root + groups + five arrays + 500 items + extra + four items = 512
    };

    const beyondNodeLimit = { ...withinNodeLimit, extra: [0, 0, 0, 0, 0] };

    expect(() => normalizePatchsmithScope(tooManyKeys)).toThrow(/at most 32/u);
    expect(() => normalizePatchsmithScope({ ["k".repeat(65)]: 1 })).toThrow(
      /1 to 64/u
    );
    expect(() => normalizePatchsmithScope({ value: "x".repeat(256) })).toThrow(
      /255 characters/u
    );
    expect(() => normalizePatchsmithScope(tooManyArrayItems)).toThrow(
      /at most 100/u
    );
    expect(() => normalizePatchsmithScope(tooDeep)).toThrow(/16 levels/u);
    expect(() => normalizePatchsmithScope(tooLarge)).toThrow(/16384 bytes/u);
    expect(() => normalizePatchsmithScope(withinNodeLimit)).not.toThrow();
    expect(() => normalizePatchsmithScope(beyondNodeLimit)).toThrow(
      /at most 512 JSON values/u
    );
  });
});
