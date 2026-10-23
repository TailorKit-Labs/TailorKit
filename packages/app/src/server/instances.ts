import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";

import { AppError } from "#errors";
import type { ViewDataFields, ViewInstance } from "#views";

import { action, defineRouter, isFunction } from "./functions";
import type { AppDefinition, Functions, Identity } from "./functions";

interface InstanceResolver<TOutput = unknown> {
  slot: string;
  path: string;
  dataSchema: StandardSchemaV1;
  resolve: (context: {
    context: ViewDataFields;
    identity: Identity;
    signal: AbortSignal;
    queries: unknown;
  }) => TOutput;
}

const addressSchema = v.object({
  path: v.pipe(v.string(), v.startsWith("/"), v.maxLength(1024)),
  slot: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
});

const instanceResults = v.pipe(
  v.array(
    v.object({
      data: v.unknown(),
      key: v.pipe(v.string(), v.minLength(1)),
      metadata: v.record(v.string(), v.unknown()),
    })
  ),
  v.check(
    (items) => new Set(items.map((item) => item.key)).size === items.length,
    "Instance keys must be unique"
  )
);

const registeredQueries = (functions: Functions): Functions => {
  const queries: Record<string, Functions[string]> = {};

  for (const [name, fn] of Object.entries(functions)) {
    if (isFunction(fn)) {
      if (fn.kind === "query") {
        queries[name] = fn;
      }
    } else {
      const nested = registeredQueries(fn);

      if (Object.keys(nested).length) {
        queries[name] = nested;
      }
    }
  }

  return queries;
};

// Resolver output is untrusted until the instance envelope and owning data schema validate it.
const validateInstanceResults = async (
  dataSchema: StandardSchemaV1,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This boundary validates app-provided resolver output against its schemas.
  value: unknown
) => {
  const result = v.safeParse(instanceResults, value);

  if (!result.success) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
  }

  return await Promise.all(
    result.output.map(async (item) => {
      const parsed = await dataSchema["~standard"].validate(item.data);

      if (parsed.issues) {
        throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
      }

      return { ...item, data: parsed.value };
    })
  );
};

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This recursive validation boundary checks parsed schema outputs for lossless JSON storage, including cycles, class instances, and non-finite numbers. */
const isJsonValue = (value: unknown, ancestors: Set<object>): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  if (
    Object.getOwnPropertySymbols(value).length ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }

  ancestors.add(value);

  const values = Array.isArray(value) ? value : Object.values(value);

  for (const item of values) {
    if (!isJsonValue(item, ancestors)) {
      ancestors.delete(value);

      return false;
    }
  }

  ancestors.delete(value);

  return true;
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

/** Build-only evaluation; no request identity, database, or host capabilities are supplied. */
export const resolveStaticInstances = async (
  resolvers: readonly {
    name: string;
    dataSchema: StandardSchemaV1;
    resolve: () => ViewInstance[] | Promise<ViewInstance[]>;
  }[]
): Promise<Record<string, ViewInstance[]>> => {
  const snapshots = await Promise.all(
    resolvers.map(async (resolver): Promise<[string, ViewInstance[]]> => {
      try {
        const entries = await validateInstanceResults(
          resolver.dataSchema,
          await resolver.resolve()
        );

        if (entries.length > 1000 || !isJsonValue(entries, new Set())) {
          throw new Error(
            "Static instances must contain at most 1000 entries with JSON-compatible data and metadata."
          );
        }

        return [resolver.name, entries];
      } catch (error) {
        throw new Error(
          `Unable to build static instances for ${resolver.name}`,
          { cause: error }
        );
      }
    })
  );

  return Object.fromEntries(snapshots);
};

/** Build-generated actions run through the existing authenticated action runtime. */
export const withInstanceResolvers = (
  app: AppDefinition,
  resolvers: readonly InstanceResolver[]
): AppDefinition => {
  if (Object.hasOwn(app.functions, "_patchsmith")) {
    throw new Error(
      "The _patchsmith function namespace is reserved by Patchsmith."
    );
  }

  const queries = registeredQueries(app.functions);
  const registry = new Map<string, Map<string, InstanceResolver>>();

  for (const resolver of resolvers) {
    v.parse(addressSchema, resolver);
    let paths = registry.get(resolver.slot);

    if (!paths) {
      paths = new Map();
      registry.set(resolver.slot, paths);
    }

    if (paths.has(resolver.path)) {
      throw new Error(
        `Duplicate instance resolver for slot "${resolver.slot}" and path "${resolver.path}".`
      );
    }

    paths.set(resolver.path, resolver);
  }

  const instances = {
    resolve: action({
      args: v.object({
        ...addressSchema.entries,
        context: v.record(v.string(), v.unknown()),
      }),
      functions: queries,
      handler: async ({ args, identity, signal, queries: queriesValue }) => {
        const resolver = registry.get(args.slot)?.get(args.path);

        if (!resolver) {
          throw new AppError("NOT_FOUND", "Instance resolver not found");
        }

        const value = await resolver.resolve({
          context: args.context,
          identity,
          queries: queriesValue,
          signal,
        });

        return await validateInstanceResults(resolver.dataSchema, value);
      },
    }),
  };

  return Object.freeze({
    functions: { ...app.functions, _patchsmith: defineRouter({ instances }) },
  });
};
