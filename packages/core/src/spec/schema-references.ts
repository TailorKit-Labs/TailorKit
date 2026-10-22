import type { StandardJSONSchemaV1 } from "@standard-schema/spec";

// JSON Schema keyword documents may include converter-specific annotations.
type SchemaDocument = ReturnType<StandardJSONSchemaV1.Converter["output"]>;

const isSchemaDocument = <TValue>(
  value: TValue
): value is TValue & SchemaDocument =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const schemaMaps = ["properties", "$defs"] as const;
const schemaArrays = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

const schemaValues = [
  "additionalProperties",
  "items",
  "not",
  "propertyNames",
] as const;

/** Visit schema positions only: const/enum values and annotations are data. */
const mapSchemaChildren = (
  schema: SchemaDocument,
  visit: (child: SchemaDocument) => SchemaDocument
): SchemaDocument => {
  const result = { ...schema };

  for (const keyword of schemaMaps) {
    const value = schema[keyword];

    if (isSchemaDocument(value)) {
      result[keyword] = Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          isSchemaDocument(child) ? visit(child) : child,
        ])
      );
    }
  }

  for (const keyword of schemaArrays) {
    const value = schema[keyword];

    if (Array.isArray(value)) {
      const children: unknown[] = value;
      result[keyword] = children.map((child) =>
        isSchemaDocument(child) ? visit(child) : child
      );
    }
  }

  for (const keyword of schemaValues) {
    const value = schema[keyword];

    if (isSchemaDocument(value)) {
      result[keyword] = visit(value);
    }
  }

  return result;
};

/** Deduplicate repeated subtrees without depending on a validator's converter. */
export const compactJsonSchema = (schema: SchemaDocument): SchemaDocument => {
  const counts = new Map<string, number>();
  let hasReferences = false;

  const collect = (node: SchemaDocument): SchemaDocument => {
    // Existing references/resource identifiers must retain their original scope.
    if (
      ["$ref", "$defs", "$id", "$anchor", "$dynamicRef", "$dynamicAnchor"].some(
        (key) => Object.hasOwn(node, key)
      )
    ) {
      hasReferences = true;
    }

    const key = JSON.stringify(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    mapSchemaChildren(node, collect);

    return node;
  };

  collect(schema);

  if (hasReferences) {
    return schema;
  }

  const definitions: Record<string, SchemaDocument> = {};
  const names = new Map<string, string>();

  const rewrite = (node: SchemaDocument): SchemaDocument => {
    const key = JSON.stringify(node);

    // Small scalar schemas are cheaper inline than a definition plus references.
    if (key.length < 128 || (counts.get(key) ?? 0) < 2) {
      return mapSchemaChildren(node, rewrite);
    }

    let name = names.get(key);

    if (name === undefined) {
      name = `schema${names.size + 1}`;
      names.set(key, name);
      definitions[name] = mapSchemaChildren(node, rewrite);
    }

    return { $ref: `#/$defs/${name}` };
  };

  const result = mapSchemaChildren(schema, rewrite);

  if (names.size === 0) {
    return schema;
  }

  return { ...result, $defs: definitions };
};

const referenceTarget = (
  root: SchemaDocument,
  reference: string
): SchemaDocument => {
  if (reference !== "#" && !reference.startsWith("#/")) {
    throw new Error(
      `Only local JSON Schema references are supported: "${reference}".`
    );
  }

  const pointer = decodeURIComponent(reference.slice(1));
  const segments = pointer === "" ? [] : pointer.slice(1).split("/");
  let target: unknown = root;

  for (const segment of segments) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");

    if (Array.isArray(target)) {
      const index = Number(key);
      const values: unknown[] = target;
      target =
        String(index) === key && Number.isInteger(index)
          ? values[index]
          : undefined;
    } else if (isSchemaDocument(target) && Object.hasOwn(target, key)) {
      target = target[key];
    } else {
      target = undefined;
    }
  }

  if (!isSchemaDocument(target)) {
    throw new Error(`Unresolved JSON Schema reference: "${reference}".`);
  }

  return target;
};

/** Expand local references for consumers that render types from schema trees. */
export const resolveJsonSchema = (schema: SchemaDocument): SchemaDocument => {
  const active = new Set<SchemaDocument>();
  const resolved = new Map<SchemaDocument, SchemaDocument>();

  const visit = (node: SchemaDocument): SchemaDocument => {
    if (active.has(node)) {
      throw new Error(
        "Circular JSON Schema references are not supported by type generation."
      );
    }

    const cached = resolved.get(node);

    if (cached !== undefined) {
      return cached;
    }

    active.add(node);
    const { $defs: definitions, $ref: reference, ...rest } = node;
    void definitions;
    let result = mapSchemaChildren(rest, visit);

    if (reference !== undefined) {
      if (!isStringValue(reference)) {
        throw new Error("JSON Schema $ref must be a string.");
      }

      const target = visit(referenceTarget(schema, reference));
      const { $schema: dialect, ...constraints } = result;

      if (Object.keys(constraints).length === 0) {
        result = { ...target, ...result };
      } else {
        result = { allOf: [target, constraints] };

        if (dialect !== undefined) {
          result.$schema = dialect;
        }
      }
    }

    active.delete(node);
    resolved.set(node, result);

    return result;
  };

  return visit(schema);
};
