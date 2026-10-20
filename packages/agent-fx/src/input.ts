import type { ModelMessage } from "ai";

export interface AppAgentInput {
  appId: string;
  threadId: string;
  hostUrl: string;
  /** Host-supplied guidance added to the built-in app-building instructions. */
  instructions?: string;
  // The host validates its schema; fx forwards this opaque document to the CLI.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Framework-independent host contract, consumed only as JSON.
  schema?: Record<string, unknown>;
  agentToken: string;
  messages: ModelMessage[];
  model: string;
}
