import { createHash } from "node:crypto";

import { scopesSchema } from "@patchsmith/db/schema/scope";
import type { JsonObject, JsonValue, Scope } from "@patchsmith/db/schema/scope";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isBooleanValue = <TValue>(value: TValue): value is TValue & boolean =>
  typeof value === "boolean";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

export {
  type JsonObject,
  type JsonValue,
  type Scope,
} from "@patchsmith/db/schema/scope";

export {
  scopeSchema,
  scopeValueSchema,
  scopesSchema,
} from "@patchsmith/db/schema/scope";

const maxObjectEntries = 32;

const maxArrayEntries = 100;

const maxStringLength = 255;

const maxKeyLength = 64;

const maxDepth = 16;

const maxNodes = 512;

const maxSerializedBytes = 16 * 1024;

const isPlainRecord = (value: unknown): value is object => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }

  return true;
};

const validateOwnDataProperties = (
  // oxlint-disable-next-line anti-slop/no-object-parameters -- This structural adapter enumerates caller-owned fields; a concrete domain shape would exclude supported schema or attribute objects.
  value: object,
  keys: readonly PropertyKey[]
) => {
  for (const key of keys) {
    if (!isStringValue(key)) {
      throw new TypeError("Scope values cannot contain symbol keys.");
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (
      !descriptor ||
      !("value" in descriptor) ||
      !(descriptor.enumerable === true)
    ) {
      throw new TypeError(
        "Scope values must use enumerable own data properties."
      );
    }
  }
};

// oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
const canonicalizeJsonValue = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser rejects non-JSON values, accessors, cycles and invalid scope identities before returning the canonical domain value.
  value: unknown,
  state: { active: WeakSet<object>; nodes: number },
  depth: number
): JsonValue => {
  state.nodes += 1;

  if (state.nodes > maxNodes) {
    throw new TypeError("Scope value cannot contain more than 512 values.");
  }

  if (value === null || isBooleanValue(value)) {
    return value;
  }

  if (isStringValue(value)) {
    if (value.length > maxStringLength) {
      throw new TypeError("Scope strings cannot exceed 255 characters.");
    }

    return value;
  }

  if (isNumberValue(value)) {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Scope numbers must be finite and cannot be -0.");
    }

    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("Integer scope values must be safe integers.");
    }

    return value;
  }

  if (!isObjectValue(value)) {
    throw new TypeError("Scope values must contain only JSON values.");
  }

  if (depth > maxDepth) {
    throw new TypeError("Scope values cannot exceed a depth of 16.");
  }

  if (state.active.has(value)) {
    throw new TypeError("Scope values cannot contain cycles.");
  }

  state.active.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(
        "Scope arrays must use the standard array prototype."
      );
    }

    if (value.length > maxArrayEntries) {
      throw new TypeError("Scope arrays cannot contain more than 100 entries.");
    }

    const ownKeys = Reflect.ownKeys(value);

    if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) {
      throw new TypeError(
        "Scope arrays must be dense and cannot have extra properties."
      );
    }

    validateOwnDataProperties(
      value,
      ownKeys.filter((key): key is string => key !== "length")
    );
    const canonical: JsonValue[] = [];

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !(descriptor.enumerable === true)
      ) {
        throw new TypeError(
          "Scope arrays must be dense and cannot contain accessors."
        );
      }

      canonical[index] = canonicalizeJsonValue(
        descriptor.value,
        state,
        depth + 1
      );
    }

    state.active.delete(value);

    return canonical;
  }

  if (!isPlainRecord(value)) {
    throw new TypeError("Scope values must contain only plain objects.");
  }

  const ownKeys = Reflect.ownKeys(value);

  if (ownKeys.length > maxObjectEntries) {
    throw new TypeError("Scope objects cannot contain more than 32 entries.");
  }

  validateOwnDataProperties(value, ownKeys);
  const keys = ownKeys.filter(isStringValue);

  for (const key of keys) {
    if (key === "__proto__" || key.length === 0 || key.length > maxKeyLength) {
      throw new TypeError("Scope object keys must contain 1–64 characters.");
    }
  }

  const canonical: Record<string, JsonValue> = {};
  Object.setPrototypeOf(canonical, null);

  for (const key of keys.toSorted()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Scope values cannot contain accessors.");
    }

    canonical[key] = canonicalizeJsonValue(descriptor.value, state, depth + 1);
  }

  state.active.delete(value);

  return canonical;
};

