import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
} from "vite-plus/test";

import {
  linkTestDependencies,
  testSchema,
  generateTestMigrations,
} from "#test-utils";

import { checkAppSchema } from "./schema-check";

const root = await mkdtemp(path.join(tmpdir(), "patchsmith-schema-test-"));
const migrations = path.join(root, "src/db/migrations");
const schemaFile = path.join(root, "src/db/schema.ts");
const missingMigrations = path.join(root, "missing");
let files: string[] = [];
let contents: string[] = [];

const migrationFiles = async () => {
  const entries = await readdir(migrations, { recursive: true });

  return entries.filter(
    (name) => name.endsWith(".sql") || name.endsWith(".json")
  );
};

const migrationContents = async () =>
  await Promise.all(
    files.map(
      async (file) => await readFile(path.join(migrations, file), "utf-8")
    )
  );

beforeAll(async () => {
  await mkdir(path.dirname(schemaFile), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await linkTestDependencies(root);
  await writeFile(schemaFile, testSchema);
  await generateTestMigrations(root);
  files = await migrationFiles();
  contents = await migrationContents();
});

beforeEach(async () => {
  await writeFile(schemaFile, testSchema);
});

afterEach(async () => {
  expect(await migrationFiles()).toEqual(files);
  expect(await migrationContents()).toEqual(contents);
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

it("accepts a schema matching committed migrations", async () => {
  await expect(checkAppSchema(root, migrations)).resolves.toBeUndefined();
});

it("rejects schema drift without rewriting committed migrations", async () => {
  await writeFile(
    schemaFile,
    testSchema.replace(
      "  id:",
      '  priority: text().notNull().default("normal"),\n  id:'
    )
  );
  await expect(checkAppSchema(root, migrations)).rejects.toThrow(
    "out of sync with src/db/schema.ts"
  );
});

it("requires migrations for a schema with tables", async () => {
  await expect(checkAppSchema(root, missingMigrations)).rejects.toThrow(
    "Run patchsmith db generate"
  );
});

it("allows a schema without tables or migrations", async () => {
  await writeFile(schemaFile, "export {};\n");
  await expect(
    checkAppSchema(root, missingMigrations)
  ).resolves.toBeUndefined();
});

it("rejects stale migrations when all tables have been removed", async () => {
  await writeFile(schemaFile, "export {};\n");
  await expect(checkAppSchema(root, migrations)).rejects.toThrow("out of sync");
});

it("reports a broken schema as a Drizzle Kit failure", async () => {
  await writeFile(schemaFile, 'throw new Error("Broken schema");\n');
  await expect(checkAppSchema(root, missingMigrations)).rejects.toThrow(
    /Drizzle Kit/u
  );
});
