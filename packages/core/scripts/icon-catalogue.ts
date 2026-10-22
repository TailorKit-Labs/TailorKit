import * as v from "valibot";

import {
  iconCatalogueVersion,
  iconNamePattern,
  maxIconNameLength,
  parseIconData,
} from "#icons/definition";
import type { IconData } from "#icons/definition";

export const iconCatalogueSchema = v.strictObject({
  icons: v.record(
    v.pipe(
      v.string(),
      v.maxLength(maxIconNameLength),
      v.regex(iconNamePattern)
    ),
    v.pipe(v.unknown(), v.transform(parseIconData))
  ),
  library: v.literal("lucide"),
  licenses: v.record(v.string(), v.string()),
  version: v.literal(iconCatalogueVersion),
});

export type IconCatalogue = v.InferOutput<typeof iconCatalogueSchema>;

interface IconRelease {
  icons: Record<string, IconData>;
  license: string;
  version: string;
}

/** A v1 name permanently identifies its first published geometry. */
export const extendIconCatalogue = (
  catalogue: IconCatalogue,
  release: IconRelease
): IconCatalogue => {
  const icons = { ...catalogue.icons };

  for (const [name, icon] of Object.entries(release.icons)) {
    if (!Object.hasOwn(icons, name)) {
      icons[name] = parseIconData(icon);
    }
  }

  return {
    ...catalogue,
    icons,
    licenses: { ...catalogue.licenses, [release.version]: release.license },
  };
};
