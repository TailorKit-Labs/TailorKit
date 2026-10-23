import { z } from "zod";

import { Icon } from "#icons/zod";
import type { ComponentDefinition } from "#schema/index";

import {
  primitiveDefinitions,
  primitiveInteractionStates,
  mapPrimitiveDefinitions,
} from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { PatchsmithTheme } from "./theme";

export { defaultBreakpoints, primitiveDefaults } from "./theme";

type FieldValidators = Record<string, z.ZodType>;

type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
> & { Icon: ReturnType<typeof Icon> };

const tokenEnum = (tokens: Record<string, string> | undefined): z.ZodType => {
  const keys = Object.keys(tokens ?? {});

  if (keys.length === 0) {
    return z.never();
  }

  return z.enum(keys);
};

const valueEnum = (values: readonly (number | string)[]): z.ZodType => {
  const [first, ...rest] = values;

  if (first === undefined) {
    return z.never();
  }

  return z.union([z.literal(first), ...rest.map((value) => z.literal(value))]);
};

const responsive = (
  schema: z.ZodType,
  theme: PatchsmithTheme,
  interactive = true
): z.ZodType => {
  const fields: FieldValidators = {};
  fields.default = schema.optional();

  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[key] = schema.optional();
  }

  if (interactive) {
    const stateValue = responsive(schema, theme, false).optional();

    for (const state of primitiveInteractionStates) {
      fields[state] = stateValue;
    }
  }

  return z.union([schema, z.object(fields).strict()]);
};

const propSchema = (
  definition: PrimitivePropDefinition,
  theme: PatchsmithTheme
): z.ZodType => {
  if (definition.kind === "boolean") {
    return z.boolean().optional();
  }

  if (definition.kind === "string") {
    return z.string().optional();
  }

  const schema =
    definition.kind === "token"
      ? tokenEnum(theme.tokens?.[definition.token])
      : valueEnum(definition.values);

  return definition.responsive === false
    ? schema.optional()
    : responsive(schema, theme).optional();
};

export const primitives = (
  theme: PatchsmithTheme = {}
): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);

  const components = mapPrimitiveDefinitions((name) => {
    const fields = z.object(
      Object.fromEntries(
        Object.entries<PrimitivePropDefinition>(primitiveDefinitions[name]).map(
          ([propName, definition]) => [
            propName,
            propSchema(definition, resolvedTheme),
          ]
        )
      )
    );

    return {
      callbacks: name === "Pressable" ? { onPress: {} } : {},
      children: true as const,
      fields: name === "Pressable" ? fields.strict() : fields,
    };
  });

  return { ...components, Icon: Icon({ library: "lucide" }) };
};
