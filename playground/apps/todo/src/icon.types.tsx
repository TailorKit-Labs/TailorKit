import { Icon } from "#patchsmith";

// Compile-only checks against the actual generated app bindings.
<Icon name="arrow-right" />;

<Icon name="circle-check" size={16} />;

// @ts-expect-error Icon names come from the pinned Lucide catalogue.
<Icon name="arrow-rigth" />;

// @ts-expect-error An icon name is required.
<Icon />;

// @ts-expect-error Icon props do not expose strokeWidth.
<Icon name="arrow-right" strokeWidth={1} />;

// @ts-expect-error Icon props do not expose label.
<Icon name="arrow-right" label="Continue" />;
