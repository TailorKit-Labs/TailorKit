import type { TailorKitSchemaSpec } from "#spec/index";

import type {
  ComponentDefinitions,
  NoComponentFieldCallbackConflicts,
  ResolvedComponentMetadata,
} from "./components";
import { resolveComponentMetadata } from "./components";
import type { EmptyDefinitionMap, Schema, SchemaSerializer } from "./shared";
import { jsonSchemaSerializer, serializeSchema } from "./shared";
import type { ContractTools } from "./tools";
import { serializeTools } from "./tools";
import type {
  ResolvedViewMetadata,
  ViewContextHierarchy,
  ContextDefinitions,
  SlotDefinitions,
} from "./views";

const isBooleanValue = <TValue>(value: TValue): value is TValue & boolean =>
  typeof value === "boolean";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

type EmptyToolMap = EmptyDefinitionMap;

export interface TailorKitSchema<
  TComponents extends Record<string, unknown> = ComponentDefinitions,
  TViews extends Record<string, unknown> = ContextDefinitions,
  TTools extends ContractTools = EmptyToolMap,
> {
  /**
   * Internal TailorKit implementation details.
   *
   * This API is not covered by semantic versioning and may change or break at
   * any time. Avoid depending on it in application code. If you need something
   * exposed here, please open a GitHub issue explaining what you are trying to
   * build so we can design a stable public API for that use case.
   *
   * @internal
   */
  $internal: {
    tools: TTools;
    components: {
      [TName in keyof TComponents]: ResolvedComponentMetadata;
    };
    views: {
      [TName in keyof TViews]: ResolvedViewMetadata;
    };
  };
  slots: SlotDefinitions;
  tools: TTools;
  components: TComponents;
  views: TViews;
  serialize: (schemaSerializer?: SchemaSerializer) => TailorKitSchemaSpec;
}

// JSON Schema cannot represent undefined at its root. Preserve that information
// separately before sending the schema to app type generation.
const contextMayBeOmitted = (schema: Schema): boolean => {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Probe whether the schema accepts an omitted context.
  const result = schema["~standard"].validate(undefined);
  if (result instanceof Promise) {
    // Serialization is synchronous; conservatively allow omission for async schemas.
    void (async () => {
      try {
        await result;
      } catch {
        /* Intentionally no action is needed. */
      }
    })();
    return true;
  }
  return !result.issues;
};

export function createTailorKitSchema<
  const TComponents extends Record<string, unknown>,
  const TViews extends ContextDefinitions = Record<string, never>,
  const TTools extends ContractTools = EmptyToolMap,
