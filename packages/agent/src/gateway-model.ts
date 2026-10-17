import type { HarnessV1AuthenticationEnvironment } from "@ai-sdk/harness";
import type { PiHarnessSettings } from "@ai-sdk/harness-pi";

/** Override Pi's Gateway transport for Sol so reasoning effort reaches Responses. */
export const gatewayModelProviders = (
  modelId: string,
  auth: HarnessV1AuthenticationEnvironment
): NonNullable<PiHarnessSettings["providers"]> => {
  const useGateway =
    auth.AI_GATEWAY_API_KEY !== undefined ||
    auth.VERCEL_OIDC_TOKEN !== undefined;
  if (!useGateway || modelId !== "openai/gpt-6.1-sol") {
    return {};
  }
  const baseUrl = (
    auth.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh"
  ).replace(/\/$/u, "");
  return {
    "vercel-ai-gateway": {
      api: "openai-responses",
      baseUrl: `${baseUrl}/v1`,
      // Pi requires a complete entry to override a bundled model's protocol.
      models: [
        {
          contextWindow: 1_050_000,
          cost: { cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10 },
          id: modelId,
          input: ["text", "image"],
          maxTokens: 128_000,
          name: "GPT-6.1 Sol",
          reasoning: true,
        },
      ],
    },
  };
};
