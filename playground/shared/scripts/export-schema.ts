import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTailorKitSchema } from "@tailorkit/core/schema";
import { contract } from "../src/contracts/active";

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../schema.json");
const schema = createTailorKitSchema(contract).serialize();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`Exported the active TailorKit contract to ${outputPath}\n`);
