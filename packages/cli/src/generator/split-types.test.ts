import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { primitives } from "@tailorkit/core/primitives/zod";
import { createTailorKitSchema } from "@tailorkit/core/schema";
import { expect, it } from "vite-plus/test";

import { generateTypes, renderGeneratedFiles } from "./types";
import type { TailorKitSchemaFile } from "./types";

const schema: TailorKitSchemaFile = {
  components: {
    Button: {
      callbacks: { onPress: {} },
      children: true,
      fields: {
        properties: { variant: { enum: ["primary", "secondary"] } },
        type: "object",
      },
    },
    Input: {
      callbacks: {
        onChange: {
          input: {
            properties: { value: { type: "string" } },
            required: ["value"],
            type: "object",
          },
        },
      },
      children: false,
      fields: { properties: { value: { type: "string" } }, type: "object" },
    },
  },
  slots: {
    page: { description: "Main content area.", multiple: true, views: ["/"] },
  },
  tools: {
    todos: {
      add: {
        input: { type: "string" },
        kind: "server",
        output: { type: "boolean" },
      },
    },
  },
  views: {
    "/": {
      context: {
        properties: { teamId: { type: "string" } },
        required: ["teamId"],
        type: "object",
      },
    },
  },
};

const markdownLink = /\]\((?<target>[^)]+)\)/gu;

it("generates a discoverable skill with working reference links, including custom output paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-host-skill-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { name: "Example", slug: "example", host: "https://host.test" };'
    );
    const skillPath = path.join(root, ".agents/skills/tailorkit-host/SKILL.md");
    for (const outFile of [undefined, "src/custom contracts/host.ts"]) {
      // oxlint-disable-next-line no-await-in-loop -- Each generation must replace the preceding skill's links.
      await generateTypes({ cwd: root, outFile, schema });
      // oxlint-disable-next-line no-await-in-loop -- Verify the artifact produced by this generation before replacing it.
      const skill = await readFile(skillPath, "utf-8");
      expect(skill).toMatch(
        /^---\nname: tailorkit-host\ndescription: .+\n---\n/u
      );
      expect(skill.length).toBeLessThan(2200);
      const links = [...skill.matchAll(markdownLink)];
      expect(links).toHaveLength(4);
      // oxlint-disable-next-line no-await-in-loop -- Check this generation before the next generation replaces its references.
      await Promise.all(
        links.map(async (link) => {
          const target = link.groups?.target;
          if (target === undefined) {
            throw new Error("Missing skill reference target.");
          }
          const reference = await readFile(
            path.resolve(path.dirname(skillPath), decodeURIComponent(target)),
            "utf-8"
          );
          expect(reference.length).toBeGreaterThan(0);
        })
      );
      if (outFile !== undefined) {
        expect(skill).toContain("custom%20contracts/host/reference");
      }
    }
    await writeFile(
      skillPath,
      "---\nname: tailorkit-host\ndescription: Custom project guidance.\n---\nKeep this guidance.\n"
    );
    await generateTypes({ cwd: root, schema });
    expect(await readFile(skillPath, "utf-8")).toContain("Keep this guidance.");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("typechecks consumers of split components, callbacks, tools and context through the barrel", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-split-types-"));
  try {
    const files = renderGeneratedFiles(schema, { moduleName: "host" });
    await Promise.all(
      Object.entries(files).map(async ([filename, content]) => {
        const destination =
          filename === "index"
            ? path.join(root, "host.ts")
            : path.join(root, "host", filename);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content);
      })
    );
    await writeFile(
      path.join(root, "consumer.ts"),
      `
import { Button, Input, tools } from "./host";
import type { ButtonProps, InputProps, ViewProps, TailorKitBackendTools } from "./host";
const button: ButtonProps = { variant: "primary", onPress: () => {} };
const input: InputProps = { onChange: ({ value }) => value.toUpperCase() };
const context: ViewProps<"/">["context"] = { teamId: "team-1" };
const backend: TailorKitBackendTools = tools;
const added: Promise<boolean> = backend.todos.add("title");
// @ts-expect-error Unsupported component variants remain rejected.
const invalidButton: ButtonProps = { variant: "danger" };
// @ts-expect-error Callback payloads are serialized objects, not strings.
const invalidInput: InputProps = { onChange: (value: string) => {} };
// @ts-expect-error Required context stays required through module augmentation.
const invalidContext: ViewProps<"/">["context"] = {};
// @ts-expect-error Host tool inputs stay typed.
tools.todos.add(123);
`
    );
    const require = createRequire(import.meta.url);
    const client = fileURLToPath(
      import.meta.resolve("@tailorkit/app/client")
    ).replace(/\.js$/u, ".d.ts");
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: { "tailorkit/client": [client] },
          skipLibCheck: true,
          strict: true,
          target: "ESNext",
          types: [],
        },
        files: ["consumer.ts"],
      })
    );
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

