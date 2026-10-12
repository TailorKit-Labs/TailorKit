import { createPostHogAdapter } from "@flags-sdk/posthog";

type PostHogConfig = {
  host?: string;
  projectApiKey?: string;
};

type FlagOptions = PostHogConfig & {
  defaultValue?: boolean;
  distinctId: string;
};

let adapter: ReturnType<typeof createPostHogAdapter> | undefined;
let adapterConfig: PostHogConfig | undefined;

function getAdapter(config: PostHogConfig) {
  if (!config.host || !config.projectApiKey) return undefined;

  if (
    !adapter ||
    adapterConfig?.host !== config.host ||
    adapterConfig.projectApiKey !== config.projectApiKey
  ) {
    adapter = createPostHogAdapter({
      postHogKey: config.projectApiKey,
      postHogOptions: {
        disableGeoip: true,
        host: config.host,
      },
    });
    adapterConfig = config;
  }

  return adapter;
}

/** Evaluate a PostHog boolean flag, falling back safely if PostHog is unavailable. */
export async function evaluateBooleanFlag(
  key: string,
  { defaultValue = false, distinctId, ...config }: FlagOptions,
): Promise<boolean> {
  const postHogAdapter = getAdapter(config);
  if (!postHogAdapter) return defaultValue;

  try {
    const result = await postHogAdapter<boolean>().decide({
      defaultValue,
      entities: { distinctId },
      key,
    });
    return typeof result === "boolean" ? result : defaultValue;
  } catch (error) {
    console.warn(`Failed to evaluate PostHog feature flag "${key}".`, error);
    return defaultValue;
  }
}
