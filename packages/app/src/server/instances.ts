import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";

import { AppError } from "#errors";
import type { ViewDataFields } from "#views";

import { action, defineServer, isFunction } from "./functions";
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

        const result = v.safeParse(instanceResults, value);

        if (!result.success) {
          throw new AppError(
            "INTERNAL_SERVER_ERROR",
            "Invalid function result"
          );
        }

        return await Promise.all(
          result.output.map(async (item) => {
            const parsed = await resolver.dataSchema["~standard"].validate(
              item.data
            );

            if (parsed.issues) {
              throw new AppError(
                "INTERNAL_SERVER_ERROR",
                "Invalid function result"
              );
            }

            return { ...item, data: parsed.value };
          })
        );
      },
    }),
  };

  const internal = defineServer({ instances });

  return Object.freeze({
    functions: { ...app.functions, _patchsmith: internal.functions },
  });
};
