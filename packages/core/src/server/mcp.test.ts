import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { createTailorKitServer } from "./handler";
import { createServer } from "./contract";
import { defineContract } from "../schema/contract";

const scopes = { org: z.object({ tenant: z.string().min(1) }) };
function setup(
  options: { projectKey?: string; platformHeaders?: () => Promise<Record<string, string>> } = {
    projectKey: "host-key",
  },
) {
  const fetch = vi.fn();
  const server = createTailorKitServer({
    baseUrl: "https://host.test/api/tailorkit",
    projectKey: options.projectKey,
    scopes,
    components: {},
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform/",
      platformFetch: fetch,
      platformHeaders: options.platformHeaders,
    },
  });
  return { server, fetch };
}
function context(headers: Record<string, string>) {
  return JSON.parse(Buffer.from(headers["x-tailorkit-context"]!, "base64url").toString("utf8"));
}

describe("MCP transport configuration", () => {
  it("returns a direct platform URL and headers from scopes and optional subjectId", async () => {
    const { server, fetch } = setup();
    const transport = await server.mcp.transport({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
    });
    expect(transport.url).toBe("https://platform.test/api/platform/app-agent/mcp");
    expect(transport.headers.authorization).toBe("Bearer host-key");
    expect(context(transport.headers)).toEqual({
      scopes: { org: { tenant: "one" } },
      subjectId: "user-one",
      hostUrl: "https://host.test/api/tailorkit",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is exposed by createServer with the same object shape as authenticate returns", async () => {
    const server = createServer({
      contract: defineContract({ scopes, components: {} }),
      baseUrl: "https://host.test/api/tailorkit",
      projectKey: "host-key",
    });
    const result = await server.mcp.transport({ scopes: { org: { tenant: "one" } } });
    expect(result.url).toBe("https://tailorkit.dev/api/platform/app-agent/mcp");
    expect(context(result.headers)).not.toHaveProperty("subjectId");
  });

  it("does not expose a proxy handler or mount a host MCP route", async () => {
    const { server, fetch } = setup();
    expect(server.mcp).not.toHaveProperty("handler");
    const authenticate = vi.fn(() => ({ scopes: { org: { tenant: "one" } } }));
    const response = await server.handler(
      new Request("https://host.test/api/tailorkit/mcp", { method: "POST" }),
      { authenticate },
    );
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("validates caller scopes and subjects before returning any credentials", async () => {
    const { server } = setup();
    for (const value of [
      { scopes: {} },
      { scopes: { other: { tenant: "one" } } },
      { scopes: { org: { tenant: "" } } },
      { scopes: { org: { tenant: "one" } }, subjectId: "" },
      { scopes: { org: { tenant: "one" } }, subjectId: "x".repeat(257) },
    ])
      await expect(
        server.mcp.transport(value as { scopes: { org: { tenant: string } } }),
      ).rejects.toThrow();
  });

  it("encodes Unicode identities safely and isolates callers", async () => {
    const { server } = setup();
    const first = await server.mcp.transport({
      scopes: { org: { tenant: "墨尔本" } },
      subjectId: "用户",
    });
    const second = await server.mcp.transport({ scopes: { org: { tenant: "two" } } });
    expect(first.headers["x-tailorkit-context"]).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(context(first.headers)).toMatchObject({
      scopes: { org: { tenant: "墨尔本" } },
      subjectId: "用户",
    });
    expect(context(second.headers)).toMatchObject({ scopes: { org: { tenant: "two" } } });
  });

  it("resolves configured headers per call and requires a project credential", async () => {
    const headers = vi.fn(async () => ({ authorization: "Bearer custom-key" }));
    const { server } = setup({ platformHeaders: headers });
    expect(
      (await server.mcp.transport({ scopes: { org: { tenant: "one" } } })).headers.authorization,
    ).toBe("Bearer custom-key");
    expect(headers).toHaveBeenCalledOnce();
    const missing = setup({}).server;
    await expect(missing.mcp.transport({ scopes: { org: { tenant: "one" } } })).rejects.toThrow(
      "projectKey",
    );
  });

  it("bounds the context header before exposing it to a client", async () => {
    const large = createTailorKitServer({
      baseUrl: "https://host.test/api/tailorkit",
      projectKey: "host-key",
      components: {},
      scopes: { org: z.record(z.string(), z.string()) },
    });
    const tenant = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [String(i), "x".repeat(255)]),
    );
    await expect(large.mcp.transport({ scopes: { org: tenant } })).rejects.toThrow("header limit");
  });
});
