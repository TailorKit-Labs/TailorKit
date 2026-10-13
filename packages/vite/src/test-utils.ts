import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const testMigrations = path.resolve(import.meta.dirname, "../test/migrations");
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
  await cp(testMigrations, path.join(root, "src/db/migrations"), { recursive: true });
}
