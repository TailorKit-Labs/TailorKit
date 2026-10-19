import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { renderGeneratedTypes } from "./types";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

type JsonSchema = NonNullable<
  NonNullable<
    Parameters<typeof renderGeneratedTypes>[0]["views"]
  >[string]["context"]
>;

const cases: {
  name: string;
  schema: z.ZodType;
  expected: string;
  optional?: boolean;
}[] = [
  { expected: "string", name: "string", schema: z.string() },
  { expected: "number", name: "number", schema: z.number() },
  { expected: "number", name: "integer", schema: z.int() },
  { expected: "boolean", name: "boolean", schema: z.boolean() },
  { expected: "null", name: "null", schema: z.null() },
  { expected: "unknown", name: "unknown", schema: z.unknown() },
  { expected: "unknown", name: "any", schema: z.any() },
  { expected: "never", name: "never", schema: z.never() },
  { expected: '"hello"', name: "string literal", schema: z.literal("hello") },
  {
    expected: JSON.stringify('a"b\\c'),
    name: "escaped literal",
    schema: z.literal('a"b\\c'),
  },
  { expected: "42", name: "number literal", schema: z.literal(42) },
  { expected: "false", name: "false literal", schema: z.literal(false) },
  { expected: "true", name: "true literal", schema: z.literal(true) },
  { expected: "0", name: "zero literal", schema: z.literal(0) },
  { expected: '""', name: "empty literal", schema: z.literal("") },
  { expected: '"new" | "done"', name: "enum", schema: z.enum(["new", "done"]) },
  {
    expected: '"x" | 1 | false | null',
    name: "mixed literals",
    schema: z.literal(["x", 1, false, null]),
  },
  {
    expected: "string | null",
    name: "nullable string",
    schema: z.string().nullable(),
  },
  {
    expected: "number | null",
    name: "nullable number",
    schema: z.number().nullable(),
  },
  {
    expected: "boolean | null",
    name: "nullable boolean",
    schema: z.boolean().nullable(),
  },
  {
    expected: '"x" | null',
    name: "nullable literal",
    schema: z.literal("x").nullable(),
  },
  {
    expected: '"new" | "done" | null',
    name: "nullable enum",
    schema: z.enum(["new", "done"]).nullable(),
  },
  {
    expected: "string",
    name: "optional string",
    optional: true,
    schema: z.string().optional(),
  },
  {
    expected: "string | null",
    name: "nullish string",
    optional: true,
    schema: z.string().nullish(),
  },
  {
    expected: "string | number | boolean",
    name: "scalar union",
    schema: z.union([z.string(), z.number(), z.boolean()]),
  },
  {
    expected: '"x" | 1',
    name: "literal union",
    schema: z.union([z.literal("x"), z.literal(1)]),
  },
  {
    expected: "string",
    name: "union with never",
    schema: z.union([z.never(), z.string()]),
  },
  { expected: "string[]", name: "strings array", schema: z.array(z.string()) },
  {
    expected: "number[][]",
    name: "nested array",
    schema: z.array(z.array(z.number())),
  },
  {
    expected: "string[] | null",
    name: "nullable array",
    schema: z.array(z.string()).nullable(),
  },
  {
    expected: "(number | null)[]",
    name: "nullable items",
    schema: z.array(z.number().nullable()),
  },
  {
    expected: "(string | null)[] | null",
    name: "nullable array and items",
    schema: z.array(z.string().nullable()).nullable(),
  },
  {
    expected: '("x" | "y")[]',
    name: "enum array",
    schema: z.array(z.enum(["x", "y"])),
  },
  {
    expected: "(string | number)[]",
    name: "union array",
    schema: z.array(z.union([z.string(), z.number()])),
  },
  {
    expected: "unknown[]",
    name: "unknown array",
    schema: z.array(z.unknown()),
  },
  { expected: "never[]", name: "never array", schema: z.array(z.never()) },
  {
    expected: "Record<string, never>",
    name: "empty object",
    schema: z.object({}),
  },
  {
    expected: "{ id: string; }",
    name: "object",
    schema: z.object({ id: z.string() }),
  },
  {
    expected: "{ name?: string; }",
    name: "optional object field",
    schema: z.object({ name: z.string().optional() }),
  },
  {
    expected: "{ id: string; } | null",
    name: "nullable object",
    schema: z.object({ id: z.string() }).nullable(),
  },
  {
    expected: "{ customer: { id: string; } | null; }",
    name: "nested object",
    schema: z.object({ customer: z.object({ id: z.string() }).nullable() }),
  },
  {
    expected: '{ "display-name": string; }',
    name: "quoted property",
    schema: z.object({ "display-name": z.string() }),
  },
  {
    expected: "{ id: string; }[]",
    name: "object array",
    schema: z.array(z.object({ id: z.string() })),
  },
  {
    expected: "({ id: string; } | null)[]",
    name: "nullable object array",
    schema: z.array(z.object({ id: z.string() }).nullable()),
  },
  {
    expected: "{ id: string; name: string; }",
    name: "object intersection",
    schema: z.intersection(
      z.object({ id: z.string() }),
      z.object({ name: z.string() })
    ),
  },
  {
    expected:
      '{ kind: "text"; text: string; } | { count: number; kind: "count"; }',
    name: "discriminated union",
    schema: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ count: z.number(), kind: z.literal("count") }),
    ]),
  },
  {
    expected: "Record<string, number>",
    name: "record",
    schema: z.record(z.string(), z.number()),
  },
  {
    expected: "Record<string, number | null>",
    name: "nullable record values",
    schema: z.record(z.string(), z.number().nullable()),
  },
  {
    expected: "Record<string, boolean> | null",
    name: "nullable record",
    schema: z.record(z.string(), z.boolean()).nullable(),
  },
  {
    expected: "{ id: string; } & Record<string, unknown>",
    name: "loose object",
    schema: z.looseObject({ id: z.string() }),
  },
  {
    expected: "[string, number]",
    name: "tuple",
    schema: z.tuple([z.string(), z.number()]),
  },
  {
    expected: "[string, number] | null",
    name: "nullable tuple",
    schema: z.tuple([z.string(), z.number()]).nullable(),
  },
  {
    expected: "[string | null]",
    name: "tuple with nullable item",
    schema: z.tuple([z.string().nullable()]),
  },
  {
    expected: "[string, ...number[]]",
    name: "tuple with rest",
    schema: z.tuple([z.string()], z.number()),
  },
  {
    expected: "[string, (number)?]",
    name: "optional tuple item",
    schema: z.tuple([z.string(), z.number().optional()]),
  },
  { expected: "[]", name: "empty tuple", schema: z.tuple([]) },
  {
    expected: "[string, ...(number | null)[]]",
    name: "tuple union rest",
    schema: z.tuple([z.string()], z.number().nullable()),
  },
  {
    expected: "[string, boolean][]",
    name: "tuple array",
    schema: z.array(z.tuple([z.string(), z.boolean()])),
  },
  {
    expected: "Record<string, number>[]",
    name: "record array",
    schema: z.array(z.record(z.string(), z.number())),
  },
  {
    expected: "({ id: string; } & Record<string, unknown>)[]",
    name: "loose object array",
    schema: z.array(z.looseObject({ id: z.string() })),
  },
  {
    expected: "Record<string, unknown>",
    name: "empty loose object",
    schema: z.looseObject({}),
  },
  {
    expected: "{ id: number; } & Record<string, number>",
    name: "catchall",
    schema: z.object({ id: z.number() }).catchall(z.number()),
  },
  {
    expected: "string | number | null",
    name: "nullable union",
    schema: z.union([z.string(), z.number()]).nullable(),
  },
  {
    expected: "{ id: string; } | null",
    name: "optional nullable object",
    optional: true,
    schema: z.object({ id: z.string() }).nullish(),
  },
  {
    expected: "{ id: string; } & Record<string, number | string>",
    name: "mixed catchall",
    schema: z.object({ id: z.string() }).catchall(z.number()),
  },
  {
    expected: "{ id?: string; } & Record<string, number | string | undefined>",
    name: "optional catchall property",
    schema: z.object({ id: z.string().optional() }).catchall(z.number()),
  },
  {
    expected: "{ id: string | null; } & Record<string, number | string | null>",
    name: "nullable catchall property",
    schema: z.object({ id: z.string().nullable() }).catchall(z.number()),
  },
];