const serializeJsonValue = (value: JsonValue): string => {
  if (value === null) {
    return "null";
  }

  if (isStringValue(value)) {
    return JSON.stringify(value);
  }

  if (isNumberValue(value) || isBooleanValue(value)) {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new TypeError("Scope value is not valid JSON.");
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .toSorted(([left], [right]) => Number(left > right) - Number(left < right))
    .map(([key, item]) => `${JSON.stringify(key)}:${serializeJsonValue(item)}`)
    .join(",")}}`;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser rejects non-JSON values, accessors, cycles and invalid scope identities before returning the canonical domain value.
const canonicalizeScopeValue = (value: unknown): JsonObject => {
  if (!isPlainRecord(value)) {
    throw new TypeError("Named scope value must be a plain object.");
  }

  const state = { active: new WeakSet<object>(), nodes: 0 };
  const canonicalValue = canonicalizeJsonValue(value, state, 0);

  if (
    Array.isArray(canonicalValue) ||
    canonicalValue === null ||
    !isObjectValue(canonicalValue)
  ) {
    throw new TypeError("Named scope value must be a plain object.");
  }

  if (Object.keys(canonicalValue).length === 0) {
    throw new TypeError("Named scope value must contain at least one entry.");
  }

  if (
    Buffer.byteLength(serializeJsonValue(canonicalValue), "utf-8") >
    maxSerializedBytes
  ) {
    throw new TypeError(
      "Named scope value cannot exceed 16 KiB when serialized."
    );
  }

  return canonicalValue;
};

const serializeScope = (scope: Scope): string =>
  `{"name":${JSON.stringify(scope.name)},"value":${serializeJsonValue(scope.value)}}`;

export interface CanonicalScope {
  scope: Scope;
  scopeKey: string;
}

/** Validates and recursively canonicalizes a named scope before deriving its stable key. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser rejects non-JSON values, accessors, cycles and invalid scope identities before returning the canonical domain value.
export const canonicalizeScope = (value: unknown): CanonicalScope => {
  if (!isPlainRecord(value)) {
    throw new TypeError("Scope must be a plain object.");
  }

  const keys = Reflect.ownKeys(value);
  validateOwnDataProperties(value, keys);

  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("value")) {
    throw new TypeError(
      "Named scope must contain only name and value properties."
    );
  }

  const name: unknown = Object.getOwnPropertyDescriptor(value, "name")?.value;

  if (!isStringValue(name) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name)) {
    throw new TypeError(
      "Scope name must be 1–64 letters, digits, underscores, or hyphens and start with a letter."
    );
  }

  const valueScope = canonicalizeScopeValue(
    Object.getOwnPropertyDescriptor(value, "value")?.value
  );

  const scope: Scope = {
    name,
    value: valueScope,
  };

  Object.setPrototypeOf(scope, null);
  const serialized = serializeScope(scope);

  const scopeKey = createHash("sha256")
    .update(`scope:v2:${serialized}`)
    .digest("hex")
    .slice(0, 32);

  return { scope, scopeKey };
};

/** Canonicalizes an exact set of named identities for one multi-scope read. */
export const canonicalizeScopes = (
  value: Parameters<typeof scopesSchema.parse>[0]
) => {
  const parsed = scopesSchema.parse(value);
  const scopes = parsed.map((scope) => canonicalizeScope(scope));
  const seen = new Set<string>();

  for (const entry of scopes) {
    const serialized = serializeScope(entry.scope);

    if (seen.has(serialized)) {
      throw new TypeError(
        "Multi-scope reads cannot contain duplicate identities."
      );
    }

    seen.add(serialized);
  }

  return scopes;
};

export const scopeMatches = (
  left: Parameters<typeof canonicalizeScope>[0],
  right: Parameters<typeof canonicalizeScope>[0]
): boolean => {
  const canonicalLeft = canonicalizeScope(left);
  const canonicalRight = canonicalizeScope(right);

  return (
    canonicalLeft.scopeKey === canonicalRight.scopeKey &&
    serializeScope(canonicalLeft.scope) === serializeScope(canonicalRight.scope)
  );
};
