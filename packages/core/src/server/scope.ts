import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  PatchsmithJsonValue,
  PatchsmithNamedScope,
  PatchsmithScope,
  PatchsmithScopes,
} from "./types";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isBooleanValue = <TValue>(value: TValue): value is TValue & boolean =>
  typeof value === "boolean";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

const maximumObjectKeys = 32;

const maximumKeyLength = 64;

const maximumStringLength = 255;

const maximumDepth = 16;

const maximumArrayLength = 100;

const maximumJsonBytes = 16 * 1024;

const maximumNodes = 512;

const scopeNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

export type PatchsmithScopeSchemas = Record<string, StandardSchemaV1>;

const isPlainRecord = (value: unknown): value is object => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const assertPlainRecord: (
  value: unknown,
  errorMessage: string
) => asserts value is object = (value, errorMessage) => {
  if (!isPlainRecord(value)) {
    throw new TypeError(errorMessage);
  }
};

const getRecordEntries = (
  // oxlint-disable-next-line anti-slop/no-object-parameters -- This structural adapter enumerates caller-owned fields; a concrete domain shape would exclude supported schema or attribute objects.
  value: object,
  errorMessage: string
): [string, unknown][] => {
  const ownKeys = Reflect.ownKeys(value);

  if (ownKeys.some((key) => !isStringValue(key))) {
    throw new TypeError(errorMessage);
  }

  const entries: [string, unknown][] = [];

  for (const key of ownKeys.filter(isStringValue)) {
    if (key === "__proto__") {
      throw new TypeError(
        'Patchsmith scope property names may not be "__proto__".'
      );
    }

    if (key.length === 0 || key.length > maximumKeyLength) {
      throw new TypeError(
        `Patchsmith scope property names must be 1 to ${maximumKeyLength} characters.`
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!(descriptor?.enumerable === true) || !("value" in descriptor)) {
      throw new TypeError(errorMessage);
    }

    entries.push([key, descriptor.value]);
  }

  return entries;
};

export const validatePatchsmithScopeName = (name: string): string => {
  if (!scopeNamePattern.test(name)) {
    throw new TypeError(
      'Patchsmith scope names must start with a letter and contain only letters, numbers, "_", or "-".'
    );
  }

  return name;
};

const isStandardSchema = (value: unknown): value is StandardSchemaV1 => {
  if (value === null || typeof value !== "object" || !("~standard" in value)) {
    return false;
  }

  const standard = value["~standard"];

  return (
    standard !== null &&
    typeof standard === "object" &&
    "validate" in standard &&
    typeof standard.validate === "function"
  );
};

export const validatePatchsmithScopeSchemas = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the runtime validation boundary for host-provided scopes and validators; invalid values must remain representable until checked.
  value: unknown
): PatchsmithScopeSchemas => {
  assertPlainRecord(
    value,
    "Patchsmith scopes must be an object of Standard Schema validators."
  );

  const entries = getRecordEntries(
    value,
    "Patchsmith scopes must contain enumerable validator data properties."
  );

  if (entries.length === 0) {
    throw new TypeError("Patchsmith must declare at least one named scope.");
  }

  if (entries.length > maximumObjectKeys) {
    throw new TypeError(
      `Patchsmith may declare at most ${maximumObjectKeys} named scopes.`
    );
  }

  const schemas: [string, StandardSchemaV1][] = [];

  for (const [name, schema] of entries) {
    validatePatchsmithScopeName(name);

    if (!isStandardSchema(schema)) {
      throw new TypeError(
        `Patchsmith scope "${name}" must be a Standard Schema validator.`
      );
    }

    schemas.push([name, schema]);
  }

  return Object.fromEntries(schemas);
};

const compareStrings = (left: string, right: string): number =>
  (() => {
    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1 as const;
    }

    return 0 as const;
  })();

// oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
const normalizeJsonValue = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the runtime validation boundary for host-provided scopes and validators; invalid values must remain representable until checked.
  value: unknown,
  depth: number,
  isRoot: boolean,
  ancestors: Set<object>,
  countNode: () => void
): PatchsmithJsonValue => {
  countNode();

  if (value === null || isBooleanValue(value) || isStringValue(value)) {
    if (isStringValue(value) && value.length > maximumStringLength) {
      throw new TypeError(
        `Patchsmith scope strings may not exceed ${maximumStringLength} characters.`
      );
    }

    return value;
  }

  if (isNumberValue(value)) {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new TypeError(
        "Patchsmith scope numbers must be finite and safe when integral."
      );
    }

    if (Object.is(value, -0)) {
      throw new TypeError("Patchsmith scope numbers may not be negative zero.");
    }

    return value;
  }

  if (!isObjectValue(value)) {
    throw new TypeError(
      "Patchsmith scope values must contain only JSON values."
    );
  }

  if (depth > maximumDepth) {
    throw new TypeError(
      `Patchsmith scope values may be nested at most ${maximumDepth} levels deep.`
    );
  }

  if (ancestors.has(value)) {
    throw new TypeError("Patchsmith scope values may not contain cycles.");
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("Patchsmith scope arrays must be standard arrays.");
    }

    if (value.length > maximumArrayLength) {
      throw new TypeError(
        `Patchsmith scope arrays may contain at most ${maximumArrayLength} items.`
      );
    }

    const ownKeys = Reflect.ownKeys(value);

    if (
      ownKeys.length !== value.length + 1 ||
      !ownKeys.includes("length") ||
      ownKeys.some((key) => !isStringValue(key))
    ) {
      throw new TypeError(
        "Patchsmith scope arrays must be dense and have no extra properties."
      );
    }

    const result: PatchsmithJsonValue[] = [];

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

      if (!(descriptor?.enumerable === true) || !("value" in descriptor)) {
        throw new TypeError(
          "Patchsmith scope arrays must contain enumerable data items."
        );
      }

      result.push(
        normalizeJsonValue(
          descriptor.value,
          depth + 1,
          false,
          ancestors,
          countNode
        )
      );
    }

    ancestors.delete(value);
    Object.freeze(result);

    return result;
  }

  if (!isPlainRecord(value)) {
    throw new TypeError("Patchsmith scope objects must be plain JSON objects.");
  }

  const entries = getRecordEntries(
    value,
    "Patchsmith scope objects must contain data properties."
  );

  if (isRoot && entries.length === 0) {
    throw new TypeError(
      "Patchsmith scope values must be nonempty plain JSON objects."
    );
  }

  if (entries.length > maximumObjectKeys) {
    throw new TypeError(
      `Patchsmith scope objects may contain at most ${maximumObjectKeys} properties.`
    );
  }

  const result = Object.fromEntries(
    entries
      .toSorted(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [
        key,
        normalizeJsonValue(child, depth + 1, false, ancestors, countNode),
      ])
  );

  ancestors.delete(value);
  Object.freeze(result);

  return result;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser validates untrusted JSON values before returning the owned scope contract.
export const normalizePatchsmithScope = (value: unknown): PatchsmithScope => {
  if (!isPlainRecord(value)) {
    throw new TypeError(
      "Patchsmith scope values must be nonempty plain JSON objects."
    );
  }

  let nodes = 0;
  const ancestors = new Set<object>();

  const normalized = normalizeJsonValue(value, 0, true, ancestors, () => {
    nodes += 1;

    if (nodes > maximumNodes) {
      throw new TypeError(
        `Patchsmith scope values may contain at most ${maximumNodes} JSON values.`
      );
    }
  });

  const json = JSON.stringify(normalized);

  if (
    json === undefined ||
    new TextEncoder().encode(json).byteLength > maximumJsonBytes
  ) {
    throw new TypeError(
      `Patchsmith scope values may not exceed ${maximumJsonBytes} bytes of JSON.`
    );
  }

  if (!isObjectValue(normalized) || Array.isArray(normalized)) {
    throw new TypeError("Patchsmith scope values must be JSON objects.");
  }

  return normalized;
};

