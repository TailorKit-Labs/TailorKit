import type { IconLibrary, IconName, IconProps, LucideIconName } from "./index";

const library = "lucide" satisfies IconLibrary;
const name = "arrow-right" satisfies IconName<typeof library>;
const lucideName: LucideIconName = name;

const typedProps = { name: lucideName, size: 16 } satisfies IconProps<
  typeof library
>;

const futureProps: IconProps = { name: "future-icon-from-a-newer-sdk" };

void typedProps;

void futureProps;

// @ts-expect-error Optional local suggestions catch misspellings.
const typo: IconName<typeof library> = "arrow-rigth";

void typo;

// @ts-expect-error The selected library controls the typed props' names.
const wrongProps: IconProps<typeof library> = { name: "arrow-rigth" };

void wrongProps;

// @ts-expect-error Each supported library needs its own name mapping.
declare const unsupportedName: IconName<"unknown">;

void unsupportedName;
