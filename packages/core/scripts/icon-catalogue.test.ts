import { readFile } from "node:fs/promises";

import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { iconCatalogueVersion } from "#icons/definition";
import { lucideIconNames } from "#icons/lucide-names.generated";

import { extendIconCatalogue, iconCatalogueSchema } from "./icon-catalogue";
import type { IconCatalogue } from "./icon-catalogue";

const original = { nodes: [], size: 24 };
const changed = { nodes: [], size: 16 };

const previous: IconCatalogue = {
  icons: { "old-name": original, "renamed-in-upstream": original },
  library: "lucide",
  licenses: { "1.0.0": "original license" },
  version: "v1",
};

describe("additive icon catalogue", () => {
  it("keeps old names and geometry across upstream updates and removals", () => {
    const updated = extendIconCatalogue(previous, {
      icons: { "new-name": changed, "old-name": changed },
      license: "updated license",
      version: "2.0.0",
    });

    expect(updated.icons).toEqual({
      "new-name": changed,
      "old-name": original,
      "renamed-in-upstream": original,
    });
    expect(updated.licenses).toEqual({
      "1.0.0": "original license",
      "2.0.0": "updated license",
    });
    expect(updated.version).toBe("v1");
    expect(previous.icons).not.toHaveProperty("new-name");
  });

  it("keeps the committed catalogue, SDK suggestions, and upstream additions aligned", async () => {
    const catalogue = v.parse(
      iconCatalogueSchema,
      JSON.parse(
        await readFile(
          new URL(
            `../../../apps/icons-assets/catalogues/lucide-${iconCatalogueVersion}.generated.json`,
            import.meta.url
          ),
          "utf-8"
        )
      )
    );

    expect(Object.keys(catalogue.icons).toSorted()).toEqual(lucideIconNames);
    expect(lucideIconNames).toEqual(
      expect.arrayContaining(Object.keys(dynamicIconImports))
    );
    expect(Object.keys(catalogue.licenses).length).toBeGreaterThan(0);
  });
});
