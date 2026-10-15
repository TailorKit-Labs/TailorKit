import { z } from "zod";

import { iconNamePattern, validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);
  return {
    children: false as const,
    fields: z.strictObject({
      label: z.string().min(1).max(256).optional(),
      name: z.string().max(100).regex(iconNamePattern),
      size: z.number().min(1).max(256).optional(),
      strokeWidth: z.number().min(0.5).max(4).optional(),
    }),
  };
};
