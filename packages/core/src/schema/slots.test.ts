import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { TailorKitSchemaSpec } from "#spec/spec";

import { defineContract } from "./contract";
import { createTailorKitSchema } from "./schema";

describe("slot view contracts", () => {
  it("preserves descriptions through contract serialization and schema parsing", () => {
    const contract = defineContract({
      slots: {
        empty: { description: "", views: ["/"] },
        navbar: { views: ["/"] },
        page: {
          description: "Main workspace.\nFills the available width.",
          multiple: true,
          views: ["/"],
        },
        panel: {
          description: "Right-hand panel, typically 360px wide.",
          views: ["/"],
        },
      },
      views: { "/": z.object({}) },
    });
    const schema = createTailorKitSchema(contract).serialize();
    expect(TailorKitSchemaSpec.parse(schema).slots).toEqual({
      empty: { description: "", views: ["/"] },
      navbar: { views: ["/"] },
      page: {
        description: "Main workspace.\nFills the available width.",
        multiple: true,
        views: ["/"],
      },
      panel: {
        description: "Right-hand panel, typically 360px wide.",
        views: ["/"],
      },
    });
  });

  it.each([null, 360, true, {}, []])(
    "rejects a non-string description %j at each host boundary",
    (description) => {
      expect(() =>
        defineContract({
          // @ts-expect-error Exercise runtime validation for JavaScript hosts.
          slots: { panel: { description, views: ["/"] } },
          views: { "/": z.object({}) },
        })
      ).toThrow('Slot "panel" description must be a string.');
      expect(() =>
        createTailorKitSchema({
          components: {},
          // @ts-expect-error Exercise runtime validation for JavaScript hosts.
          slots: { panel: { description, views: ["/"] } },
          views: { "/": z.object({}) },
        })
      ).toThrow('Slot "panel" description must be a string.');
      expect(
        TailorKitSchemaSpec.safeParse({
          components: {},
          slots: { panel: { description, views: ["/"] } },
          version: 1,
          views: { "/": {} },
        }).success
      ).toBe(false);
    }
  );

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
