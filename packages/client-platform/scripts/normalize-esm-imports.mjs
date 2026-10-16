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
  await Array.fromAsync(
    await readdir(dir, { withFileTypes: true }),
    async (entry) => {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
        return;
      }
      if (!entry.name.endsWith(".ts")) {
        return;
      }

      const input = await readFile(filename, "utf-8");
      let output = input;
      await Array.fromAsync(
        input.matchAll(
          /from\s+(?<quote>["'])(?<specifier>\.\.?\/[^"']+)\k<quote>/gu
        ),
        async (match) => {
          const specifier = match.groups?.specifier;
          if (specifier === undefined) {
            return;
          }
          if (specifier.endsWith(".js")) {
            return;
          }
          const target = path.resolve(dir, specifier);

          let replacement = null;

          if (await exists(`${target}.ts`)) {
            replacement = `${specifier}.js`;
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
      );
      if (
        filename.endsWith(
          `${path.sep}client${path.sep}client${path.sep}index.ts`
        )
      ) {
        // This entry point is linted as source; generated parent imports must use package aliases.
        output = output.replaceAll(
          /(?<quote>["'])\.\.\/core\/(?<module>[^"']+)\.js\k<quote>/gu,
          '"#client/core/$<module>"'
        );
        output = output.replace(
          "  TDataShape,",
          "  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- This re-exports the generated client API; changing its public name would break generated consumers.\n  TDataShape,"
        );
      }
      if (output !== input) {
        await writeFile(filename, output);
      }
    }
  );
};
await visit(root);
