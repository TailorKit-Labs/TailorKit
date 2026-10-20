import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { primitives } from "@patchsmith/core/primitives/zod";
import {
  tool,
  defineContract,
  createPatchsmithSchema,
} from "@patchsmith/core/schema";
import { createServer } from "@patchsmith/core/server";
import { compactJsonSchema, PatchsmithSchemaSpec } from "@patchsmith/core/spec";
import * as v from "valibot";
import { transformWithOxc } from "vite";
import { assert, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { generateTypes, readSchemaFile, renderGeneratedTypes } from "./types";

it.each([undefined, "{", '{"version":2,"components":{}}'])(
  "includes the original schema loading error and preserves its cause for %s",
  async (content) => {
    const root = await mkdtemp(path.join(tmpdir(), "patchsmith-schema-error-"));
    const schemaPath = path.join(root, "schema.json");

    try {
      if (content !== undefined) {
        await writeFile(schemaPath, content);
      }

      let failure: unknown;

      try {
        await readSchemaFile(schemaPath);
      } catch (error) {
        failure = error;
      }

      assert(failure instanceof Error);

      const error = failure;
      assert(error.cause instanceof Error);
      expect(error.message).toBe(
        `Unable to read Patchsmith schema from ${schemaPath}: ${error.cause.message}`
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);

const mockSchemaFetch = (requests: number) => {
  const fetch = vi.spyOn(globalThis, "fetch");

  for (let request = 0; request < requests; request += 1) {
    fetch.mockResolvedValueOnce(
      Response.json({ components: {}, version: 1, views: {} })
    );
  }

  return fetch;
};

it("links the app to the configured server entry and never falls back to an unrelated default file", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "patchsmith-configured-server-types-")
  );

  const fetch = mockSchemaFetch(3);

  try {
    await mkdir(path.join(root, "backend"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "patchsmith.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.test", server: { entry: "./backend/api.ts" } };'
    );
    await writeFile(
      path.join(root, "backend/api.ts"),
      'throw new Error("Never evaluate server code");'
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      'throw new Error("Unused default server");'
    );
    const generated = await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).toContain(
      'import type app from "../backend/api"'
    );

    const custom = await generateTypes({
      cwd: root,
      outFile: "src/generated/host.ts",
    });

    expect(await readFile(custom, "utf-8")).toContain(
      'import type app from "../../backend/api"'
    );
    await rm(path.join(root, "backend/api.ts"));
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { force: true, recursive: true });
  }
});

it("preserves the type-only API link when regenerating host types, including custom paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-host-types-"));
  const fetch = mockSchemaFetch(3);

  try {
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src/server.ts"),
      'throw new Error("Never evaluate server code");'
    );
    await writeFile(
      path.join(root, "patchsmith.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.test", server: {} };'
    );
    const generated = await generateTypes({ cwd: root });
    const output = await readFile(generated, "utf-8");
    expect(output).toContain('import type app from "./server"');
    expect(output).toContain(
      "export const api = createApi<typeof app.functions>();"
    );

    const custom = await generateTypes({
      cwd: root,
      outFile: "src/generated/host.ts",
    });

    expect(await readFile(custom, "utf-8")).toContain(
      'import type app from "../server"'
    );
    await rm(path.join(root, "src/server.ts"));
    const missing = await generateTypes({ cwd: root });
    expect(await readFile(missing, "utf-8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { force: true, recursive: true });
  }
});

it("detects the default server file without server configuration and removes stale API imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-detect-server-"));
  const fetch = mockSchemaFetch(5);

  try {
    await writeFile(
      path.join(root, "patchsmith.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.test" };'
    );
    const generated = await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
    const server = path.join(root, "src/server.ts");
    await writeFile(server, 'throw new Error("Never evaluate server code");');
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).toContain(
      'import type app from "./server"'
    );
    expect(await readFile(generated, "utf-8")).toContain(
      "export const api = createApi<typeof app.functions>();"
    );

    const custom = await generateTypes({
      cwd: root,
      outFile: "src/generated/host.ts",
    });

    expect(await readFile(custom, "utf-8")).toContain(
      'import type app from "../server"'
    );
    await rm(server);
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
    await mkdir(server);
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { force: true, recursive: true });
  }
});