export const validatePatchsmithScopes = async (
  scopeSchemas: PatchsmithScopeSchemas,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the runtime validation boundary for host-provided scopes and validators; invalid values must remain representable until checked.
  value: unknown
): Promise<PatchsmithScopes> => {
  assertPlainRecord(
    value,
    "Patchsmith authenticate() must return a scopes object."
  );

  const inputEntries = getRecordEntries(
    value,
    "Patchsmith authenticate() scopes must be data properties."
  );

  if (inputEntries.length === 0) {
    throw new TypeError(
      "Patchsmith authenticate() must return at least one scope."
    );
  }

  const validatedEntries: [string, PatchsmithScope][] = [];

  for (const [name, scopeValue] of inputEntries) {
    if (!Object.hasOwn(scopeSchemas, name)) {
      throw new TypeError(
        `Patchsmith authenticate() returned undeclared scope "${name}".`
      );
    }

    const scopeSchema = scopeSchemas[name];

    if (!scopeSchema) {
      throw new TypeError(
        `Patchsmith authenticate() returned undeclared scope "${name}".`
      );
    }

    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    const result = await scopeSchema["~standard"].validate(scopeValue);

    if (result.issues) {
      throw new TypeError(
        `Patchsmith authenticate() returned scope "${name}" that failed its Standard Schema validation.`
      );
    }

    if (result.value !== undefined) {
      validatedEntries.push([name, normalizePatchsmithScope(result.value)]);
    }
  }

  if (validatedEntries.length === 0) {
    throw new TypeError(
      "Patchsmith authenticate() must return at least one available scope."
    );
  }

  validatedEntries.sort(([left], [right]) => compareStrings(left, right));

  return Object.freeze(Object.fromEntries(validatedEntries));
};

export const normalizePatchsmithNamedScope = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the runtime validation boundary for host-provided scopes and validators; invalid values must remain representable until checked.
  value: unknown
): PatchsmithNamedScope => {
  if (!isPlainRecord(value)) {
    throw new TypeError(
      "Patchsmith scope identity must contain a name and value."
    );
  }

  const entries = getRecordEntries(
    value,
    "Patchsmith scope identity must contain data properties."
  );

  if (
    entries.length !== 2 ||
    !Object.hasOwn(value, "name") ||
    !Object.hasOwn(value, "value")
  ) {
    throw new TypeError(
      "Patchsmith scope identity must contain only a name and value."
    );
  }

  const name: unknown = Object.getOwnPropertyDescriptor(value, "name")?.value;

  const scopeValue: unknown = Object.getOwnPropertyDescriptor(
    value,
    "value"
  )?.value;

  if (!isStringValue(name)) {
    throw new TypeError(
      "Patchsmith scope identity must contain a name and value."
    );
  }

  validatePatchsmithScopeName(name);

  return { name, value: normalizePatchsmithScope(scopeValue) };
};

export const selectPatchsmithScopes = (
  availableScopes: PatchsmithScopes,
  selectedNames?: readonly string[]
): PatchsmithNamedScope[] => {
  const names = selectedNames ?? Object.keys(availableScopes);

  if (names.length === 0) {
    throw new TypeError("At least one Patchsmith scope must be selected.");
  }

  const selected: PatchsmithNamedScope[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    validatePatchsmithScopeName(name);

    if (seen.has(name)) {
      continue;
    }

    seen.add(name);

    if (!Object.hasOwn(availableScopes, name)) {
      throw new TypeError(
        `Patchsmith scope "${name}" is not available for this request.`
      );
    }

    const value = availableScopes[name];

    if (!value) {
      throw new TypeError(
        `Patchsmith scope "${name}" is not available for this request.`
      );
    }

    selected.push({ name, value });
  }

  if (selected.length === 0) {
    throw new TypeError("At least one Patchsmith scope must be selected.");
  }

  return selected;
};
