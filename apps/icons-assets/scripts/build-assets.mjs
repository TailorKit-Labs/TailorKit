import { copyFile } from "node:fs/promises";

import { buildCatalogues } from "./catalogue.mjs";

// Committed snapshots keep clean builds independent of installed upstream versions.
await buildCatalogues({
  catalogueDirectory: new URL("../catalogues/", import.meta.url),
  outputDirectory: new URL("../dist/", import.meta.url),
});

await copyFile(
  new URL("../public/_headers", import.meta.url),
  new URL("../dist/_headers", import.meta.url)
);