const responsiveConstUnionImplementationImplementation = (
  ...values: string[]
) => ({
  anyOf: [
    {
      anyOf: values.map((value) => ({ const: value, type: "string" })),
    },
    {
      additionalProperties: false,
      properties: {
        base: {
          anyOf: values.map((value) => ({ const: value, type: "string" })),
        },
        md: {
          anyOf: values.map((value) => ({ const: value, type: "string" })),
        },
      },
      type: "object",
    },
  ],
});

describe("renderGeneratedTypes", () => {
  it("preserves component descriptions from the host schema endpoint in binding comments", async () => {
    const description = "Controlled input.\nUpdate value after onChange.";

    const server = createServer({
      baseUrl: "https://host.test/api/patchsmith",
      contract: defineContract({
        components: { Input: { description } },
        scopes: { user: z.object({ userId: z.string() }) },
      }),
    });

    const response = await server.handler(
      new Request("https://host.test/api/patchsmith/schema"),
      { authenticate: () => null }
    );

    expect(response.ok).toBe(true);

    const output = renderGeneratedTypes(
      v.parse(PatchsmithSchemaSpec, await response.json())
    );

    expect(output).toContain(
      "/**\n * Controlled input.\n * Update value after onChange.\n */\nexport const Input"
    );
  });

  it.each([
    "",
    "Input */\r\nexport const injected = true; /*\rMore\u2028Text\u2029End",
  ])(
    "keeps component description %j inside generated comments",
    async (description) => {
      const output = renderGeneratedTypes({
        components: { Input: { callbacks: {}, children: false, description } },
      });

      expect(output).toContain(" */\nexport const Input");
      const { code } = await transformWithOxc(output, "patchsmith.gen.ts");
      expect(code).not.toMatch(/^\s*export\s+const\s+injected\b/mu);
      expect(code).not.toContain("description");
    }
  );

  it("includes slot descriptions from the host schema endpoint in generated documentation", async () => {
    const server = createServer({
      baseUrl: "https://host.test/api/patchsmith",
      contract: defineContract({
        scopes: { user: z.object({ userId: z.string() }) },
        slots: {
          panel: {
            description:
              "Right-hand panel, typically 360px wide.\nScrolls independently.",
            views: ["/"],
          },
        },
        views: { "/": z.object({}) },
      }),
    });

    const response = await server.handler(
      new Request("https://host.test/api/patchsmith/schema"),
      { authenticate: () => null }
    );

    expect(response.ok).toBe(true);

    const output = renderGeneratedTypes(
      v.parse(PatchsmithSchemaSpec, await response.json())
    );

    expect(output).toContain(
      '    /**\n     * Right-hand panel, typically 360px wide.\n     * Scrolls independently.\n     */\n    "panel": { views: "/"; multiple: false };'
    );
  });

  it.each([
    "",
    "Panel */\r\nexport const injected = true; /*\rMore\u2028Text\u2029End",
  ])("keeps description %j inside generated comments", async (description) => {
    const output = renderGeneratedTypes({
      slots: { panel: { description, views: ["/"] } },
    });

    expect(output).toContain(
      '    */\n    "panel": { views: "/"; multiple: false };'
    );
    const { code } = await transformWithOxc(output, "patchsmith.gen.ts");
    expect(code).not.toContain("injected");
    expect(code).not.toContain("description");
  });

  it("preserves nullable view context fields through schema serialization and generation", () => {
    const schema = createPatchsmithSchema({
      components: {},
      slots: { sidebar: { views: ["/"] } },
      views: {
        "/": z.object({
          count: z.number().nullable(),
          customer: z.object({ id: z.string(), name: z.string() }).nullable(),
          customers: z.array(z.object({ id: z.string() }).nullable()),
          empty: z.null(),
          enabled: z.boolean().nullable(),
          label: z.string().nullable(),
          labels: z.array(z.string().nullable()),
          tags: z.array(z.string()).nullable(),
        }),
      },
    }).serialize();

    const output = renderGeneratedTypes(v.parse(PatchsmithSchemaSpec, schema));

    expect(output).toContain(
      "customer: {\n        id: string;\n        name: string;\n      } | null;"
    );
    expect(output).toContain("label: string | null;");
    expect(output).toContain("count: number | null;");
    expect(output).toContain("enabled: boolean | null;");
    expect(output).toContain("empty: null;");
    expect(output).toContain("labels: (string | null)[];");
    expect(output).toContain(
      "customers: ({\n        id: string;\n      } | null)[];"
    );
    expect(output).toContain("tags: string[] | null;");
    expect(output).not.toContain("unknown");
  });

  it("preserves and deduplicates every type in a JSON Schema type array", () => {
    const output = renderGeneratedTypes({
      views: {
        "/": {
          context: {
            properties: {
              value: {
                type: ["null", "string", "integer", "number", "boolean"],
              },
            },
            required: ["value"],
            type: "object",
          },
        },
      },
    });

    expect(output).toContain("value: null | string | number | boolean;");
  });

  it("generates view props from schema views", () => {
    const output = renderGeneratedTypes({
      components: {},
      views: {
        "/test": {
          context: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
        },
      },
    });

    expect(output).toContain('"/test": {');
    expect(output).toContain("context: Record<string, never>;");
  });

  it("generates component props from fields and callbacks", () => {
    const output = renderGeneratedTypes({
      components: {
        Button: {
          callbacks: {
            onClick: {},
            onValueChange: {
              input: {
                additionalProperties: false,
                properties: {
                  value: {
                    type: "string",
                  },
                },
                required: ["value"],
                type: "object",
              },
            },
          },
          children: true,
          fields: {
            additionalProperties: false,
            properties: {
              disabled: {
                type: "boolean",
              },
              label: {
                type: "string",
              },
            },
            required: ["label"],
            type: "object",
          },
        },
      },
      views: {},
    });

    expect(output).not.toContain("export type Disabled = boolean;");
    expect(output).not.toContain("export type Label = string;");
    expect(output).toContain("disabled?: boolean;");
    expect(output).toContain("label?: string;");
    expect(output).toContain("onClick?: () => void | Promise<void>;");
    expect(output).toContain("onValueChange?: (input: {");
    expect(output).toContain("value: string;");
    expect(output).toContain("createRemoteComponent<ButtonProps, true>");
    expect(output).toContain('callbacks: { "onClick": 0, "onValueChange": 1 }');
  });

  it("generates synchronous and asynchronous callback outputs", () => {
    const output = renderGeneratedTypes({
      components: {
        Editor: {
          callbacks: {
            onClose: {},
            onSave: {
              input: { type: "string" },
              output: { type: "number" },
            },
            onValidate: { output: { type: "boolean" } },
          },
          children: false,
        },
      },
      views: {},
    });

    expect(output).toContain("onValidate?: () => boolean | Promise<boolean>;");
    expect(output).toContain(
      "onSave?: (input: string) => number | Promise<number>;"
    );
    expect(output).toContain("onClose?: () => void | Promise<void>;");
    expect(output).toContain('"onValidate": 0');
    expect(output).toContain('"onSave": 1');
  });

  it("generates primitive component props from serialized fields", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          children: true,
          fields: {
            properties: {
              padding: {
                enum: ["sm", "md", "lg"],
                type: "string",
              },
            },
            type: "object",
          },
        },
      },
      views: {},
    });

    expect(output).toContain("export interface BoxProps");
    expect(output).toContain('export type Padding = "sm" | "md" | "lg";');
    expect(output).toContain("padding?: Padding;");
    expect(output).toContain("createRemoteComponent<BoxProps, true>");
  });

  it("generates literal responsive primitive token props", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          children: true,
          fields: {
            properties: {
              margin: {
                anyOf: [
                  {
                    enum: ["lg", "xl"],
                    type: "string",
                  },
                  {
                    additionalProperties: false,
                    properties: {
                      default: {
                        enum: ["lg", "xl"],
                        type: "string",
                      },
                      md: {
                        enum: ["lg", "xl"],
                        type: "string",
                      },
                    },
                    type: "object",
                  },
                ],
              },
            },
            type: "object",
          },
        },
      },
      views: {},
    });

    expect(output).toContain('export type Breakpoint = "md";');
    expect(output).toContain(
      'export type Responsive<TValue> = TValue | Partial<Record<"default" | Breakpoint, TValue>>;'
    );
    expect(output).toContain('export type Margin = Responsive<"lg" | "xl">;');
    expect(output).toContain("margin?: Margin;");
  });

  const responsiveConstUnionImplementation =
    responsiveConstUnionImplementationImplementation;

  it("generates literal responsive primitive props from const unions", () => {
    const responsiveConstUnion = responsiveConstUnionImplementation;

    const output = renderGeneratedTypes({
      components: {
        Flex: {
          callbacks: {},
          children: true,
          fields: {
            properties: {
              align: responsiveConstUnion("start", "center", "end", "stretch"),
              direction: responsiveConstUnion("row", "column"),
              grow: responsiveConstUnion("0", "1"),
              justify: responsiveConstUnion(
                "start",
                "center",
                "end",
                "between"
              ),
              shrink: responsiveConstUnion("0", "1"),
              wrap: responsiveConstUnion("wrap", "nowrap", "wrap-reverse"),
            },
            type: "object",
          },
        },
      },
      views: {},
    });

    expect(output).toContain('export type Grow = Responsive<"0" | "1">;');
    expect(output).toContain('export type Shrink = Responsive<"0" | "1">;');
    expect(output).toContain(
      'export type Align = Responsive<"start" | "center" | "end" | "stretch">;'
    );
    expect(output).toContain(
      'export type Direction = Responsive<"row" | "column">;'
    );
    expect(output).toContain(
      'export type Justify = Responsive<"start" | "center" | "end" | "between">;'
    );
    expect(output).toContain(
      'export type Wrap = Responsive<"wrap" | "nowrap" | "wrap-reverse">;'
    );
    expect(output).toContain("direction?: Direction;");
  });

  it("generates never for primitive props with no configured tokens", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          children: true,
          fields: {
            properties: {
              background: {
                anyOf: [
                  {
                    not: {},
                  },
                  {
                    additionalProperties: false,
                    properties: {
                      default: {
                        not: {},
                      },
                      md: {
                        not: {},
                      },
                    },
                    type: "object",
                  },
                ],
              },
            },
            type: "object",
          },
        },
      },
      views: {},
    });

    expect(output).toContain("export type Background = never;");
    expect(output).toContain("background?: Background;");
  });

  it("generates caller input types before transforms and return types after transforms", async () => {
    const server = createServer({
      baseUrl: "https://example.com/api/patchsmith",
      contract: defineContract({
        scopes: { user: z.object({ userId: z.string() }) },
        tools: {
          nested: {
            increment: tool
              .server()
              .input(z.string().transform(Number).pipe(z.number()))
              .output(
                z
                  .union([z.string(), z.number()])
                  .transform(Number)
                  .pipe(z.number())
              ),
          },
        },
      }),
      tools: { nested: { increment: ({ input }) => input + 1 } },
    });

    const response = await server.handler(
      new Request("https://host.test/api/patchsmith/schema"),
      {
        authenticate: () => null,
      }
    );

    expect(response.ok).toBe(true);

    const output = renderGeneratedTypes(
      v.parse(PatchsmithSchemaSpec, await response.json())
    );

    expect(output).toContain("increment: (input: string) => Promise<number>;");
  });

  it("generates typed action callers without request context", () => {
    const output = renderGeneratedTypes({
      components: {},
      tools: {
        todo: {
          create: {
            input: {
              properties: {
                title: { type: "string" },
              },
              required: ["title"],
              type: "object",
            },
            kind: "server",
            output: {
              properties: {
                id: { type: "string" },
                title: { type: "string" },
              },
              required: ["id", "title"],
              type: "object",
            },
          },
        },
      },
      views: {},
    });

    expect(output).toContain("export type PatchsmithTools = {");
    expect(output).toContain("todo: {");
    expect(output).toContain("create: (input: {");
    expect(output).toContain("title: string;");
    expect(output).toContain("}) => Promise<{");
    expect(output).toContain("id: string;");
    expect(output).not.toContain("requestContext");
  });
});

