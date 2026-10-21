import { defineServer, isFunction, validateFunctionName } from "./functions";
import type { Functions, RegisteredFunction } from "./functions";

interface FunctionModule {
  filename: string;
  path: readonly string[];
  functions: Functions;
}

interface MutableFunctions {
  [name: string]: RegisteredFunction | MutableFunctions;
}

/** Merge the builder's discovered modules. Shared namespaces may contain distinct functions.
 * @internal
 */
export const createFileServer = (modules: readonly FunctionModule[]) => {
  const functions: MutableFunctions = {};
  Object.setPrototypeOf(functions, null);
  const sources = new Map<string, string>();

  const merge = (
    target: MutableFunctions,
    source: Functions,
    prefix: string,
    filename: string
  ) => {
    for (const [name, value] of Object.entries(source)) {
      validateFunctionName(name);
      const path = prefix ? `${prefix}.${name}` : name;
      const existing = target[name];

      if (existing && (isFunction(existing) || isFunction(value))) {
        const conflict =
          isFunction(existing) && isFunction(value)
            ? "Duplicate function"
            : "Function/namespace conflict";

        throw new Error(
          `${conflict}: api.${path}\n\n  ${sources.get(path)}\n  ${filename}`
        );
      }

      if (isFunction(value)) {
        target[name] = value;
      } else {
        const nested: MutableFunctions = existing ?? {};
        Object.setPrototypeOf(nested, null);
        target[name] = nested;
        merge(nested, value, path, filename);
      }

      if (!sources.has(path)) {
        sources.set(path, filename);
      }
    }
  };

  for (const module of modules) {
    if (
      module.functions === null ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Generated imports are an I/O boundary; reject malformed default exports before reading router keys.
      typeof module.functions !== "object" ||
      Array.isArray(module.functions) ||
      isFunction(module.functions)
    ) {
      throw new Error(
        `${module.filename} must default-export defineRouter(...).`
      );
    }

    let source = module.functions;

    for (const name of module.path.toReversed()) {
      validateFunctionName(name);
      source = { [name]: source };
    }

    try {
      merge(functions, source, "", module.filename);
    } catch (error) {
      throw new Error(
        `${module.filename}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  return defineServer(functions);
};
