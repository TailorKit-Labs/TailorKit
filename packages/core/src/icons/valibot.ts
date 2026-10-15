import * as v from "valibot";

import { iconNamePattern, validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);
  return {
    children: false as const,
    fields: v.strictObject({
      label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
      name: v.pipe(v.string(), v.maxLength(100), v.regex(iconNamePattern)),
      size: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(256))),
      strokeWidth: v.optional(
        v.pipe(v.number(), v.minValue(0.5), v.maxValue(4))
      ),
    }),
  };
};
