import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { linkTestDependencies, testSchema } from "#test-utils";

import { generateAppMigrations } from "./generate-migrations";
import { readAppMigrations } from "./migrations";

it.each([undefined, "history"])(
  "generates Drizzle migrations for the new layout with directory %s",
  async (directory) => {
    const root = await mkdtemp(path.join(tmpdir(), "patchsmith-db-generate-"));

    try {
      await mkdir(path.join(root, "src/db"), { recursive: true });
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await linkTestDependencies(root);
      await writeFile(path.join(root, "src/db/schema.ts"), testSchema);
      await writeFile(
        path.join(root, "patchsmith.config.mjs"),
        `export default { name: "Test App", slug: "test-app", host: "https://host.example.com", server: ${JSON.stringify(directory !== undefined && directory !== null && directory !== "" ? { migrations: directory } : {})} };`
      );

      const migrations = await generateAppMigrations({
        cwd: root,
        name: "init",
      });

      expect(migrations).toBe(
        path.join(root, directory ?? "src/db/migrations")
      );
      const generated = await readAppMigrations(migrations);
      expect(generated.migrations).toHaveLength(1);
      const history = await readdir(migrations);
      await generateAppMigrations({ cwd: root });
      expect(await readdir(migrations)).toEqual(history);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);
