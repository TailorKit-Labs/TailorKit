import { flagsClient } from "@vercel/flags-core";

/** Evaluate a Vercel boolean flag with a safe fallback when it is unavailable. */
export async function evaluateBooleanFlag(key: string, defaultValue = false): Promise<boolean> {
  try {
    const result = await flagsClient.evaluate<boolean>(key, defaultValue);
    return result.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}
