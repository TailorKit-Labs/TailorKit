import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  ComponentDefinitions,
  NoComponentFieldCallbackConflicts,
} from "./components";
import { assertComponentDescription } from "./components";
import type { EmptyDefinitionMap, Schema } from "./shared";
import type { ContractTools } from "./tools";
import { flattenTools } from "./tools";
import type {
  ContextDefinitions,
  SlotDefinitions,
  ViewContextHierarchy,
} from "./views";

const isBooleanValue = <TValue>(value: TValue): value is TValue & boolean =>
  typeof value === "boolean";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

export interface PatchsmithContract<
  TComponents extends ComponentDefinitions = ComponentDefinitions,
  TViews extends ContextDefinitions = ContextDefinitions,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TTools extends ContractTools = ContractTools,
  TScopes extends Record<string, StandardSchemaV1> = Record<
    string,
    StandardSchemaV1
  >,
> {
  readonly components: TComponents;
  readonly views: TViews;
  readonly slots: TSlots;
  readonly tools: TTools;
  readonly scopes: TScopes;
}

/** Define the browser-safe interface shared by a host server and its clients. */
export function defineContract<
  const TComponents extends ComponentDefinitions = EmptyDefinitionMap,
  const TViews extends ContextDefinitions = EmptyDefinitionMap,
  const TSlots extends SlotDefinitions = EmptyDefinitionMap,
  const TTools extends ContractTools = EmptyDefinitionMap,
  const TScopes extends Record<string, Schema> = EmptyDefinitionMap,
>(definition: {
  components?: TComponents &
    NoComponentFieldCallbackConflicts<NoInfer<TComponents>>;
  views?: TViews & ViewContextHierarchy<NoInfer<TViews>>;
  slots?: TSlots & SlotDefinitions<keyof NoInfer<TViews> & string>;
  tools?: TTools;
  scopes?: TScopes;
}): PatchsmithContract<TComponents, TViews, TSlots, TTools, TScopes>;
export function defineContract(definition: {
  components?: ComponentDefinitions;
  views?: ContextDefinitions;
  slots?: SlotDefinitions;
  tools?: ContractTools;
  scopes?: Record<string, Schema>;
}): PatchsmithContract {
  for (const name of Object.keys(definition)) {
    if (!["components", "views", "slots", "tools", "scopes"].includes(name)) {
      throw new Error(`Unknown contract field "${name}"`);
    }
  }

  flattenTools(definition.tools ?? {});

  for (const [name, component] of Object.entries(definition.components ?? {})) {
    assertComponentDescription(name, component);
  }

  for (const [name, slot] of Object.entries(definition.slots ?? {})) {
    if (slot.description !== undefined && !isStringValue(slot.description)) {
      throw new TypeError(`Slot "${name}" description must be a string.`);
    }

    if (slot.multiple !== undefined && !isBooleanValue(slot.multiple)) {
      throw new TypeError(`Slot "${name}" multiple must be a boolean.`);
    }

    for (const view of slot.views) {
      if (!Object.hasOwn(definition.views ?? {}, view)) {
        throw new Error(`Slot "${name}" references undeclared view "${view}".`);
      }
    }
  }

  return {
    components: definition.components ?? {},
    scopes: definition.scopes ?? {},
    slots: definition.slots ?? {},
    tools: definition.tools ?? {},
    views: definition.views ?? {},
  };
}