>(schema: {
  slots?: SlotDefinitions<keyof NoInfer<TViews> & string>;
  scopes?: Record<string, Schema>;
  tools?: TTools;
  components: TComponents &
    NoComponentFieldCallbackConflicts<NoInfer<TComponents>>;
  views?: TViews & ViewContextHierarchy<NoInfer<TViews>>;
}): TailorKitSchema<TComponents, TViews, TTools>;
export function createTailorKitSchema(schema: {
  slots?: SlotDefinitions;
  scopes?: Record<string, Schema>;
  tools?: ContractTools;
  components: object;
  views?: ContextDefinitions;
}) {
  for (const [name, slot] of Object.entries(schema.slots ?? {})) {
    if (slot.description !== undefined && !isStringValue(slot.description)) {
      throw new TypeError(`Slot "${name}" description must be a string.`);
    }
    if (slot.multiple !== undefined && !isBooleanValue(slot.multiple)) {
      throw new TypeError(`Slot "${name}" multiple must be a boolean.`);
    }
    for (const view of slot.views) {
      if (!Object.hasOwn(schema.views ?? {}, view)) {
        throw new Error(`Slot "${name}" references undeclared view "${view}".`);
      }
    }
  }
  const components: Record<string, ResolvedComponentMetadata> = {};
  const views: Record<string, ResolvedViewMetadata> = {};

  // SAFETY: Component metadata is resolved from the same caller-owned definitions that the public schema signature preserves.
  for (const [name, definition] of Object.entries(
    /* oxlint-disable typescript/no-unsafe-type-assertion -- These keys and definitions come from the same declared schema tables; the loops populate every declared key before the metadata escapes. */
    schema.components as ComponentDefinitions
    /* oxlint-enable typescript/no-unsafe-type-assertion */
  )) {
    components[name] = resolveComponentMetadata(name, definition);
  }

  for (const [name, context] of Object.entries(schema.views ?? {})) {
    views[name] = { context };
  }

  const serialize = (
    schemaSerializer: SchemaSerializer = jsonSchemaSerializer
  ): TailorKitSchemaSpec => {
    const serializedComponents: TailorKitSchemaSpec["components"] = {};
    const serializedViews: TailorKitSchemaSpec["views"] = {};

    for (const [name, metadata] of Object.entries(components)) {
      const callbacks: TailorKitSchemaSpec["components"][string]["callbacks"] =
        {};
      for (const [callbackName, callback] of Object.entries(
        metadata.callbacks
      )) {
        if (callback === undefined) {
          continue;
        }
        callbacks[callbackName] = {
          input: serializeSchema(callback.input, schemaSerializer),
          output: serializeSchema(callback.output, schemaSerializer),
        };
      }

      serializedComponents[name] = {
        callbacks,
        children: metadata.children,
        fields: serializeSchema(metadata.fields, schemaSerializer),
      };
    }

    for (const [name, metadata] of Object.entries(views)) {
      serializedViews[name] = {
        context: serializeSchema(metadata.context, schemaSerializer),
      };
      if (metadata.context && contextMayBeOmitted(metadata.context)) {
        serializedViews[name].contextOptional = true;
      }
    }

    const serialized: TailorKitSchemaSpec = {
      components: serializedComponents,

      slots: Object.fromEntries(
        Object.entries(schema.slots ?? {}).map(([name, slot]) => {
          const definition: NonNullable<TailorKitSchemaSpec["slots"]>[string] =
            {
              views: [...slot.views],
            };
          if (slot.multiple !== undefined) {
            definition.multiple = slot.multiple;
          }
          if (slot.description !== undefined) {
            definition.description = slot.description;
          }
          return [name, definition];
        })
      ),

      tools: serializeTools(schema.tools ?? {}, schemaSerializer),

      version: 1,

      views: serializedViews,
    };
    if (schema.scopes) {
      serialized.scopes = Object.fromEntries(
        Object.entries(schema.scopes).flatMap(([name, scope]) => {
          const value = serializeSchema(scope, schemaSerializer);
          return value ? [[name, value]] : [];
        })
      );
    }
    return serialized;
  };

  return {
    $internal: {
      components,
      tools: schema.tools ?? {},
      views,
    },
    components: schema.components,
    serialize,
    slots: schema.slots ?? {},
    tools: schema.tools ?? {},
    views: schema.views ?? {},
  };
}

export type { TailorKitTheme } from "#primitives/theme";

export { tool } from "./tools";

export type {
  ContractTool,
  ContractTools,
  ToolImplementations,
  ToolCallers,
  ToolContext,
  ToolIdentity,
  InferToolInput,
  InferToolOutput,
} from "./tools";

export {
  type Callback,
  type CallbackDefinition,
  type CallbackMap,
  type Callbacks,
  type InferCallback,
  type InferCallbacks,
} from "./callbacks";

export {
  type Component,
  type ComponentDefinition,
  type ComponentDefinitions,
  type ComponentProps,
  type Components,
  type Fields,
  type NoComponentFieldCallbackConflicts,
  type ResolvedComponentMetadata,
} from "./components";

export {
  type ResolvedViewMetadata,
  type View,
  type ViewContextHierarchy,
  type ViewDefinition,
  type ViewDefinitions,
  type ContextDefinitions,
  type Views,
  type SlotDefinitions,
} from "./views";

export {
  jsonSchemaSerializer,
  type Schema,
  type SchemaSerializer,
} from "./shared";

export type { TailorKitSchema as TailorKit };
