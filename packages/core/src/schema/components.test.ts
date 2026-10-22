import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { PatchsmithSchemaSpec } from "#spec/spec";

import { defineContract } from "./contract";
import { createPatchsmithSchema } from "./schema";

describe("component descriptions", () => {
  it("preserves behavior guidance without adding metadata to component fields", () => {
    const description =
      "Submits on Enter.\nDisabling submission leaves inputs editable.";

    const contract = defineContract({
      components: {
        Empty: { description: "" },
        Form: {
          callbacks: { onSubmit: {} },
          children: true,
          description,
          fields: z.object({ disabled: z.boolean().optional() }),
        },
        Plain: {},
      },
    });

    const host = createPatchsmithSchema(contract);
    const serialized = host.serialize();
    const parsed = v.parse(PatchsmithSchemaSpec, serialized);
    expect(contract.components.Form.description).toBe(description);
    expect(host.$internal.components.Form.description).toBe(description);
    expect(parsed.components.Form).toMatchObject({
      callbacks: { onSubmit: {} },
      children: true,
      description,
      fields: { properties: { disabled: { type: "boolean" } } },
    });
    expect(parsed.components.Form?.fields?.properties).not.toHaveProperty(
      "description"
    );
    expect(parsed.components.Empty?.description).toBe("");
    expect(serialized.components.Plain).not.toHaveProperty("description");
    expect(parsed.components.Plain).not.toHaveProperty("description");
  });

  it.each([null, 123, true, {}, []])(
    "rejects non-string descriptions at contract, host, and serialized-schema boundaries: %j",
    (description) => {
      const components = { Form: { description } };
      expect(() =>
        defineContract({
          // @ts-expect-error Exercise invalid metadata from untyped hosts.
          components,
        })
      ).toThrow('Component "Form" description must be a string.');
      expect(() => createPatchsmithSchema({ components })).toThrow(
        'Component "Form" description must be a string.'
      );
      expect(
        v.safeParse(PatchsmithSchemaSpec, {
          components: { Form: { callbacks: {}, children: false, description } },
          version: 1,
        }).success
      ).toBe(false);
    }
  );
});
