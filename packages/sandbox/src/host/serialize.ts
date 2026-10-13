export const readElementProps = (element: Element): Record<string, unknown> => {
  const canonicalPropNames: Readonly<Record<string, string>> = {
    bordercolor: "borderColor",
    minheight: "minHeight",
    minwidth: "minWidth",
    textcolor: "textColor",
  };
  const callbackAttribute = "data-tailorkit-callbacks";
  const propsAttribute = "data-tailorkit-props";
  const typedProps = element.getAttribute(propsAttribute);
  if (typedProps !== null) {
    try {
      const value = JSON.parse(typedProps) as unknown;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Fall through to the DOM attributes when the internal channel is malformed.
    }
  }

  const props: Record<string, unknown> = {};
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    if (name === callbackAttribute || name === propsAttribute) {
      continue;
    }
    props[canonicalPropNames[name] ?? attribute.name] = attribute.value;
  }
  return props;
};
