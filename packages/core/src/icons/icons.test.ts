import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import { describe, expect, it } from "vite-plus/test";

import { createPatchsmithSchema } from "#schema/schema";

import { Icon as arktypeIcon } from "./arktype";
import { parseIconData } from "./definition";
import { lucideIconNames } from "./lucide-names.generated";
import { Icon as valibotIcon } from "./valibot";
import { Icon as zodIcon } from "./zod";

describe("icon contracts", () => {
  it("keeps the generated name list aligned with the pinned Lucide dependency", () => {
    expect(lucideIconNames).toEqual(
      expect.arrayContaining(Object.keys(dynamicIconImports))
    );
  });

  for (const [name, define] of Object.entries({
    arktype: arktypeIcon,
    valibot: valibotIcon,
    zod: zodIcon,
  })) {
    it(`validates equivalent ${name} icon props`, async () => {
      const component = define({ library: "lucide" });

      const valid = await component.fields["~standard"].validate({
        name: "arrow-right",
        size: 16,
      });

      expect(valid.issues).toBeUndefined();
      expect(component.children).toBe(false);

      // An older host must accept a name introduced by a newer app SDK.
      const future = await component.fields["~standard"].validate({
        name: "future-lucide-icon-from-newer-sdk",
      });

      expect(future.issues).toBeUndefined();

      const invalid = [
        {},
        { name: 123 },
        { name: "arrow-right", size: 0 },
        { name: "arrow-right", size: Number.NaN },
        { name: "arrow-right", strokeWidth: 2 },
        { label: "Continue", name: "arrow-right" },
        { href: "https://other.test", name: "arrow-right" },
      ];

      const results = await Promise.all(
        invalid.map(
          async (props) => await component.fields["~standard"].validate(props)
        )
      );

      for (const result of results) {
        expect(result.issues).toBeDefined();
      }
    });
  }

  it("serializes the helper under an arbitrary component name", () => {
    const schema = createPatchsmithSchema({
      components: { icon: zodIcon({ library: "lucide" }) },
    });

    const component = schema.serialize().components.icon;
    expect(component?.children).toBe(false);
    expect(component?.fields).toMatchObject({
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  });
});

describe("catalogue data validation", () => {
  it("accepts Lucide geometry and currentColor fills", () => {
    const data = {
      nodes: [["circle", { cx: 12, cy: 12, fill: "currentColor", r: 2 }]],
      size: 24,
    };

    expect(parseIconData(data)).toEqual(data);
  });

  it.each([
    { nodes: [["script", {}]], size: 24 },
    { nodes: [["use", { href: "https://other.test/icon.svg" }]], size: 24 },
    { nodes: [["path", { d: "M0 0", onLoad: "alert(1)" }]], size: 24 },
    { nodes: [["path", { fill: "url(https://other.test)" }]], size: 24 },
    { nodes: [["path", { style: "color:red" }]], size: 24 },
    { nodes: Array.from({ length: 65 }, () => ["path", {}]), size: 24 },
    { nodes: [["path", { d: "x".repeat(4097) }]], size: 24 },
    { nodes: [], size: Number.POSITIVE_INFINITY },
  ])("rejects unsafe or unbounded data: %j", (data) => {
    expect(() => parseIconData(data)).toThrow();
  });
});
