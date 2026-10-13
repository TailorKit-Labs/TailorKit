import type { z } from "zod";

import type { FunctionResult, Functions } from "../server/functions";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

export interface Reference<K extends "query" | "mutation" | "action", I, O> {
  readonly name: string;
  readonly $types?: { kind: K; input: I; output: O };
}
export const reference = <K extends "query" | "mutation" | "action", I, O>(
  name: string,
  _kind: K
): Reference<K, I, O> => Object.freeze({ name });
export type References<F> = {
  readonly [N in keyof F]: F[N] extends {
    kind: infer K extends "query" | "mutation" | "action";
    args: infer A extends z.ZodType;
    handler: (...args: never[]) => infer _Output;
  }
    ? Reference<K, z.input<A>, FunctionResult<F[N]>>
    : F[N] extends Functions
      ? References<F[N]>
      : never;
};

/** Browser references inferred directly from the server's exported function type. */
export const createApi = <F extends Functions>(): References<F> => {
  // SAFETY: The proxy synthesizes every declared reference from its property path; its empty target is never used as an implemented reference.
  const group = (path: string): References<F> =>
    new Proxy(Object.create(null) as References<F>, {
      get(_target, name) {
        if (!isStringValue(name) || name === "then") {
          return;
        }
        if (name === "name" && path) {
          return path;
        }
        return group(path ? `${path}.${name}` : name);
      },
    });
  return group("");
};