const tupleReviewCases: {
  name: string;
  schema: JsonSchema;
  expected: string;
}[] = [
  {
    expected: "[string, number, number, ...number[]]",
    name: "required rest items",
    schema: {
      items: { type: "number" },
      minItems: 3,
      prefixItems: [{ type: "string" }],
      type: "array",
    },
  },
  {
    expected: "[boolean, number | null, ...(number | null)[]]",
    name: "required nullable rest items",
    schema: {
      items: { type: ["number", "null"] },
      minItems: 2,
      prefixItems: [{ type: "boolean" }],
      type: "array",
    },
  },
  {
    expected: "[string, unknown, ...unknown[]]",
    name: "required unrestricted rest items",
    schema: {
      items: true,
      minItems: 2,
      prefixItems: [{ type: "string" }],
      type: "array",
    },
  },
  {
    expected: "[unknown, unknown, ...unknown[]]",
    name: "required unspecified rest items",
    schema: { minItems: 2, prefixItems: [], type: "array" },
  },
  {
    expected: "never",
    name: "impossible required rest items",
    schema: {
      items: false,
      minItems: 2,
      prefixItems: [{ type: "string" }],
      type: "array",
    },
  },
  {
    expected: "[string, (boolean)?, ...number[]]",
    name: "optional prefix with rest",
    schema: {
      items: { type: "number" },
      minItems: 1,
      prefixItems: [{ type: "string" }, { type: "boolean" }],
      type: "array",
    },
  },
  {
    expected: "[string]",
    name: "closed required prefix",
    schema: {
      items: false,
      minItems: 1,
      prefixItems: [{ type: "string" }],
      type: "array",
    },
  },
];

