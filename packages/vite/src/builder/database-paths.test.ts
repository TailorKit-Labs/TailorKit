import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { appDatabasePaths } from "./database-paths";

it("uses src/db regardless of files at old locations and honors custom migrations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-db-paths-"));

  try {
    expect(appDatabasePaths(root)).toEqual({
      migrations: path.join(root, "src/db/migrations"),
      schema: path.join(root, "src/db/schema.ts"),
    });
    await mkdir(path.join(root, "src/db"), { recursive: true });
    await writeFile(path.join(root, "src/schema.ts"), "export {};\n");
    expect(appDatabasePaths(root)).toEqual({
      migrations: path.join(root, "src/db/migrations"),
      schema: path.join(root, "src/db/schema.ts"),
    });
    await writeFile(path.join(root, "src/db/schema.ts"), "export {};\n");
    expect(appDatabasePaths(root, "custom/history")).toEqual({
      migrations: path.join(root, "custom/history"),
      schema: path.join(root, "src/db/schema.ts"),
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
