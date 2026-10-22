import { z } from "zod";

import { validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);

  return {
    children: false as const,
    fields: z.strictObject({
      name: z.string(),
      size: z.number().min(1).max(256).optional(),
    }),
  };
};
