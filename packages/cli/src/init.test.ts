import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as clackpromptsModule from "@clack/prompts";
import { select } from "@clack/prompts";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { readInitInstallEnvironment } from "#env";

import type * as generatorModule from "./generator";
import { runInit } from "./init";

vi.mock("./generator", async (importOriginal) => ({
  ...(await importOriginal<typeof generatorModule>()),
  resolveTemplatePackageVersions: vi.fn().mockResolvedValue({
    preact: "11.0.0",
    tailorkit: "0.1.0-beta.16",
    typescript: "6.0.3",
    vite: "8.0.0",
    vitePlus: "1.0.0",
  }),
}));
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof clackpromptsModule>()),

  select: vi.fn<() => Promise<string>>().mockResolvedValue("vite-plus"),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

const initOptions = async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-init-"));
  directories.push(cwd);
  return {
    cwd,
    host: "https://host.test/api/tailorkit",
    install: false,
    name: "example",
    packageManager: "pnpm",
    tooling: "vite" as const,
  };
};

it.each([undefined, 120])(
  "inherits release age from pnpm's environment unless overridden by %s",
  async (minimumReleaseAge) => {
    vi.stubEnv("PNPM_CONFIG_MINIMUM_RELEASE_AGE", "0");
    const options = await initOptions();
    await writeFile(
      path.join(options.cwd, "schema.json"),
      JSON.stringify({
        components: {},
        slots: { page: { views: ["/"] } },
        version: 1,
        views: { "/": { context: { type: "object" } } },
      })
    );
    const directory = await runInit({
      ...options,
      minimumReleaseAge,
      schemaPath: "schema.json",
    });
    expect(
      await readFile(path.join(directory, "pnpm-workspace.yaml"), "utf-8")
    ).toContain(`minimumReleaseAge: ${minimumReleaseAge ?? 0}`);
  }
);

it.each([-1, Number.NaN, 0.5])(
  "rejects invalid release age %s before creating an app",
  async (minimumReleaseAge) => {
    const options = await initOptions();
    await expect(runInit({ ...options, minimumReleaseAge })).rejects.toThrow(
      "non-negative integer"
    );
    await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
  }
);

it.each([
  { inherited: undefined, minimumReleaseAge: undefined, selected: undefined },
  { inherited: "0", minimumReleaseAge: 120, selected: "120" },
  { inherited: "120", minimumReleaseAge: 0, selected: "0" },
  { inherited: "120", minimumReleaseAge: undefined, selected: "120" },
])(
  "passes release age $selected to pnpm install with CLI value $minimumReleaseAge and inherited value $inherited",
  async ({ inherited, minimumReleaseAge, selected }) => {
    const options = await initOptions();
    const bin = path.join(options.cwd, "bin");
    await mkdir(bin);
    await writeFile(
      path.join(bin, "pnpm"),
      `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync("install-environment.json", JSON.stringify({
  inherited: process.env.TAILORKIT_INIT_TEST_VALUE,
  minimumReleaseAge: process.env.PNPM_CONFIG_MINIMUM_RELEASE_AGE,
}));
`,
      { mode: 0o755 }
    );
    const { PATH: inheritedPath } = readInitInstallEnvironment();
    vi.stubEnv("PATH", `${bin}${path.delimiter}${inheritedPath ?? ""}`);
    vi.stubEnv("PNPM_CONFIG_MINIMUM_RELEASE_AGE", inherited);
    vi.stubEnv("TAILORKIT_INIT_TEST_VALUE", "preserved");
    await writeFile(
      path.join(options.cwd, "schema.json"),
      JSON.stringify({
        components: {},
        slots: { page: { views: ["/"] } },
        version: 1,
        views: { "/": { context: { type: "object" } } },
      })
    );
    const directory = await runInit({
      ...options,
      install: true,
      minimumReleaseAge,
      schemaPath: "schema.json",
    });
    const installed = z
      .object({
        inherited: z.string(),
        minimumReleaseAge: z.string().optional(),
      })
      .parse(
        JSON.parse(
          await readFile(
            path.join(directory, "install-environment.json"),
            "utf-8"
          )
        )
      );
    expect(installed.inherited).toBe("preserved");
    expect(installed.minimumReleaseAge).toBe(selected);
    expect(readInitInstallEnvironment().PNPM_CONFIG_MINIMUM_RELEASE_AGE).toBe(
      inherited
    );
  }
);

