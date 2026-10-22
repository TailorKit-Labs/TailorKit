import type { IconName, IconProps, LucideIconName } from "patchsmith";

import { Icon } from "#patchsmith";

// Compile-only checks against the actual generated app bindings.
<Icon name="arrow-right" />;

<Icon name="circle-check" size={16} />;

// Older generated bindings accept names introduced by a newer SDK or catalogue.
<Icon name="future-lucide-icon-from-newer-sdk" />;

const library = "lucide";
const name = "arrow-right" satisfies IconName<typeof library>;
const props = { name, size: 16 } satisfies IconProps<typeof library>;

<Icon {...props} />;

// @ts-expect-error Apps can opt into locally known Lucide names.
const typo = "arrow-rigth" satisfies LucideIconName;

void typo;

// @ts-expect-error An icon name is required.
<Icon />;

// @ts-expect-error Icon props do not expose strokeWidth.
<Icon name="arrow-right" strokeWidth={1} />;

// @ts-expect-error Icon props do not expose label.
<Icon name="arrow-right" label="Continue" />;
