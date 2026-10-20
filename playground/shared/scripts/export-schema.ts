import { mkdir, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { createPatchsmithSchema } from "@patchsmith/core/schema";

import { contract } from "../src/contracts/active";

const { dirname, resolve } = nodePath;

const outputPath = resolve(import.meta.dirname, "../../schema.json");
const schema = createPatchsmithSchema(contract).serialize();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(
  `Exported the active Patchsmith contract to ${outputPath}\n`
);