it("composes independent ancestor contexts and generates slot names", () => {
  const generated = renderGeneratedTypes({
    components: {},
    slots: {
      navbar: { views: ["/"] },
      panel: { multiple: true, views: ["/", "/users", "/users/detail"] },
    },
    views: {
      "/": {
        context: {
          properties: { workspaceId: { type: "string" } },
          required: ["workspaceId"],
          type: "object",
        },
      },
      "/users": {
        context: {
          properties: { canManage: { type: "boolean" } },
          required: ["canManage"],
          type: "object",
        },
      },
      "/users/detail": {
        context: {
          properties: { userId: { type: "string" } },
          required: ["userId"],
          type: "object",
        },
      },
    },
  });

  expect(generated).toContain(
    'interface PatchsmithSlots {\n    "navbar": { views: "/"; multiple: false };\n    "panel": { views: "/" | "/users" | "/users/detail"; multiple: true };\n  }'
  );

  const detail = generated.slice(
    generated.indexOf('"/users/detail":'),
    generated.indexOf("declare module")
  );

  expect(detail).toContain("workspaceId");
  expect(detail).toContain("canManage");
  expect(detail).toContain("userId");
  expect(detail).toContain(" & ");
});

it("preserves optional ancestor fields through schema serialization and generation", () => {
  const schema = createPatchsmithSchema({
    components: {},
    slots: { panel: { views: ["/detail"] } },
    views: {
      "/": z.object({ workspaceId: z.string() }).optional(),
      "/detail": z.object({ id: z.string() }),
    },
  }).serialize();

  const parsed = v.parse(PatchsmithSchemaSpec, schema);
  expect(parsed.views["/"]?.contextOptional).toBe(true);
  expect(parsed.views["/detail"]?.contextOptional).toBeUndefined();
  const output = renderGeneratedTypes(parsed);
  expect(output).toContain(
    "context: (Partial<{\n      workspaceId: string;\n    }>) & ({\n      id: string;\n    });"
  );
});

