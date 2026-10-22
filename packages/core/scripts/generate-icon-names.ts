import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import manifest from "lucide-react/package.json" with { type: "json" };
import * as v from "valibot";

import {
  iconCatalogueVersion,
  iconNamePattern,
  maxIconNameLength,
  parseIconData,
} from "#icons/definition";

import { extendIconCatalogue, iconCatalogueSchema } from "./icon-catalogue";
import type { IconCatalogue } from "./icon-catalogue";

const cataloguePath = new URL(
  `../../../apps/icons-assets/catalogues/lucide-${iconCatalogueVersion}.generated.json`,
  import.meta.url
);

let previous: IconCatalogue = {
  icons: {},
  library: "lucide",
  licenses: {},
  version: iconCatalogueVersion,
};

try {
  previous = v.parse(
    iconCatalogueSchema,
    JSON.parse(await readFile(cataloguePath, "utf-8"))
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const upstream = Object.entries(dynamicIconImports);

if (
  !upstream.every(
    ([name]) => name.length <= maxIconNameLength && iconNamePattern.test(name)
  )
) {
  throw new Error("Lucide returned an unsupported icon name");
}

const icons = Object.fromEntries(
  await Promise.all(
    upstream.map(async ([name, load]) => {
      const existing = previous.icons[name];

      if (existing) {
        return [name, existing] as const;
      }

      const { __iconData: data } = await load();

      return [
        name,
        parseIconData({ nodes: data.node, size: data.size }),
      ] as const;
    })
  )
);

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("lucide-react/package.json"));

const catalogue = extendIconCatalogue(previous, {
  icons,
  license: await readFile(path.join(packageRoot, "LICENSE"), "utf-8"),
  version: manifest.version,
});

const names = Object.keys(catalogue.icons).toSorted();

const catalogueLines = names.map(
  (name) =>
    `    ${JSON.stringify(name)}: ${JSON.stringify(catalogue.icons[name])}`
);

const output = new URL(
  "../src/icons/lucide-names.generated.ts",
  import.meta.url
);

await mkdir(new URL(".", cataloguePath), { recursive: true });

await writeFile(
  cataloguePath,
  `{"library":"lucide","version":${JSON.stringify(iconCatalogueVersion)},"licenses":${JSON.stringify(catalogue.licenses)},"icons":{\n${catalogueLines.join(",\n")}\n}}\n`
);

await writeFile(
  output,
  [
    `// Generated from the additive Lucide ${iconCatalogueVersion} catalogue by pnpm --filter @patchsmith/core generate:icons.`,
    "// Optional name suggestions only; runtime validators accept future names.",
    "export const lucideIconNames = [",
    ...names.map((name) => `  ${JSON.stringify(name)},`),
    "] as const;",
    "",
    "export type LucideIconName = (typeof lucideIconNames)[number];",
    "",
  ].join("\n")
);
