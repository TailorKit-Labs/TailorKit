import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vite-plus/test";

const examplePattern =
  /<!-- example: typed-insert -->\s*```ts\n(?<source>[\s\S]*?)```/u;

it("keeps the agent's typed column and insert example compatible with the public database exports", async () => {
  const reference = await readFile(
    new URL("../../agent-fx/src/skills/database.md", import.meta.url),
    "utf-8"
  );
  const source = examplePattern.exec(reference)?.groups?.source;
  if (source === undefined) {
    throw new Error("Missing typed insert reference example.");
  }
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-db-reference-"));
  try {
    await writeFile(
      path.join(root, "example.ts"),
      `${source}
const row: TaskInsert = createTaskRow({ title: "Review design", priority: "high" });
const id: string = row.id;
// @ts-expect-error Arbitrary text is not a validated priority.
createTaskRow({ title: "Review design", priority: "urgent" });
// @ts-expect-error Drafts are not complete insert rows.
const incomplete: TaskInsert = { title: "Review design" };
`
    );
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "tailorkit/db": [new URL("index.ts", import.meta.url).pathname],
          },
          skipLibCheck: true,
          strict: true,
          target: "ESNext",
          types: [],
        },
        files: ["example.ts"],
      })
    );
    const require = createRequire(import.meta.url);
    const compiler = path.join(
      path.dirname(require.resolve("typescript/package.json")),
      "bin/tsc"
    );
    // oxlint-disable-next-line typescript/strict-void-return -- Node's callback API intentionally returns a ChildProcess when promisified.
    const result = await promisify(execFile)(process.execPath, [
      compiler,
      "-p",
      path.join(root, "tsconfig.json"),
    ]);
    expect(result.stdout).toBe("");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
