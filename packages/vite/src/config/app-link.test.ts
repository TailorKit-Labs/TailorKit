import { expect, it } from "vite-plus/test";

import { setConfigAppId } from "./app-link";

it.each([
  {
    expected: 'export default { appId: "authorized", name: "My App" };\n',
    source: 'export default { name: "My App" };\n',
  },
  {
    expected:
      'export default defineTailorKitConfig({ appId: "authorized", name: "My App" });\n',
    source:
      'export default defineTailorKitConfig({ "appId": "stale", name: "My App" });\n',
  },
  {
    expected:
      'export default ({ appId: "authorized", name: "My App" } as const) satisfies Config;\n',
    source:
      'export default ({ appId: undefined, name: "My App" } as const) satisfies Config;\n',
  },
  {
    expected:
      'const other = { appId: "unrelated" };\nconst config = {\n  appId: "authorized",\n  // Keep this comment.\n  name: "My App",\n} satisfies Config;\nexport default config;\n',
    source:
      'const other = { appId: "unrelated" };\nconst config = {\n  // Keep this comment.\n  name: "My App",\n} satisfies Config;\nexport default config;\n',
  },
  {
    expected:
      'export default {\r\n\tappId: "authorized",\r\n\tname: "My App",\r\n};\r\n',
    source: 'export default {\r\n\tname: "My App",\r\n};\r\n',
  },
])(
  "preserves config source while linking $source",
  async ({ expected, source }) => {
    const linked = await setConfigAppId(
      source,
      "authorized",
      "tailorkit.config.ts"
    );
    expect(linked).toBe(expected);
    expect(
      await setConfigAppId(linked, "authorized", "tailorkit.config.ts")
    ).toBe(linked);
  }
);

it.each([
  "export default getConfig();\n",
  "export default missingConfig;\n",
  "export const config = {};\n",
])(
  "rejects config expressions that cannot be linked statically: %s",
  async (source) => {
    await expect(
      setConfigAppId(source, "authorized", "tailorkit.config.ts")
    ).rejects.toThrow('Add appId: "authorized" manually.');
  }
);
