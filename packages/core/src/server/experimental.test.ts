import { createClient } from "@tailorkit/client-platform/client/client/index";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineContract } from "#schema/contract";

import { createServer } from "./contract";
import { createExperimental } from "./experimental";

const contract = defineContract({
  scopes: {
    day: z
      .object({ at: z.date() })
      .transform(({ at }) => ({ at: at.toISOString() })),
    org: z
      .object({ tenant: z.string().min(1) })
      .transform(({ tenant }) => ({ tenant: tenant.trim() })),
  },
});

it("installs from the public server API with host credentials and validated scope output", async () => {
  const requests: Request[] = [];
  const installed = {
    id: "installation",
    scope: { name: "org", value: { tenant: "workspace" } },
    shortId: "installed001",
  };
  const tailorkit = createServer({
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform",
      // oxlint-disable-next-line eslint/require-await -- The injected fetch returns an in-memory response without network I/O.
      platformFetch: async (input, init) => {
        requests.push(
          input instanceof Request ? input : new Request(input, init)
        );
        return Response.json(installed);
      },
    },
    baseUrl: "https://host.test/api/tailorkit",
    contract,
    projectKey: "project-secret",
  });
  await expect(
    tailorkit.experimental.installApp({
      appId: "published001",
      scope: { name: "org", value: { tenant: "  workspace  " } },
    })
  ).resolves.toEqual(installed);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (!request) {
    throw new Error("Expected installation request");
  }
  expect(request.url).toBe("https://platform.test/api/platform/apps/install");
  expect(request.method).toBe("POST");
  expect(request.headers.get("authorization")).toBe("Bearer project-secret");
  expect(await request.json()).toEqual({
    app: { shortId: "published001" },
    scope: installed.scope,
  });

  await tailorkit.experimental.installApp({
    appId: "published001",
    scope: { name: "day", value: { at: new Date("2026-10-16T00:00:00.000Z") } },
  });
  expect(await requests.at(-1)?.json()).toEqual({
    app: { shortId: "published001" },
    scope: { name: "day", value: { at: "2026-10-16T00:00:00.000Z" } },
  });
});

it("rejects invalid or undeclared scopes before sending a platform request", async () => {
  let requestCount = 0;
  const experimental = createExperimental({
    platform: createClient({
      // oxlint-disable-next-line eslint/require-await -- This injected transport records calls without network I/O.
      fetch: async () => {
        requestCount += 1;
        return Response.json({});
      },
    }),
    platformHeaders: { authorization: "Bearer secret" },
    scopeSchemas: contract.scopes,
  });
  await expect(
    experimental.installApp({
      appId: "app",
      scope: { name: "org", value: { tenant: "" } },
    })
  ).rejects.toThrow("Standard Schema");
  await expect(
    experimental.installApp({
      appId: "app",
      scope: { name: "missing", value: { tenant: "workspace" } },
    })
  ).rejects.toThrow("undeclared scope");
  await expect(
    experimental.installApp({
      appId: "",
      scope: { name: "org", value: { tenant: "workspace" } },
    })
  ).rejects.toThrow("app ID");
  expect(requestCount).toBe(0);
});

it("requires host credentials and propagates platform installation errors", async () => {
  const server = createServer({
    $internal: {
      // oxlint-disable-next-line eslint/require-await -- The injected fetch returns an in-memory error response without network I/O.
      platformFetch: async () =>
        Response.json(
          { code: "NOT_FOUND", message: "No published app" },
          { status: 404 }
        ),
    },
    baseUrl: "https://host.test/api/tailorkit",
    contract,
  });
  const input = {
    appId: "app",
    scope: { name: "org" as const, value: { tenant: "workspace" } },
  };
  await expect(server.experimental.installApp(input)).rejects.toThrow(
    "projectKey"
  );
  const authorized = createServer({
    $internal: {
      // oxlint-disable-next-line eslint/require-await -- The injected fetch returns an in-memory error response without network I/O.
      platformFetch: async () =>
        Response.json(
          { code: "NOT_FOUND", message: "No published app" },
          { status: 404 }
        ),
    },
    baseUrl: "https://host.test/api/tailorkit",
    contract,
    projectKey: "secret",
  });
  await expect(authorized.experimental.installApp(input)).rejects.toMatchObject(
    { code: "NOT_FOUND" }
  );
});
