import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
/** @param {string} value Candidate generated source path. */
const exists = async (value) => {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
};
/** @param {string} dir Generated source directory to normalize. @returns {Promise<void>} */
const visit = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
      await visit(filename);
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    const input = await readFile(filename, "utf-8");
    let output = input;
    for (const match of input.matchAll(
      /from\s+(?<quote>["'])(?<specifier>\.\.?\/[^"']+)\k<quote>/gu
    )) {
      const specifier = match.groups?.specifier;
      if (specifier === undefined) {
        continue;
      }
      if (specifier.endsWith(".js")) {
        continue;
      }
      const target = path.resolve(dir, specifier);

      let replacement = null;
      // oxlint-disable-next-line no-await-in-loop -- The replacement depends on the first existing module path.
      if (await exists(`${target}.ts`)) {
        replacement = `${specifier}.js`;
        // oxlint-disable-next-line no-await-in-loop -- Try the directory module only after the file module.
      } else if (await exists(path.join(target, "index.ts"))) {
        replacement = `${specifier}/index.js`;
      }
      if (
        !(
          replacement !== undefined &&
          replacement !== null &&
          replacement !== ""
        )
      ) {
        throw new Error(
          `Unresolved relative import ${specifier} in ${filename}`
        );
      }
      output = output.replaceAll(
        `${match[1]}${specifier}${match[1]}`,
        `${match[1]}${replacement}${match[1]}`
      );
    }
    if (output !== input) {
      // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
      await writeFile(filename, output);
    }
  }
};
await visit(root);
