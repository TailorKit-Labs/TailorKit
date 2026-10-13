import * as v from "valibot";

import { RemotePropsSchema } from "#protocol";
import type { RemoteProps } from "#protocol";

export const readElementProps = (element: Element): RemoteProps => {
  const canonicalPropNames = new Map<string, string>([
    ["bordercolor", "borderColor"],
    ["minheight", "minHeight"],
    ["minwidth", "minWidth"],
    ["textcolor", "textColor"],
  ]);

  const callbackAttribute = "data-tailorkit-callbacks";
  const propsAttribute = "data-tailorkit-props";
  const typedProps = element.getAttribute(propsAttribute);
  if (typedProps !== null) {
    try {
      const parsed = v.safeParse(RemotePropsSchema, JSON.parse(typedProps));
      if (parsed.success) {
        return parsed.output;
      }
    } catch {
      // Fall through to the DOM attributes when the internal channel is malformed.
    }
  }

  const props: RemoteProps = {};
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    if (name === callbackAttribute || name === propsAttribute) {
      continue;
    }
    props[canonicalPropNames.get(name) ?? attribute.name] = attribute.value;
  }
  return props;
};
