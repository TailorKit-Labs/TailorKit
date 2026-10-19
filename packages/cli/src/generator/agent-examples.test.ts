import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { primitives } from "@tailorkit/core/primitives/zod";
import { createTailorKitSchema } from "@tailorkit/core/schema";
import { expect, it } from "vite-plus/test";

import { renderGeneratedReferences, renderGeneratedTypes } from "./types";
import type { TailorKitSchemaFile } from "./types";

const primitiveSchema = createTailorKitSchema({
  components: primitives({
    breakpoints: { md: "768px" },
    tokens: { background: { accent: "blue", surface: "white" } },
  }),
}).serialize();

const schema: TailorKitSchemaFile = {
  components: {
    ...primitiveSchema.components,
    Button: {
      callbacks: { onClick: {} },
      children: true,
      fields: { properties: { disabled: { type: "boolean" } }, type: "object" },
    },
    EmptyContainer: { children: true },
    Input: {
      callbacks: {
        onValueChange: {
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
    RequiredText: {
      children: false,
      fields: {
        properties: {
          count: { maximum: 200, minimum: 1, type: "integer" },
          label: { type: "string" },
        },
        required: ["label"],
        type: "object",
      },
    },
    "badge-control": {
      children: false,
      fields: {
        properties: { label: { type: "string" } },
        required: ["label"],
        type: "object",
      },
    },
  },
  slots: {
    panel: { views: ["/", "/records/detail"] },
    tile: { multiple: true, views: ["/"] },
  },
  tools: {
    members: {
      read: {
        input: {
          properties: { memberId: { type: "string" } },
          required: ["memberId"],
          type: "object",
        },
        kind: "server",
        output: {
          properties: { name: { type: "string" } },
          required: ["name"],
          type: "object",
        },
      },
    },
    "unusual-group": { "no-input": { kind: "client" } },
  },
  views: {
    "/": { context: { type: "object" } },
    "/records/detail": {
      context: {
        properties: { recordId: { type: "string" } },
        required: ["recordId"],
        type: "object",
      },
    },
  },
};

const fileExample =
  /<!-- example: (?<filename>[^ ]+) -->\s*```tsx?\n(?<source>[\s\S]*?)```/gu;
const codeBlock = /```(?<language>tsx?)\n(?<source>[\s\S]*?)```/gu;

const declaration = (specifier: string) =>
  fileURLToPath(import.meta.resolve(specifier)).replace(
    /\.(?<kind>[cm]?)js$/u,
    ".d.$<kind>ts"
  );

it("typechecks complete authored recipes and generated examples against the public SDK", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-agent-examples-"));
  try {
    const documents = await Promise.all(
      [
        "../../../agent-fx/src/skills/references/functions.md",
        "../../../agent-fx/src/skills/references/interactions.md",
        "../../../agent-fx/src/skills/references/views.md",
        "../../../agent/src/skills/references/drafts.md",
        "../../../agent/src/skills/references/local-state.md",
      ].map(
        async (filename) =>
          await readFile(new URL(filename, import.meta.url), "utf-8")
      )
    );
    const sources: Record<string, string> = {};
    for (const document of documents) {
      for (const match of document.matchAll(fileExample)) {
        const { filename, source } = match.groups ?? {};
        if (filename === undefined || source === undefined) {
          throw new Error("Invalid example marker.");
        }
        if (sources[filename] !== undefined) {
          throw new Error(`Duplicate example: ${filename}`);
        }
        sources[filename] = source;
      }
    }
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(10);
    // The legacy draft recipe uses the same add input under its documented namespace.
    const server = sources["src/server.ts"];
    if (server === undefined) {
      throw new Error("Missing registration example.");
    }
    sources["src/server.ts"] = server.replace(
      "defineServer({ notes, preview })",
      "defineServer({ notes, todos: notes, preview })"
    );
    sources["src/tailorkit.gen.ts"] = renderGeneratedTypes(schema, {
      serverModule: "./server",
    });
    const references = renderGeneratedReferences(schema, {
      bindingsPath: "../src/tailorkit.gen.ts",
      hasApi: true,
    });
    expect(references["components/RequiredText.md"]).toContain(
      "| label | yes |"
    );
    expect(references["components/RequiredText.md"]).toContain("maximum: 200");
    let count = 0;
    for (const reference of Object.values(references)) {
      for (const match of reference.matchAll(codeBlock)) {
        const { language, source } = match.groups ?? {};
        if (language === undefined || source === undefined) {
          throw new Error("Invalid generated code block.");
        }
        sources[`src/examples/generated-${count}.${language}`] = source;
        count += 1;
      }
    }
    expect(count).toBeGreaterThanOrEqual(8);
    await Promise.all(
      Object.entries(sources).map(async ([filename, content]) => {
        const destination = path.resolve(root, filename);
        if (!destination.startsWith(`${root}${path.sep}`)) {
          throw new Error(
            `Example path leaves the temporary workspace: ${filename}`
          );
        }
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content);
      })
    );
    const require = createRequire(import.meta.url);
    const preact = path.dirname(require.resolve("preact/package.json"));
    const appServer = import.meta.resolve("@tailorkit/app/server");
    const database = findPackageJSON("@tailorkit/app-db", appServer);
    if (database === undefined) {
      throw new Error("Missing public database package.");
    }
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "preact",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "#*": [path.join(root, "src/*"), path.join(root, "src/*/index.ts")],
            "#tailorkit": [path.join(root, "src/tailorkit.gen.ts")],
            preact: [path.join(preact, "src/index.d.ts")],
            "preact/hooks": [path.join(preact, "hooks/src/index.d.ts")],
            "preact/jsx-runtime": [
              path.join(preact, "jsx-runtime/src/index.d.ts"),
            ],
            "tailorkit/client": [declaration("@tailorkit/app/client")],
            "tailorkit/db": [
              path.join(path.dirname(database), "dist/index.d.ts"),
            ],
            "tailorkit/server": [declaration("@tailorkit/app/server")],
            valibot: [declaration("valibot")],
          },
          skipLibCheck: true,
          strict: true,
          target: "ESNext",
          types: [],
        },
        include: ["src"],
      })
    );
    const compiler = path.join(
      path.dirname(require.resolve("typescript/package.json")),
      "bin/tsc"
    );
    // oxlint-disable-next-line typescript/strict-void-return -- promisify uses execFile's completion callback, not its ChildProcess return value.
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
