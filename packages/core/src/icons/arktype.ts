import { type } from "arktype";

import { validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";
import { lucideIconNames } from "./lucide-names.generated";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);

  return {
    children: false as const,
    fields: type({
      name: type.enumerated(...lucideIconNames),
      "size?": "1 <= number <= 256",
    }).onUndeclaredKey("reject"),
  };
};
