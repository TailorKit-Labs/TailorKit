import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import {
  createFileFunctionEntry,
  discoverFunctionFiles,
  renderFunctionTypes,
} from "./file-functions";

it("discovers dotted, directory and mixed namespaces while ignoring helpers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-functions-"));

  try {
    await mkdir(path.join(root, "src/functions/some/nested"), {
      recursive: true,
    });
    await mkdir(path.join(root, "src/functions/ignored.fn.ts"));

    await Promise.all(
      [
        "some.nested.file.fn.ts",
        "some/nested/file.fn.ts",
        "some/nested.other.fn.ts",
        "helpers.ts",
        "index.fn.ts",
      ].map(async (file) => {
        await writeFile(
          path.join(root, "src/functions", file),
          'throw new Error("Discovery never executes server code");'
        );
      })
    );
    const files = await discoverFunctionFiles(root);
    expect(files.map((file) => file.path)).toEqual([
      ["index"],
      ["some", "nested", "file"],
      ["some", "nested", "other"],
      ["some", "nested", "file"],
    ]);

    const types = renderFunctionTypes(
      files,
      path.join(root, "src/patchsmith.functions.gen.ts")
    );

    expect(types).toContain('import type module0 from "./functions/index.fn"');
    expect(types).toContain(
      '{ readonly "some": { readonly "nested": { readonly "file": typeof module1 } } }'
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it.each([
  "name",
  "then",
  "some.name",
  "some/then",
  "some..file",
  "123",
  "invalid-name",
])("rejects invalid or reserved file namespaces: %s", async (name) => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-function-names-"));

  try {
    const filename = path.join(root, "src/functions", `${name}.fn.ts`);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, "export default {};");
    await expect(discoverFunctionFiles(root)).rejects.toThrow(filename);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("refreshes the registry and type imports when modules are added, renamed and removed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-function-watch-"));
  await mkdir(path.join(root, "src"));

  const registry = await createFileFunctionEntry(
    root,
    path.join(root, ".patchsmith"),
    true
  );

  const types = path.join(root, "src/patchsmith.functions.gen.ts");

  try {
    await mkdir(path.join(root, "src/functions"));
    const first = path.join(root, "src/functions/todos.fn.ts");
    await writeFile(first, "export default {};");
    await expect
      .poll(async () => await readFile(types, "utf-8"), { timeout: 5000 })
      .toContain('"./functions/todos.fn"');
    await expect
      .poll(async () => await readFile(registry.entry, "utf-8"), {
        timeout: 5000,
      })
      .toContain('path: ["todos"]');
    await rename(first, path.join(root, "src/functions/tasks.fn.ts"));
    await expect
      .poll(async () => await readFile(types, "utf-8"), { timeout: 5000 })
      .toContain('"./functions/tasks.fn"');
    await expect
      .poll(async () => await readFile(registry.entry, "utf-8"), {
        timeout: 5000,
      })
      .not.toContain('path: ["todos"]');
    await rm(path.join(root, "src/functions/tasks.fn.ts"));
    await expect
      .poll(async () => await readFile(types, "utf-8"), { timeout: 5000 })
      .toContain("Record<never, never>");
    await expect
      .poll(async () => await readFile(registry.entry, "utf-8"), {
        timeout: 5000,
      })
      .toContain("createFileServer([])");
  } finally {
    await registry.close();
    await rm(root, { force: true, recursive: true });
  }
}, 10_000);
