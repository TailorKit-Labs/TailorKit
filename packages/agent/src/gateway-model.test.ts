import { describe, expect, it, vi } from "vite-plus/test";

import { createGatewayModelProviders } from "./gateway-model";

const model = {
  context_window: 1_050_000,
  id: "openai/gpt-6.1-sol",
  max_tokens: 128_000,
  modalities: { input: ["text", "image", "pdf"] },
  name: "GPT-6.1 Sol",
  pricing: { input: "0.000001", output: "0.000005" },
  tags: ["reasoning"],
};

describe("Gateway model metadata", () => {
  it("reuses metadata across checkpoints and refreshes with current credentials after expiry", async () => {
    let now = 0;
    const fetchCatalog = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [model] }))
      .mockResolvedValueOnce(Response.json({ data: [model] }));
    const providers = createGatewayModelProviders({
      fetchCatalog,
      now: () => now,
    });
    const first = await providers(model.id, { AI_GATEWAY_API_KEY: "first" });
    expect(first).toMatchObject({
      "vercel-ai-gateway": {
        api: "openai-responses",
        baseUrl: "https://ai-gateway.vercel.sh/v1",
        models: [
          {
            contextWindow: model.context_window,
            cost: { input: 1, output: 5 },
            id: model.id,
            input: ["text", "image"],
            reasoning: true,
          },
        ],
      },
    });
    now = 5 * 60_000 - 1;
    expect(await providers(model.id, { VERCEL_OIDC_TOKEN: "rotated" })).toEqual(
      first
    );
    expect(fetchCatalog).toHaveBeenCalledOnce();
    now += 1;
    await providers(model.id, { VERCEL_OIDC_TOKEN: "rotated" });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(fetchCatalog).toHaveBeenLastCalledWith(
      "https://ai-gateway.vercel.sh/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer rotated" },
      })
    );
    expect(JSON.stringify(first)).not.toContain("first");
    expect(JSON.stringify(first)).not.toContain("rotated");
  });

  it("separates models and Gateway endpoints while normalizing trailing slashes", async () => {
    const other = { ...model, id: "anthropic/test-model" };
    const fetchCatalog = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [model, other] }))
      .mockResolvedValueOnce(Response.json({ data: [model, other] }))
      .mockResolvedValueOnce(Response.json({ data: [model, other] }));
    const providers = createGatewayModelProviders({
      fetchCatalog,
      now: () => 0,
    });
    const auth = {
      AI_GATEWAY_API_KEY: "test-key",
      AI_GATEWAY_BASE_URL: "https://gateway.test/",
    };
    await providers(model.id, auth);
    await providers(model.id, {
      ...auth,
      AI_GATEWAY_BASE_URL: "https://gateway.test",
    });
    expect(fetchCatalog).toHaveBeenCalledOnce();
    expect(await providers(other.id, auth)).toMatchObject({
      "vercel-ai-gateway": {
        api: "anthropic-messages",
        baseUrl: "https://gateway.test",
        models: [{ id: other.id }],
      },
    });
    await providers(model.id, {
      ...auth,
      AI_GATEWAY_BASE_URL: "https://other-gateway.test",
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("retries failed or invalid catalog loads without caching the failure", async () => {
    const fetchCatalog = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ ...model, max_tokens: 0 }] })
      )
      .mockResolvedValueOnce(Response.json({ data: [model] }));
    const providers = createGatewayModelProviders({
      fetchCatalog,
      now: () => 0,
    });
    const auth = { AI_GATEWAY_API_KEY: "test-key" };
    await expect(providers(model.id, auth)).rejects.toThrow("503");
    await expect(providers(model.id, auth)).rejects.toThrow("has no model");
    await expect(providers(model.id, auth)).rejects.toThrow();
    await expect(providers(model.id, auth)).resolves.toHaveProperty(
      "vercel-ai-gateway"
    );
    expect(fetchCatalog).toHaveBeenCalledTimes(4);
  });

  it("leaves direct-provider authentication alone", async () => {
    const fetchCatalog = vi.fn<typeof fetch>();
    const providers = createGatewayModelProviders({
      fetchCatalog,
      now: () => 0,
    });
    expect(await providers(model.id, { OPENAI_API_KEY: "direct" })).toEqual({});
    expect(fetchCatalog).not.toHaveBeenCalled();
  });
});
