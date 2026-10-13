import { createClient } from "@vercel/flags-core";

const flagsClient = createClient();

export interface FlagEntities {
  user: {
    id: string;
    email: string;
  };
}

/** Evaluate a Vercel boolean flag with a safe fallback when it is unavailable. */
export async function evaluateBooleanFlag(
  key: string,
  defaultValue = false,
  entities?: FlagEntities
): Promise<boolean> {
  try {
    const result = await flagsClient.evaluate<boolean>(
      key,
      defaultValue,
      entities
    );
    return result.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}
