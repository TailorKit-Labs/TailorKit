import type { HarnessV1AuthenticationEnvironment } from "@ai-sdk/harness";
import type { PiHarnessSettings } from "@ai-sdk/harness-pi";
import { z } from "zod";

const gatewayModelSchema = z.object({
  context_window: z.number().int().positive(),
  id: z.string(),
  max_tokens: z.number().int().positive(),
  modalities: z.object({ input: z.array(z.string()) }),
  name: z.string(),
  pricing: z.object({
    input: z.coerce.number().nonnegative(),
    input_cache_read: z.coerce.number().nonnegative().optional(),
    input_cache_write: z.coerce.number().nonnegative().optional(),
    output: z.coerce.number().nonnegative(),
  }),
  tags: z.array(z.string()),
});

type GatewayModel = z.infer<typeof gatewayModelSchema>;
const modelCacheTtlMs = 5 * 60_000;

const loadGatewayModel = async (
  fetchCatalog: typeof fetch,
  baseUrl: string,
  modelId: string,
  token: string
): Promise<GatewayModel> => {
  const response = await fetchCatalog(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Could not load Gateway model catalog (${response.status}).`
    );
  }
  const catalog = z
    .object({ data: z.array(z.looseObject({ id: z.string() })) })
    .parse(await response.json());
  const entry = catalog.data.find((item) => item.id === modelId);
  if (entry === undefined) {
    throw new Error(`Gateway has no model '${modelId}' in its catalog.`);
  }
  return gatewayModelSchema.parse(entry);
};

/** Cache public model metadata across checkpoints; credentials stay request-scoped. */
export const createGatewayModelProviders = (dependencies: {
  fetchCatalog: typeof fetch;
  now: () => number;
}) => {
  const cache = new Map<string, { expiresAt: number; model: GatewayModel }>();
  return async (
    modelId: string,
    auth: HarnessV1AuthenticationEnvironment
  ): Promise<NonNullable<PiHarnessSettings["providers"]>> => {
    const token = auth.AI_GATEWAY_API_KEY ?? auth.VERCEL_OIDC_TOKEN;
    if (token === undefined) {
      return {};
    }
    const baseUrl = (
      auth.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh"
    ).replace(/\/$/u, "");
    const cacheKey = JSON.stringify([baseUrl, modelId]);
    const cached = cache.get(cacheKey);
    let model: GatewayModel;
    if (cached && cached.expiresAt > dependencies.now()) {
      ({ model } = cached);
    } else {
      model = await loadGatewayModel(
        dependencies.fetchCatalog,
        baseUrl,
        modelId,
        token
      );
      const now = dependencies.now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) {
          cache.delete(key);
        }
      }
      cache.set(cacheKey, { expiresAt: now + modelCacheTtlMs, model });
    }
    const useResponses = model.id.startsWith("openai/");
    return {
      "vercel-ai-gateway": {
        // Responses preserves OpenAI's explicit reasoning effort for tool calls.
        api: useResponses ? "openai-responses" : "anthropic-messages",
        baseUrl: useResponses ? `${baseUrl}/v1` : baseUrl,
        models: [
          {
            contextWindow: model.context_window,
            cost: {
              cacheRead: (model.pricing.input_cache_read ?? 0) * 1_000_000,
              cacheWrite: (model.pricing.input_cache_write ?? 0) * 1_000_000,
              input: model.pricing.input * 1_000_000,
              output: model.pricing.output * 1_000_000,
            },
            id: model.id,
            input: model.modalities.input.filter(
              (modality): modality is "text" | "image" =>
                modality === "text" || modality === "image"
            ),
            maxTokens: model.max_tokens,
            name: model.name,
            reasoning: model.tags.includes("reasoning"),
          },
        ],
      },
    };
  };
};

/** Gateway's catalog can contain models newer than Pi's bundled registry. */
export const gatewayModelProviders = createGatewayModelProviders({
  fetchCatalog: async (...args) => await fetch(...args),
  now: Date.now,
});
