import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const registryKey = Symbol.for("@workflow/core//registeredSteps");
const sampleSchema = z.object({
  coldMs: z.number(),
  importMs: z.number(),
  warmMs: z.number(),
  workflowLoadedAtStartup: z.boolean(),
});
type Sample = z.infer<typeof sampleSchema>;
const applicationSchema = z.object({
  default: z.object({
    fetch: z.function({
      input: [z.instanceof(Request)],
      output: z.promise(z.instanceof(Response)),
    }),
  }),
});
// SAFETY: Workflow owns this symbol and stores its registered step functions
// in a Map. The smoke check below verifies that registration still runs.
const registry = globalThis as typeof globalThis & {
  [registryKey]?: Map<string, unknown>;
};
const registeredSteps = (): string[] => [
  ...(registry[registryKey]?.keys() ?? []),
];
const request = () =>
  new Request("https://fixture.test/api/platform/app-agent/mcp", {
    method: "POST",
  });
const { resolve } = nodePath;
const script = import.meta.filename;
const [mode, entryArgument] = process.argv.slice(2);

if (mode === "--sample") {
  assert.ok(entryArgument);
  const { default: app } = applicationSchema.parse(
    await import(pathToFileURL(entryArgument).href)
  );
  const imported = performance.now();
  const workflowLoadedAtStartup = registeredSteps().some((key) =>
    key.endsWith("//agentStep")
  );
  const response = await app.fetch(request());
  assert.equal(response.status, 401);
  const coldMs = performance.now();
  const warmStarted = performance.now();
  const warmResponse = await app.fetch(request());
  assert.equal(warmResponse.status, 401);
  const warmMs = performance.now() - warmStarted;
  assert.equal(
    registeredSteps().some((key) => key.endsWith("//agentStep")),
    workflowLoadedAtStartup
  );

  // Exercise the lazy callback boundary without starting a workflow or making
  // authenticated requests. An invalid callback must still register its steps.
  await app.fetch(
    new Request("https://fixture.test/.well-known/workflow/v1/flow", {
      method: "GET",
    })
  );
  assert.ok(registeredSteps().some((key) => key.endsWith("//agentStep")));
  console.log(
    JSON.stringify({
      coldMs,
      importMs: imported,
      warmMs,
      workflowLoadedAtStartup,
    })
  );
} else {
  const entry = resolve(
    mode ??
      "apps/web/.vercel/output/functions/api/platform/app-agent/mcp.func/index.mjs"
  );
  const samples: Sample[] = [];
  for (let index = 0; index < 5; index += 1) {
    // Fixtures only: do not inherit credentials or connect to real services.
    const stdout = execFileSync(process.execPath, [script, "--sample", entry], {
      cwd: tmpdir(),
      env: {
        AUTH_SECRET: "fixture-secret-for-startup-benchmark-only",
        BLOB_ACCESS_KEY_ID: "fixture",
        BLOB_BUCKET: "fixture",
        BLOB_ENDPOINT: "https://storage.test",
        BLOB_REGION: "us-east-1",
        BLOB_SECRET_ACCESS_KEY: "fixture",
        DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
        NODE_ENV: "production",
        TAILORKIT_OTEL_DISABLED: "true",
      },
      timeout: 15_000,
    });
    samples.push(sampleSchema.parse(JSON.parse(stdout.toString())));
  }
  const cold = samples.map((sample) => sample.coldMs).toSorted((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        entryBytes: statSync(entry).size,
        coldMedianMs: Math.round(cold[2]),
        coldMaxMs: Math.round(cold[4]),
        samples,
      },
      null,
      2
    )
  );
  // This checks emitted behavior, not just the source configuration.
  if (entryArgument !== "--allow-eager") {
    assert.equal(
      samples.some((sample) => sample.workflowLoadedAtStartup),
      false
    );
    assert.ok(!readFileSync(entry, "utf-8").includes("pi-coding-agent"));
  }
}