const referenceCases: { name: string; schema: JsonSchema; expected: string }[] =
  [
    {
      expected: '{ value: "first" | "second"; }',
      name: "referenced object root and nested enum",
      schema: {
        $defs: {
          payload: {
            properties: { value: { $ref: "#/$defs/value" } },
            required: ["value"],
            type: "object",
          },
          value: { enum: ["first", "second"], type: "string" },
        },
        $ref: "#/$defs/payload",
      },
    },
    {
      expected: "[string, number | null]",
      name: "referenced tuple and nullable item",
      schema: {
        $defs: { value: { type: ["number", "null"] } },
        items: false,
        minItems: 2,
        prefixItems: [{ type: "string" }, { $ref: "#/$defs/value" }],
        type: "array",
      },
    },
  ];

const normalize = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();
const renderDeclaration = (context: JsonSchema): string => {
  const output = renderGeneratedTypes({ views: { "/": { context } } });
  return output.slice(
    output.indexOf("export interface ViewPropsByPath"),
    output.indexOf("declare module")
  );
};

const declarations = cases.map(({ schema }) => {
  const wrapped = z.object({ value: schema });
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  return renderDeclaration(
    wrapped["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    })
  );
});

describe("JSON Schema type generation", () => {
  it.each(cases.map((testCase, index) => ({ ...testCase, index })))(
    "generates $name",
    ({ expected, optional, index }) => {
      expect(normalize(requireValue(declarations[index]))).toBe(
        expected === "never"
          ? 'export interface ViewPropsByPath { "/": { context: never; }; }'
          : `export interface ViewPropsByPath { "/": { context: { value${optional === true ? "?" : ""}: ${expected}; }; }; }`
      );
    }
  );

  it.each(cases)(
    "preserves $name in component fields, callbacks, and actions",
    ({ schema, expected }) => {
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      const value = schema["~standard"].jsonSchema.output({
        target: "draft-2020-12",
      }) as JsonSchema;
      const output = normalize(
        renderGeneratedTypes({
          components: {
            Custom: {
              callbacks: { onValue: { input: value } },
              children: false,
              fields: { properties: { value }, type: "object" },
            },
          },
          tools: { echo: { input: value, kind: "server", output: value } },
        })
      );
      expect(output).toContain(`value?: ${expected};`);
      expect(output).toContain(`onValue?: (input: ${expected}) => void;`);
      expect(output).toContain(
        `echo: (input: ${expected}) => Promise<${expected}>;`
      );
    }
  );

  it.each<{ name: string; schema: JsonSchema; expected: string }>([
    {
      expected: "null | string",
      name: "null first",
      schema: { type: ["null", "string"] },
    },
    {
      expected: "number",
      name: "duplicate types",
      schema: { type: ["number", "integer", "number"] },
    },
    { expected: "never", name: "empty type array", schema: { type: [] } },
    {
      expected: "never",
      name: "never union",
      schema: { anyOf: [{ not: {} }, { not: {} }] },
    },
    {
      expected: "string | null",
      name: "duplicate union",
      schema: {
        anyOf: [{ type: "string" }, { type: "string" }, { type: "null" }],
      },
    },
    { expected: "unknown", name: "unknown schema", schema: {} },
    {
      expected: "unknown",
      name: "unknown type",
      schema: { type: "unsupported" },
    },
    {
      expected: "(string | number) & (string | boolean)",
      name: "intersection of unions",
      schema: {
        allOf: [
          { anyOf: [{ type: "string" }, { type: "number" }] },
          { anyOf: [{ type: "string" }, { type: "boolean" }] },
        ],
      },
    },
    { expected: "null", name: "null const", schema: { const: null } },
    {
      expected: "Record<string, unknown>",
      name: "open object",
      schema: { additionalProperties: true, type: "object" },
    },
    {
      expected: "unknown[]",
      name: "unspecified array items",
      schema: { type: "array" },
    },
    {
      expected: "unknown[]",
      name: "unrestricted array items",
      schema: { items: true, type: "array" },
    },
    {
      expected: "never[]",
      name: "forbidden array items",
      schema: { items: false, type: "array" },
    },
  ])("handles raw JSON Schema: $name", ({ schema, expected }) => {
    const output = normalize(
      renderDeclaration({
        properties: { sibling: { type: "string" }, value: schema },
        required: ["value", "sibling"],
        type: "object",
      })
    );
    expect(output).toContain(`value: ${expected};`);
  });

  it.each(tupleReviewCases)(
    "handles reviewed tuple case: $name",
    ({ schema, expected }) => {
      expect(
        normalize(
          renderDeclaration({
            properties: { sibling: { type: "string" }, value: schema },
            required: ["value", "sibling"],
            type: "object",
          })
        )
      ).toContain(`value: ${expected};`);
    }
  );

  it.each(referenceCases)(
    "resolves $name before rendering types",
    ({ schema, expected }) => {
      expect(normalize(renderDeclaration(schema))).toBe(
        `export interface ViewPropsByPath { "/": { context: ${expected}; }; }`
      );
    }
  );

  it("generates TypeScript types equivalent to the expected types", async () => {
    const source = [
      "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
      "type Assert<T extends true> = T;",
      ...cases.flatMap(({ expected, optional }, index) => [
        requireValue(declarations[index]).replace(
          "ViewPropsByPath",
          `Case${index}`
        ),
        `type Check${index} = Assert<Equal<Case${index}["/"]["context"]["value"], ${expected}${optional === true ? " | undefined" : ""}>>;`,
      ]),
      ...tupleReviewCases.flatMap(({ schema, expected }, index) => [
        renderDeclaration({
          properties: { sibling: { type: "string" }, value: schema },
          required: ["value", "sibling"],
          type: "object",
        }).replace("ViewPropsByPath", `TupleCase${index}`),
        `type TupleCheck${index} = Assert<Equal<TupleCase${index}["/"]["context"]["value"], ${expected}>>;`,
      ]),
      ...referenceCases.flatMap(({ schema, expected }, index) => [
        renderDeclaration(schema).replace(
          "ViewPropsByPath",
          `ReferenceCase${index}`
        ),
        `type ReferenceCheck${index} = Assert<Equal<ReferenceCase${index}["/"]["context"], ${expected}>>;`,
      ]),
      `const customer: Case${cases.findIndex(({ name }) => name === "mixed catchall")}["/"]["context"]["value"] = { id: "customer-1", extra: 42 };`,
      'const tuple: TupleCase0["/"]["context"]["value"] = ["first", 1, 2];',
      "// @ts-expect-error Required rest items must not be omitted.",
      'const shortTuple: TupleCase0["/"]["context"]["value"] = ["first"];',
      "// @ts-expect-error Required rest items must use the items schema type.",
      'const invalidTuple: TupleCase0["/"]["context"]["value"] = ["first", false, 2];',
    ].join("\n");
    const root = await mkdtemp(
      path.join(tmpdir(), "patchsmith-generated-type-check-")
    );
    try {
      await writeFile(path.join(root, "generated.ts"), source);
      await writeFile(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ESNext",
            types: [],
          },
          files: ["generated.ts"],
        })
      );
      const requireValueValue = createRequire(import.meta.url);
      const compiler = path.join(
        path.dirname(requireValueValue.resolve("typescript/package.json")),
        "bin/tsc"
      );
      // oxlint-disable-next-line typescript/strict-void-return -- Node explicitly supports promisify(execFile); its ChildProcess return is intentionally ignored by the callback-to-Promise adapter.
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
});
