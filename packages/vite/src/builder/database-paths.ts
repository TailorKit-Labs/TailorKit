import path from "node:path";

export const appDatabasePaths = (root: string, migrations?: string) => ({
  migrations: path.resolve(root, migrations ?? "./src/db/migrations"),
  schema: path.join(root, "src/db/schema.ts"),
});
