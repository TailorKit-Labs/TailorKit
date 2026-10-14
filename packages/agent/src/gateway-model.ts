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

/** Gateway's catalog can contain models newer than Pi's bundled registry. */
export const gatewayModelProviders = async (
  modelId: string,
  auth: HarnessV1AuthenticationEnvironment
): Promise<NonNullable<PiHarnessSettings["providers"]>> => {
  if (
    auth.AI_GATEWAY_API_KEY === undefined &&
    auth.VERCEL_OIDC_TOKEN === undefined
  ) {
    return {};
  }
  const baseUrl = auth.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh";
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/v1/models`, {
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
  const model = gatewayModelSchema.parse(entry);
  return {
    "vercel-ai-gateway": {
      // Pi's Gateway provider uses Gateway's Anthropic-compatible endpoint.
      api: "anthropic-messages" as const,
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
