import { mkdir, writeFile } from "node:fs/promises";

import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import manifest from "lucide-react/package.json" with { type: "json" };

import { iconNamePattern, lucideVersion } from "#icons/definition";

if (manifest.version !== lucideVersion) {
  throw new Error("The Lucide names must match the SDK catalogue version");
}

const names = Object.keys(dynamicIconImports).toSorted();

if (!names.every((name) => iconNamePattern.test(name))) {
  throw new Error("Lucide returned an unsupported icon name");
}

const output = new URL(
  "../src/icons/lucide-names.generated.ts",
  import.meta.url
);

await mkdir(new URL(".", output), { recursive: true });

await writeFile(
  output,
  [
    `// Generated from lucide-react ${lucideVersion} by pnpm --filter @patchsmith/core generate:icons.`,
    "// Names only; SVG geometry is delivered separately by the catalogue.",
    "export const lucideIconNames = [",
    ...names.map((name) => `  ${JSON.stringify(name)},`),
    "] as const;",
    "",
    "export type LucideIconName = (typeof lucideIconNames)[number];",
    "",
  ].join("\n")
);
