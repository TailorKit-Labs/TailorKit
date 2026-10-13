import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { TailorKitScope } from "../server/types";
import type { TailorKitSchemaSpec } from "../spec/index";
import type { Schema, SchemaSerializer } from "./shared";
import { serializeSchema } from "./shared";

export type ToolKind = "client" | "server";
export interface ContractTool<
  K extends ToolKind = ToolKind,
  I extends Schema | undefined = Schema | undefined,
  O extends Schema | undefined = Schema | undefined,
> {
  readonly $tailorkitToolDefinition: true;
  readonly kind: K;
  readonly definition: { input?: I; output?: O };
  input: <N extends Schema>(schema: N) => ContractTool<K, N, O>;
  output: <N extends Schema>(schema: N) => ContractTool<K, I, N>;
}
export interface ContractTools {
  [name: string]: ContractTool | ContractTools;
}
const build = <
  K extends ToolKind,
  I extends Schema | undefined,
  O extends Schema | undefined,
>(
  kind: K,
  input?: I,
  output?: O
): ContractTool<K, I, O> => ({
  $tailorkitToolDefinition: true,
  definition: { input, output },
  input: (schema) => build(kind, schema, output),
  kind,
  output: (schema) => build(kind, input, schema),
});
export const tool = {
  client: () => build<"client", undefined, undefined>("client"),
  server: () => build<"server", undefined, undefined>("server"),
};
export type InferToolInput<T> =
  T extends ContractTool<ToolKind, infer I, Schema | undefined>
    ? I extends Schema
      ? StandardSchemaV1.InferInput<I>
      : undefined
    : never;
export type InferToolOutput<T> =
  T extends ContractTool<ToolKind, Schema | undefined, infer O>
    ? O extends Schema
      ? StandardSchemaV1.InferOutput<O>
      : ReturnType<() => void>
    : never;
export interface ToolIdentity {
  readonly subjectId?: string;
  readonly installationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly deploymentId: string;
  readonly scope: { name: string; value: TailorKitScope };
  readonly expiresAt: number;
}
export interface ToolContext {
  readonly identity: ToolIdentity;
  readonly scope: ToolIdentity["scope"];
  readonly requestId: string;
}
export interface ToolImplementationTree<TOutput = unknown> {
  [name: string]:
    | {
        bivarianceHack: (options: {
          input: never;
          context: ToolContext;
        }) => TOutput;
      }["bivarianceHack"]
    | ToolImplementationTree<TOutput>;
}
export type ToolImplementations<
  T extends ContractTools,
  K extends ToolKind,
> = string extends keyof T
  ? ToolImplementationTree
  : {
      [
        N in keyof T as T[N] extends ContractTool
          ? T[N]["kind"] extends K
            ? N
            : never
          : keyof ToolImplementations<
                Extract<T[N], ContractTools>,
                K
              > extends never
            ? never
            : N
      ]: T[N] extends ContractTool<K, infer I, infer O>
        ? (options: {
            input: I extends Schema
              ? StandardSchemaV1.InferOutput<I>
              : undefined;
            context: ToolContext;
          }) =>
            | (O extends Schema
                ? StandardSchemaV1.InferInput<O>
                : ReturnType<() => void>)
            | Promise<
                O extends Schema
                  ? StandardSchemaV1.InferInput<O>
                  : ReturnType<() => void>
              >
        : ToolImplementations<Extract<T[N], ContractTools>, K>;
    };
export interface ToolCallerTree {
  [name: string]:
    | ((
        input?: StandardSchemaV1.InferInput<Schema>
      ) => Promise<StandardSchemaV1.InferOutput<Schema>>)
    | ToolCallerTree;
}
export type ToolCallers<
  T extends ContractTools,
  K extends ToolKind = ToolKind,
> = string extends keyof T
  ? ToolCallerTree
  : {
      [
        N in keyof T as T[N] extends ContractTool
          ? T[N]["kind"] extends K
            ? N
            : never
          : keyof ToolCallers<Extract<T[N], ContractTools>, K> extends never
            ? never
            : N
      ]: T[N] extends ContractTool
        ? (
            ...args: undefined extends InferToolInput<T[N]>
              ? [input?: InferToolInput<T[N]>]
              : [input: InferToolInput<T[N]>]
          ) => Promise<InferToolOutput<T[N]>>
        : ToolCallers<Extract<T[N], ContractTools>, K>;
    };
const isContractTool = (
  value: ContractTool | ContractTools
): value is ContractTool => value.$tailorkitToolDefinition === true;

export const flattenTools = (
  tools: ContractTools,
  prefix = ""
): Map<string, ContractTool> => {
  const result = new Map<string, ContractTool>();
  for (const [name, value] of Object.entries(tools)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(name) ||
      ["constructor", "prototype", "__proto__"].includes(name)
    ) {
      throw new Error(`Invalid tool name "${name}"`);
    }
    const path = prefix + name;
    if (isContractTool(value)) {
      const leaf = value;
      if (!["client", "server"].includes(leaf.kind) || !leaf.definition) {
        throw new Error(`Invalid tool declaration "${path}"`);
      }
      result.set(path, leaf);
    } else {
      for (const [key, leaf] of flattenTools(value, `${path}.`)) {
        result.set(key, leaf);
      }
    }
  }
  return result;
};
export const serializeTools = (
  tools: ContractTools,
  serializer?: SchemaSerializer
): TailorKitSchemaSpec["tools"] => {
  const result: TailorKitSchemaSpec["tools"] = {};
  for (const [name, value] of Object.entries(tools)) {
    if (!value) {
      continue;
    }
    if (isContractTool(value)) {
      const leaf = value;
      result[name] = {
        input: serializeSchema(leaf.definition.input, serializer, "input"),
        kind: leaf.kind,
        output: serializeSchema(leaf.definition.output, serializer),
      };
    } else {
      result[name] = serializeTools(value, serializer);
    }
  }
  return result;
};
type ParsedToolValue<TSchema extends Schema | undefined> =
  TSchema extends Schema ? StandardSchemaV1.InferOutput<TSchema> : undefined;

export const validateToolValue = async <TSchema extends Schema | undefined>(
  schema: TSchema,
  // This is the parsing boundary; accepting unknown is required before Standard Schema validation.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw values are decoded here, not passed into domain handlers.
  value: unknown
): Promise<ParsedToolValue<TSchema>> => {
  if (!schema) {
    if (value !== undefined) {
      throw new Error("Tool expects no value");
    }
    // SAFETY: Without a schema, the only admitted value is undefined and the corresponding output branch is undefined.
    return undefined as ParsedToolValue<TSchema>;
  }
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    throw new Error("Invalid tool payload");
  }
  // SAFETY: This exact schema produced result.value after reporting no validation issues.
  return result.value as ParsedToolValue<TSchema>;
};
