import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import {
  iconCatalogueVersion,
  iconNamePattern,
  maxIconNameLength,
  parseIconData,
} from "@patchsmith/core/icons";
import * as v from "valibot";

const catalogueVersionPattern = /^v[1-9][0-9]*$/u;

const catalogueSchema = v.strictObject({
  icons: v.record(
    v.pipe(
      v.string(),
      v.maxLength(maxIconNameLength),
      v.regex(iconNamePattern)
    ),
    v.pipe(v.unknown(), v.transform(parseIconData))
  ),
  library: v.literal("lucide"),
  licenses: v.record(v.string(), v.string()),
  version: v.pipe(v.string(), v.regex(catalogueVersionPattern)),
});

/**
 * Build every committed compatibility version, including versions older SDKs use.
 * @param {{ catalogueDirectory: URL, outputDirectory: URL }} options Snapshot input and clean output directories.
 */
export const buildCatalogues = async ({
  catalogueDirectory,
  outputDirectory,
}) => {
  const entries = await readdir(catalogueDirectory);

  const files = entries
    .filter((entry) => entry.endsWith(".generated.json"))
    .toSorted();

  const catalogues = await Promise.all(
    files.map(async (entry) =>
      v.parse(
        catalogueSchema,
        JSON.parse(await readFile(new URL(entry, catalogueDirectory), "utf-8"))
      )
    )
  );

  const seen = new Set();

  for (const catalogue of catalogues) {
    const key = `${catalogue.library}/${catalogue.version}`;

    if (seen.has(key)) {
      throw new Error(`Duplicate icon catalogue: ${key}`);
    }

    seen.add(key);
  }

  if (!seen.has(`lucide/${iconCatalogueVersion}`)) {
    throw new Error("The SDK's current icon catalogue is missing");
  }

  // Reconstruct the entire output from snapshots, without relying on a prior dist.
  await rm(outputDirectory, { force: true, recursive: true });
  await Promise.all(
    catalogues.map(async (catalogue) => {
      const output = new URL(
        `${catalogue.library}/${catalogue.version}/`,
        outputDirectory
      );

      await mkdir(output, { recursive: true });
      await Promise.all(
        Object.entries(catalogue.icons).map(async ([name, icon]) => {
          await writeFile(
            new URL(`${name}.json`, output),
            JSON.stringify(icon)
          );
        })
      );
      // Retain notices for source releases whose old icons remain in the snapshot.
      await writeFile(
        new URL("LICENSE.txt", output),
        Object.entries(catalogue.licenses)
          .map(([version, license]) => `lucide-react ${version}\n\n${license}`)
          .join("\n\n")
      );
    })
  );
};