it("generates targeted human-readable references from the same component and slot contracts", () => {
  const files = renderGeneratedFiles(schema, { moduleName: "host" });
  expect(files["reference/components/Button.md"]).toContain(
    '"primary", "secondary"'
  );
  expect(files["reference/components/Button.md"]).toContain(
    "onPress | no payload"
  );
  expect(files["reference/components/Button.md"]).not.toContain("onChange");
  expect(files["reference/components/Input.md"]).toContain(
    "value (required): string"
  );
  expect(files["reference/components/Input.md"]).toContain(
    "Does not accept children"
  );
  expect(files["reference/views.md"]).toContain("Main content area.");
  expect(files["reference/views.md"]).toContain("teamId (required): string");
  expect(files["reference/index.md"]?.length).toBeLessThan(1500);
});

it("keeps responsive primitive references small without dropping the host's keys or tokens", () => {
  const contract = createTailorKitSchema({
    components: primitives({
      breakpoints: { lg: "1024px", md: "768px" },
      tokens: { background: { accent: "blue", surface: "white" } },
    }),
  }).serialize();
  const files = renderGeneratedFiles(contract, { moduleName: "host" });
  expect(files["reference/components/Box.md"]?.length).toBeLessThan(6000);
  expect(files["reference/components/Box.md"]).toContain('"accent", "surface"');
  expect(files["reference/components/Box.md"]).toContain(
    "responsive/state object"
  );
  expect(files["reference/styling.md"]).toContain('"md"');
  expect(files["reference/styling.md"]).toContain('":focus-visible"');
});

it("removes obsolete contracts on regeneration and preserves unrelated directories", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "tailorkit-regenerate-split-")
  );
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { name: "Example", slug: "example", host: "https://host.test" };'
    );
    await generateTypes({ cwd: root, schema });
    const extensionless = await generateTypes({
      cwd: root,
      outFile: "host",
      schema,
    });
    expect(await readFile(extensionless, "utf-8")).toContain(
      "./host.generated/components/Button"
    );
    await generateTypes({ cwd: root, schema: { ...schema, components: {} } });
    await expect(
      readFile(path.join(root, "src/tailorkit.gen/components/Button.ts"))
    ).rejects.toThrow();
    await expect(
      readFile(
        path.join(root, "src/tailorkit.gen/reference/components/Button.md")
      )
    ).rejects.toThrow();
    expect(
      await readFile(path.join(root, "src/tailorkit.gen.ts"), "utf-8")
    ).not.toContain("components/Button");
    await mkdir(path.join(root, "custom"));
    await writeFile(path.join(root, "custom/keep.txt"), "user content");
    await expect(
      generateTypes({ cwd: root, outFile: "custom.ts", schema })
    ).rejects.toThrow("non-generated directory");
    expect(await readFile(path.join(root, "custom/keep.txt"), "utf-8")).toBe(
      "user content"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