it("generates both frontend kinds and excludes client namespaces from backend callers", () => {
  const generated = renderGeneratedTypes({
    tools: {
      accounts: {
        nested: { balance: { kind: "server", output: { type: "number" } } },
      },
      ui: {
        open: {
          input: { type: "string" },
          kind: "client",
          output: { type: "boolean" },
        },
      },
    },
  });

  expect(generated).toContain('callTool("client", "ui.open", input)');
  expect(generated).toContain(
    'callTool("server", "accounts.nested.balance", input)'
  );

  const backend = generated.slice(
    generated.indexOf("export type PatchsmithBackendTools"),
    generated.indexOf(
      'declare module "patchsmith/client" { interface PatchsmithServerTools'
    )
  );

  expect(backend).not.toContain("ui:");
  expect(backend).toContain("balance: (input?: undefined) => Promise<number>");
});

it("generates conditional primitive types from the contract's breakpoint aliases", () => {
  const schema = createPatchsmithSchema({
    components: {
      ...primitives({
        breakpoints: { desktop: "1024px", hover: "640px" },
        tokens: { background: { accent: "blue", surface: "white" } },
      }),
      Custom: { fields: z.object({ background: z.number() }) },
    },
  }).serialize();

  const output = renderGeneratedTypes(schema);
  expect(output).toContain('export type Breakpoint = "desktop" | "hover";');
  expect(output).toContain(
    'export type InteractionState = ":active" | ":disabled" | ":focus-visible" | ":hover";'
  );
  expect(output).toContain(
    'export type Background = Conditional<"accent" | "surface">;'
  );
  expect(output).toContain(
    'export type Responsive<TValue> = TValue | Partial<Record<"default" | Breakpoint, TValue>>;'
  );
  expect(output).toContain(
    'export type Conditional<TValue> = TValue | (Partial<Record<"default" | Breakpoint, TValue>> & Partial<Record<InteractionState, Responsive<TValue>>>);'
  );
  expect(output).toContain(
    "export interface PressableProps {\n  background?: Background;"
  );
  expect(output).toContain(
    "export interface CustomProps {\n  background?: number;"
  );
  expect(output).toContain("onPress?: () => void | Promise<void>;");
  expect(output).toContain(
    'export type Layout = "inline" | "box" | "flex" | "grid";'
  );
  expect(output).toContain("export type Disabled = boolean;");
  expect(output).toContain("export type AriaLabel = string;");
  expect(output).toContain("layout?: Layout;");
  expect(output).toContain("disabled?: Disabled;");
  expect(output).toContain("ariaLabel?: AriaLabel;");

  const pressableProps = output.slice(
    output.indexOf("export interface PressableProps"),
    output.indexOf("export const Pressable")
  );

  expect(pressableProps).not.toContain("asChild");
  expect(pressableProps).not.toContain("onKeyDown");
  expect(pressableProps).not.toContain("tabIndex");
  expect(output).not.toContain("states?:");
});

