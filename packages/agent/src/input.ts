import type { ModelMessage } from "ai";

import type { HostSchemaDocument } from "./schema";

export interface AppAgentInput {
  /** Globally unique, authorized app identity; owns the shared source workspace. */
  appId: string;
  /** An authorized conversation belonging to this app; also the Pi session ID. */
  threadId: string;
  hostUrl: string;
  schema?: HostSchemaDocument;
  /** Short-lived CLI authorization, kept out of model instructions. */
  agentToken: string;
  messages: ModelMessage[];
  /** An AI Gateway model ID understood by Pi. */
  model: string;
}
