import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vite-plus/test";

import { buildCatalogues } from "../scripts/catalogue.mjs";

const original = { nodes: [], size: 24 };
const addition = { nodes: [], size: 16 };

it("reconstructs old and new catalogue versions from snapshots in a clean build", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "patchsmith-icon-catalogues-")
  );

  const catalogueDirectory = pathToFileURL(
    path.join(root, "catalogues") + path.sep
  );

  const outputDirectory = pathToFileURL(path.join(root, "dist") + path.sep);

  try {
    await mkdir(catalogueDirectory);
    await writeFile(
      new URL("lucide-v1.generated.json", catalogueDirectory),
      JSON.stringify({
        icons: { "old-name": original },
        library: "lucide",
        licenses: { "1.0.0": "old license" },
        version: "v1",
      })
    );
    await writeFile(
      new URL("lucide-v2.generated.json", catalogueDirectory),
      JSON.stringify({
        icons: { "new-name": addition },
        library: "lucide",
        licenses: { "9.0.0": "new license" },
        version: "v2",
      })
    );

    await buildCatalogues({ catalogueDirectory, outputDirectory });
    const oldPath = new URL("lucide/v1/old-name.json", outputDirectory);
    const oldBytes = await readFile(oldPath, "utf-8");
    expect(JSON.parse(oldBytes)).toEqual(original);
    expect(
      JSON.parse(
        await readFile(
          new URL("lucide/v2/new-name.json", outputDirectory),
          "utf-8"
        )
      )
    ).toEqual(addition);
    expect(
      await readFile(new URL("lucide/v1/LICENSE.txt", outputDirectory), "utf-8")
    ).toContain("old license");

    await rm(outputDirectory, { recursive: true });
    await buildCatalogues({ catalogueDirectory, outputDirectory });
    expect(await readFile(oldPath, "utf-8")).toBe(oldBytes);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
