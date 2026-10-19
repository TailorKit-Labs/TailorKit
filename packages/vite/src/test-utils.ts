import { execFile } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { drizzleGenerateArguments } from "./builder/drizzle";
import { getBuildEnvironment } from "./builder/env";

export const testSchema = `import { boolean, table, text } from "patchsmith/db";
export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
});
`;

/** Give disposable test projects the builder's installed dependencies. */
export const linkTestDependencies = async (root: string): Promise<void> => {
  const modules = path.join(root, "node_modules");
  await mkdir(modules, { recursive: true });
  await Promise.all(
    ["preact", "drizzle-kit", "drizzle-orm", "typescript", "vite", "zod"].map(
      async (dependency) => {
        await symlink(
          path.resolve(import.meta.dirname, "../node_modules", dependency),
          path.join(modules, dependency),
          "dir"
        );
      }
    )
  );
  await symlink(
    path.resolve(import.meta.dirname, "../../patchsmith"),
    path.join(modules, "patchsmith"),
    "dir"
  );
};

/** Generate real Drizzle migrations in disposable test storage. */
export const generateTestMigrations = async (root: string): Promise<string> => {
  const directory = path.join(root, "src/db/migrations");
  // oxlint-disable-next-line typescript/strict-void-return -- Node explicitly supports promisify(execFile); its ChildProcess return is intentionally ignored by the callback-to-Promise adapter.
  await promisify(execFile)(
    process.execPath,
    await drizzleGenerateArguments(root, directory, "init"),
    {
      cwd: root,
      env: { ...getBuildEnvironment(), CI: "true" },
      timeout: 30_000,
    }
  );
  return directory;
};

/** Disposable database inputs for builder tests. */
export const createDatabaseTestApp = async (root: string): Promise<void> => {
  await linkTestDependencies(root);
  const files = {
    "package.json": '{"type":"module"}',
    "patchsmith.config.mjs":
      'export default { name: "Test App", slug: "test-app", host: "https://host.test", server: {} };',
    "src/db/schema.ts": testSchema,
    "src/root.tsx": `import { defineRoute } from "patchsmith/client";
export default defineRoute({ shellComponent: () => "Database test client" });`,
    "src/server.ts": `import { createFunctions, defineRouter, defineServer } from "patchsmith/server";
import { defineDatabase, defineRelations } from "patchsmith/db";
import * as schema from "./db/schema";
const database = defineDatabase({ relations: defineRelations(schema) });
const fn = createFunctions({ database });
const router = defineRouter({
  list: fn.query.handler(({ db }) => db.query.todos.findMany().sync()),
  privateMarker: fn.query.handler(() => "PRIVATE_DATABASE_TEST"),
});
export default defineServer(router);`,
  };
  await Promise.all(
    Object.entries(files).map(async ([filename, source]) => {
      const destination = path.join(root, filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    })
  );
  await generateTestMigrations(root);
};
