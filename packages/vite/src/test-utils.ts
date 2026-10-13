import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { drizzleGenerateArguments } from "./builder/drizzle";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const testSchema = `import { boolean, table, text } from "tailorkit/server";
export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
});
`;

/** Give disposable test projects the builder's installed dependencies. */
export async function linkTestDependencies(root: string): Promise<void> {
  const modules = path.join(root, "node_modules");
  await mkdir(modules, { recursive: true });
  for (const dependency of ["preact", "drizzle-kit", "drizzle-orm", "typescript", "vite", "zod"]) {
    await symlink(
      path.resolve(import.meta.dirname, "../node_modules", dependency),
      path.join(modules, dependency),
      "dir",
    );
  }
  await symlink(
    path.resolve(import.meta.dirname, "../../tailorkit"),
    path.join(modules, "tailorkit"),
    "dir",
  );
}

/** Disposable database inputs for builder tests. */
export async function createDatabaseTestApp(root: string): Promise<void> {
  await linkTestDependencies(root);
  const files = {
    "package.json": '{"type":"module"}',
    "tailorkit.config.mjs": 'export default { host: "https://host.test", server: {} };',
    "src/root.tsx": `import { defineRoute } from "tailorkit/client";
export default defineRoute({ shellComponent: () => "Database test client" });`,
    "src/db/schema.ts": testSchema,
    "src/server.ts": `import { defineDatabase, defineServer, fn } from "tailorkit/server";
import { defineRelations } from "drizzle-orm";
import * as schema from "./db/schema";
const database = defineDatabase({ relations: defineRelations(schema) });
export default defineServer({
  list: fn.query.database(database).handler(({ db }) => db.query.todos.findMany().sync()),
  privateMarker: fn.query.handler(() => "PRIVATE_DATABASE_TEST"),
});`,
  };
  for (const [filename, source] of Object.entries(files)) {
    const destination = path.join(root, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }
  await generateTestMigrations(root);
}

/** Generate real Drizzle migrations in disposable test storage. */
export async function generateTestMigrations(root: string): Promise<string> {
  const directory = path.join(root, "src/db/migrations");
  await promisify(execFile)(
    process.execPath,
    await drizzleGenerateArguments(root, directory, "init"),
    {
      cwd: root,
      timeout: 30_000,
      env: { ...process.env, CI: "true" },
    },
  );
  return directory;
}
