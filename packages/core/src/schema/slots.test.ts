import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { TailorKitSchemaSpec } from "#spec/spec";

import { createTailorKitSchema } from "./schema";

describe("slot view contracts", () => {
  it("preserves true, false, and omitted multiplicity through serialization", () => {
    const host = createTailorKitSchema({
      components: {},
      slots: {
        navbar: { views: ["/"] },
        page: { multiple: true, views: ["/"] },
        panel: { multiple: false, views: ["/"] },
      },
      views: { "/": z.object({}) },
    });
    expect(TailorKitSchemaSpec.parse(host.serialize()).slots).toEqual({
      navbar: { views: ["/"] },
      page: { multiple: true, views: ["/"] },
      panel: { multiple: false, views: ["/"] },
    });
    expect(
      TailorKitSchemaSpec.safeParse({
        ...host.serialize(),
        slots: { page: { multiple: "true", views: ["/"] } },
      }).success
    ).toBe(false);
  });
  it("serializes supported view lists", () => {
    const userView = z.object({ userId: z.string() });
    const host = createTailorKitSchema({
      components: {},
      slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
      views: { "/": z.object({}), "/users": userView },
    });
    expect(host.views["/users"]).toBe(userView);
    const schema = host.serialize();
    expect(schema.views["/users"]?.context).toMatchObject({
      properties: { userId: { type: "string" } },
      required: ["userId"],
      type: "object",
    });
    expect(TailorKitSchemaSpec.parse(schema).slots).toEqual({
      navbar: { views: ["/"] },
      panel: { views: ["/users"] },
    });
  });

  it("rejects unknown view references in serialized schemas", () => {
    expect(
      TailorKitSchemaSpec.safeParse({
        components: {},
        slots: { panel: { views: ["/missing"] } },
        version: 1,
        views: { "/": {} },
      }).success
    ).toBe(false);
  });

  it("rejects invalid multiplicity in JavaScript host configurations", () => {
    expect(() =>
      createTailorKitSchema({
        components: {},

        // @ts-expect-error Exercise runtime validation for JavaScript hosts.
        slots: { page: { multiple: "true", views: ["/"] } },

        views: { "/": z.object({}) },
      })
    ).toThrow("multiple must be a boolean");
  });

  it("rejects untyped host configurations with undeclared views", () => {
    expect(() =>
      createTailorKitSchema({
        components: {},

        // @ts-expect-error Exercise runtime validation for JavaScript hosts.
        slots: { panel: { views: ["/missing"] } },

        views: { "/": z.object({}) },
      })
    ).toThrow('references undeclared view "/missing"');
  });
});
