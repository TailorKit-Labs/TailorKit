import * as v from "valibot";

import { validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);

  return {
    children: false as const,
    fields: v.strictObject({
      name: v.string(),
      size: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(256))),
    }),
  };
};
