import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { defineContract } from "#schema/contract";

import { createServer } from "./contract";
import { createTailorKitServer } from "./handler";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const scopes = { org: z.object({ tenant: z.string().min(1) }) };
const defaultSetupOptions = { projectKey: "host-key" };
const setup = (
  options: {
    projectKey?: string;
    platformHeaders?: () => Promise<Record<string, string>>;
  } = defaultSetupOptions
) => {
  const fetch = vi.fn();
  const server = createTailorKitServer({
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform/",
      platformFetch: fetch,
      platformHeaders: options.platformHeaders,
    },
    baseUrl: "https://host.test/api/tailorkit",
    components: {},
    projectKey: options.projectKey,
    scopes,
  });
  return { fetch, server };
};
const contextSchema = z.object({
  hostUrl: z.string(),
  scopes: z.record(z.string(), z.json()),
  subjectId: z.string(),
});
const context = (headers: Record<string, string>) =>
  contextSchema.parse(
    JSON.parse(
      Buffer.from(
        requireValue(headers["x-tailorkit-context"]),
        "base64url"
      ).toString("utf-8")
    )
  );

describe("MCP transport configuration", () => {
  it("returns a direct platform URL and headers from scopes and the authenticated subject", async () => {
    const { server, fetch } = setup();
    const transport = await server.mcp.transport({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    });
    expect(transport.url).toBe(
      "https://platform.test/api/platform/app-agent/mcp"
    );
    expect(transport.headers.authorization).toBe("Bearer host-key");
    expect(context(transport.headers)).toEqual({
      hostUrl: "https://host.test/api/tailorkit",
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is exposed by createServer with the same object shape as authenticate returns", async () => {
    const server = createServer({
      baseUrl: "https://host.test/api/tailorkit",
      contract: defineContract({ components: {}, scopes }),
      projectKey: "host-key",
    });
    const result = await server.mcp.transport({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    });
    expect(result.url).toBe("https://tailorkit.dev/api/platform/app-agent/mcp");
    expect(context(result.headers).subjectId).toBe("user-one");
  });

  it("does not expose a proxy handler or mount a host MCP route", async () => {
    const { server, fetch } = setup();
    expect(server.mcp).not.toHaveProperty("handler");
    const authenticate = vi.fn(() => ({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    }));
    const response = await server.handler(
      new Request("https://host.test/api/tailorkit/mcp", { method: "POST" }),
      { authenticate }
    );
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("validates caller scopes and subjects before returning any credentials", async () => {
    const { server } = setup();
    await Promise.all(
      [
        { scopes: {}, subjectId: "user-one" },
        { scopes: { other: { tenant: "one" } }, subjectId: "user-one" },
        { scopes: { org: { tenant: "" } }, subjectId: "user-one" },
        { scopes: { org: { tenant: "one" } } },
        { scopes: { org: { tenant: "one" } }, subjectId: null },
        { scopes: { org: { tenant: "one" } }, subjectId: 123 },
        { scopes: { org: { tenant: "one" } }, subjectId: "" },
        { scopes: { org: { tenant: "one" } }, subjectId: "x".repeat(257) },
      ].map(async (value) => {
        await expect(
          // @ts-expect-error Exercise malformed contexts supplied by untyped host integrations.
          server.mcp.transport(value)
        ).rejects.toThrow();
      })
    );
  });

  it("encodes Unicode identities safely and isolates callers", async () => {
    const { server } = setup();
    const first = await server.mcp.transport({
      scopes: { org: { tenant: "墨尔本" } },
      subjectId: "用户",
    });
    const second = await server.mcp.transport({
      scopes: { org: { tenant: "two" } },
      subjectId: "user-two",
    });
    expect(first.headers["x-tailorkit-context"]).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(context(first.headers)).toMatchObject({
      scopes: { org: { tenant: "墨尔本" } },
      subjectId: "用户",
    });
    expect(context(second.headers)).toMatchObject({
      scopes: { org: { tenant: "two" } },
      subjectId: "user-two",
    });
  });

  it("resolves configured headers per call and requires a project credential", async () => {
    const headers = vi
      .fn<() => Promise<{ authorization: string }>>()
      .mockResolvedValue({ authorization: "Bearer custom-key" });
    const { server } = setup({ platformHeaders: headers });
    const awaitedResult1 = await server.mcp.transport({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    });
    expect(awaitedResult1.headers.authorization).toBe("Bearer custom-key");
    expect(headers).toHaveBeenCalledOnce();
    const missing = setup({}).server;
    await expect(
      missing.mcp.transport({
        scopes: { org: { tenant: "one" } },
        subjectId: "user-one",
      })
    ).rejects.toThrow("projectKey");
  });

  it("bounds the context header before exposing it to a client", async () => {
    const large = createTailorKitServer({
      baseUrl: "https://host.test/api/tailorkit",
      components: {},
      projectKey: "host-key",
      scopes: { org: z.record(z.string(), z.string()) },
    });
    const tenant = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [String(i), "x".repeat(255)])
    );
    await expect(
      large.mcp.transport({ scopes: { org: tenant }, subjectId: "user-one" })
    ).rejects.toThrow("header limit");
  });
});
