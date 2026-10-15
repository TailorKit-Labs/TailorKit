import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { lucideVersion, parseIconData } from "@tailorkit/core/icons";
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import manifest from "lucide-react/package.json" with { type: "json" };

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("lucide-react/package.json"));
if (manifest.version !== lucideVersion) {
  throw new Error(
    "The Lucide asset version must match the SDK catalogue version"
  );
}

const output = path.resolve(
  import.meta.dirname,
  "../dist/lucide",
  lucideVersion
);
await mkdir(output, { recursive: true });
await Promise.all(
  Object.entries(dynamicIconImports).map(async ([name, load]) => {
    const { __iconData: data } = await load();
    const icon = parseIconData({ nodes: data.node, size: data.size });
    await writeFile(path.join(output, `${name}.json`), JSON.stringify(icon));
  })
);
// Retain the upstream ISC and Feather MIT notices beside the redistributed data.
await copyFile(
  path.join(packageRoot, "LICENSE"),
  path.join(output, "LICENSE.txt")
);

await copyFile(
  new URL("../public/_headers", import.meta.url),
  new URL("../dist/_headers", import.meta.url)
);