it("generates identical types from inline and referenced schemas in every contract position", () => {
  const fields = z.strictObject({ first: z.string(), second: z.number() });
  const context = z.object({ first: fields, second: fields });

  const original = context["~standard"].jsonSchema.output({
    target: "draft-2020-12",
  });

  const compact = compactJsonSchema(original);
  expect(compact).toHaveProperty("$defs");

  const schemaWith = (
    value: typeof original
  ): Parameters<typeof renderGeneratedTypes>[0] => ({
    components: {
      Example: {
        callbacks: { onChange: { input: value } },
        children: false,
        fields: value,
      },
    },
    tools: {
      nested: { echo: { input: value, kind: "server", output: value } },
    },
    views: { "/": { context: value } },
  });

  const schema = schemaWith(compact);
  expect(renderGeneratedTypes(schema)).toBe(
    renderGeneratedTypes(schemaWith(original))
  );
  const serialized = v.parse(PatchsmithSchemaSpec, { ...schema, version: 1 });
  expect(renderGeneratedTypes(serialized)).toBe(
    renderGeneratedTypes(schemaWith(original))
  );
});

const referencedField = (type: string) => ({
  $defs: { value: { type } },
  properties: { value: { $ref: "#/$defs/value" } },
  type: "object",
});

it("resolves each embedded schema against its own definitions", () => {
  const output = renderGeneratedTypes({
    components: {
      Count: {
        callbacks: {},
        children: false,
        fields: referencedField("number"),
      },
      Text: {
        callbacks: {},
        children: false,
        fields: referencedField("string"),
      },
    },
  });

  expect(output).toContain("export interface TextProps {\n  value?: string;");
  expect(output).toContain("export interface CountProps {\n  value?: number;");
});
