import path from "node:path";

export function appDatabasePaths(root: string, migrations?: string) {
  return {
    migrations: path.resolve(root, migrations ?? "./src/db/migrations"),
    schema: path.join(root, "src/db/schema.ts"),
  };
}
