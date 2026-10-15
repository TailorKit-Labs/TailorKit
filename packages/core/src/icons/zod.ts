import { z } from "zod";

import { validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";
import { lucideIconNames } from "./lucide-names.generated";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);
  return {
    children: false as const,
    fields: z.strictObject({
      name: z.enum(lucideIconNames),
      size: z.number().min(1).max(256).optional(),
    }),
  };
};