it("fetches the host schema and generates real bindings even when installation is skipped", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
    Response.json({
      components: { Box: { callbacks: {}, children: true } },
      slots: { sidebar: { views: ["/people"] } },
      version: 1,
      views: {
        "/people": {
          context: {
            properties: { customer: { type: "string" } },
            type: "object",
          },
        },
      },
    })
  );
  vi.stubGlobal("fetch", fetch);
  const directory = await runInit(await initOptions());
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://host.test/api/tailorkit/schema",
    {
      signal: undefined,
    }
  );
  const bindings = await readFile(
    path.join(directory, "src/tailorkit.gen.ts"),
    "utf-8"
  );
  expect(bindings).toContain(
    '"sidebar": { views: "/people"; multiple: false }'
  );
  expect(bindings).toContain("customer?: string");
  expect(bindings).not.toContain("Card");
  expect(
    await readFile(
      path.join(directory, "src/slots/sidebar/people.view.tsx"),
      "utf-8"
    )
  ).toContain("<Box>");
  expect(
    await readFile(path.join(directory, "src/root.tsx"), "utf-8")
  ).toContain("shellComponent: Shell");
});

it("reports schema fetch failures without creating a project", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response("Unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      })
    )
  );
  const options = await initOptions();
  await expect(runInit(options)).rejects.toThrow(
    "Unable to fetch TailorKit schema"
  );
  await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
});

it("scaffolds and regenerates from a schema file while the local host is unreachable", async () => {
  const options = {
    ...(await initOptions()),
    host: "http://localhost:3000/api/tailorkit",
    schemaPath: "schema.json",
  };
  const schema = {
    components: { Box: { callbacks: {}, children: true } },
    slots: { sidebar: { views: ["/local"] } },
    tools: {},
    version: 1,
    views: {
      "/local": {
        context: { properties: { name: { type: "string" } }, type: "object" },
      },
    },
  };
  await writeFile(
    path.join(options.cwd, "schema.json"),
    JSON.stringify(schema)
  );
  const fetch = vi.fn(() => {
    throw new Error("Host is unreachable");
  });
  vi.stubGlobal("fetch", fetch);
  const directory = await runInit(options);
  const generated = path.join(directory, "src/tailorkit.gen.ts");
  const initial = await readFile(generated, "utf-8");
  expect(initial).toContain('"sidebar": { views: "/local"; multiple: false }');
  expect(initial).toContain("name?: string");
  expect(
    await readFile(path.join(directory, "tailorkit.config.ts"), "utf-8")
  ).toContain(options.host);
  await rm(generated);
  const { generateTypes } = await import("./generator/types");
  await generateTypes({ cwd: directory, schemaPath: "../schema.json" });
  expect(await readFile(generated, "utf-8")).toBe(initial);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["{", "null", "{}", '{"version":2,"components":{}}'])(
  "rejects invalid schema file %s without fetching or creating a project",
  async (content) => {
    const options = { ...(await initOptions()), schemaPath: "schema.json" };
    await writeFile(path.join(options.cwd, "schema.json"), content);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(runInit(options)).rejects.toThrow(
      "Unable to read TailorKit schema"
    );
    expect(fetch).not.toHaveBeenCalled();
    await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
  }
);

it("recommends Vite+ and offers build-only Vite in one tooling prompt", async () => {
  const options = await initOptions();
  await writeFile(
    path.join(options.cwd, "schema.json"),
    JSON.stringify({
      components: {},
      slots: { page: { views: ["/"] } },
      tools: {},
      version: 1,
      views: { "/": { context: { type: "object" } } },
    })
  );
  const directory = await runInit({
    ...options,
    schemaPath: "schema.json",
    tooling: undefined,
  });
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      initialValue: "vite-plus",
      options: [
        expect.objectContaining({
          label: "Vite+ (recommended)",
          value: "vite-plus",
        }),
        expect.objectContaining({ label: "Vite (build only)", value: "vite" }),
      ],
    })
  );
  const pkg = z
    .object({
      devDependencies: z.record(z.string(), z.string()),
      scripts: z.record(z.string(), z.string()),
    })
    .parse(
      JSON.parse(await readFile(path.join(directory, "package.json"), "utf-8"))
    );
  expect(pkg.scripts.build).toBe("vp build");
  expect(pkg.scripts.check).toBe("vp check");
});

it("rejects unsupported tooling before creating the app", async () => {
  const options = await initOptions();
  await expect(runInit({ ...options, tooling: "other" })).rejects.toThrow(
    "--tooling must be"
  );
  await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
});
