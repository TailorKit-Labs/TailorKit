import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";

import { compactJsonSchema } from "#spec/schema-references";

export type Schema = StandardSchemaV1;

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- An omitted definition table must have no keys, including in keyof-based inference.
export type EmptyDefinitionMap = Record<never, never>;

// This conditional-type identity preserves unconstrained schema inputs; {} would reject null and undefined.
// oxlint-disable-next-line anti-slop/no-unknown-type-aliases -- The neutral intersection type is part of the public schema inference contract.
export type EmptyObject = unknown;

export type MaybePromise<T> = T | Promise<T>;

export type InferSchema<TSchema> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : EmptyObject;

export type MergeProps<TBase, TOverride> = Omit<TBase, keyof TOverride> &
  TOverride;

// JSON Schema interfaces from converters may omit a string index signature.
export type SerializedSchema =
  | ReturnType<StandardJSONSchemaV1.Converter["output"]>
  | { readonly $schema?: string; readonly type?: string | readonly string[] };

export interface SchemaSerializerOptions {
  target: "draft-2020-12";
  typeMode: "input" | "output";
}

export type SchemaSerializer = {
  // Native converters need their library's schema metadata beyond Standard Schema.
  serialize: (
    schema: Schema,
    options?: SchemaSerializerOptions
  ) => SerializedSchema | undefined;
}["serialize"];

const hasJsonSchemaConverter = (
  schema: Schema
): schema is Schema & StandardJSONSchemaV1 => {
  const properties = schema["~standard"];

  if (!("jsonSchema" in properties)) {
    return false;
  }

  const converter = properties.jsonSchema;

  return (
    converter !== null &&
    typeof converter === "object" &&
    "input" in converter &&
    typeof converter.input === "function" &&
    "output" in converter &&
    typeof converter.output === "function"
  );
};

export const jsonSchemaSerializer: SchemaSerializer = (schema, options) => {
  if (!hasJsonSchemaConverter(schema)) {
    throw new Error(
      "This schema does not implement Standard JSON Schema. Supply a schemaSerializer when creating the server."
    );
  }

  return schema["~standard"].jsonSchema[options?.typeMode ?? "output"]({
    target: "draft-2020-12",
  });
};

export const serializeSchema = (
  schema: Schema | undefined,
  schemaSerializer?: SchemaSerializer,
  typeMode: SchemaSerializerOptions["typeMode"] = "output"
): ReturnType<StandardJSONSchemaV1.Converter["output"]> | undefined => {
  if (schema === undefined || schemaSerializer === undefined) {
    return undefined;
  }

  // SAFETY: The serializer contract returns JSON Schema objects; some native converter interfaces omit the string index signature required by Standard JSON Schema.
  const serializer =
    schema["~standard"].vendor === "patchsmith" &&
    hasJsonSchemaConverter(schema)
      ? jsonSchemaSerializer
      : schemaSerializer;

  const serialized:
    | ReturnType<StandardJSONSchemaV1.Converter["output"]>
    | undefined = serializer(schema, {
    target: "draft-2020-12",
    typeMode,
  });

  return serialized === undefined ? undefined : compactJsonSchema(serialized);
};
