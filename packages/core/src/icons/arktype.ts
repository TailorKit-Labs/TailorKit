import { type } from "arktype";

import { iconNamePattern, validateIconOptions } from "./definition";
import type { IconOptions } from "./definition";

/** Define one icon component, registered under the name of your choice. */
export const Icon = (options: IconOptions) => {
  validateIconOptions(options);
  return {
    children: false as const,
    fields: type({
      "label?": "1 <= string <= 256",
      name: type("string <= 100").and(iconNamePattern),
      "size?": "1 <= number <= 256",
      "strokeWidth?": "0.5 <= number <= 4",
    }).onUndeclaredKey("reject"),
  };
};
