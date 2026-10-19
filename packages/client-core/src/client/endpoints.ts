import type { ToolBridge, ViewInstance } from "@patchsmith/app/client";
import {
  createClient,
  createSessionProvider,
  reference,
} from "@patchsmith/app/client/connection";
import type {
  PatchSmithContract,
  ToolImplementations,
  ContractTools,
} from "@patchsmith/core/schema";
import { flattenTools, validateToolValue } from "@patchsmith/core/schema";
import type { ViewContextValues } from "@patchsmith/core/views";
import * as v from "valibot";

import type { PatchSmithApp } from "#types";

import { toBaseUrl } from "./url";

type ClientToolTree = ToolImplementations<ContractTools, "client">;
const isToolHandler = (
  value: ClientToolTree[string]
): value is Exclude<ClientToolTree[string], ClientToolTree> =>
  typeof value === "function";

const appListSchema = v.array(
  v.looseObject({
    clientPath: v.optional(v.string()),
    currentDeployment: v.optional(
      v.nullable(v.looseObject({ id: v.string() }))
    ),
    description: v.optional(v.nullable(v.string())),
    id: v.string(),
    logoPaths: v.optional(
      v.object({ dark: v.optional(v.string()), light: v.optional(v.string()) })
    ),
    name: v.optional(v.string()),
    projectId: v.optional(v.string()),
    scope: v.optional(v.looseObject({ name: v.string() })),
    views: v.optional(
      v.array(
        v.looseObject({
          disabled: v.optional(v.literal(true)),
          instances: v.optional(v.literal(true)),
          path: v.string(),
          slot: v.string(),
        })
      )
    ),
  })
);

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

export interface SlotInstancesInput {
  slot: string;
  path: string;
  context: ViewContextValues;
}

const resolveInstances = reference<
  "action",
  SlotInstancesInput,
  ViewInstance[]
>("_patchsmith.instances.resolve", "action");

/** Endpoint transport owns no response stores. */
export const createEndpointClient = (options: {
  baseUrl: string | URL;
  fetch?: typeof fetch;
  contract?: PatchSmithContract;
  tools?: ToolImplementations<PatchSmithContract["tools"], "client">;
}) => {
  const baseUrl = toBaseUrl(options.baseUrl);
  const request: typeof fetch = async (input, init) =>
    await (options.fetch ?? globalThis.fetch)(input, init);
  type SessionProvider = ReturnType<typeof createSessionProvider>;
  interface SessionEntry {
    key: string | undefined;
    session: SessionProvider | undefined;
    provider: SessionProvider;
  }
  let generation = 0;
  const toolBridges = new Map<
    string,
    { bridge: ToolBridge; app: PatchSmithApp }
  >();
  const declarations = flattenTools(options.contract?.tools ?? {});
  const sessions = new Map<string, SessionEntry>();
  const clearSessions = () => {
    generation += 1;
    for (const entry of sessions.values()) {
      entry.session = undefined;
    }
    sessions.clear();
  };
  const createSessionEntry = (appId: string, key?: string): SessionEntry => ({
    key,

    // Mounted consumers keep this wrapper, so resolve the current provider on every call.
    provider: async (input) => {
      let current = sessions.get(appId);
      if (!current) {
        current = createSessionEntry(appId);
        sessions.set(appId, current);
      }
      const session = require(current.session);
      const value = await session(input);
      if (current.session !== session) {
        throw new DOMException("The app session was invalidated", "AbortError");
      }
      return value;
    },

    session: createSessionProvider({ appId, baseUrl, fetch: request }),
  });
  const getSessionProvider = (app: PatchSmithApp) => {
    const key = JSON.stringify([app.currentDeployment?.id]);
    let entry = sessions.get(app.id);
    if (entry && entry.key === undefined) {
      entry.key = key;
    }
    if (!entry || entry.key !== key) {
      if (entry) {
        entry.session = undefined;
      }
      entry = createSessionEntry(app.id, key);
      sessions.set(app.id, entry);
    }
    return entry.provider;
  };
  const getToolBridge = (app: PatchSmithApp): ToolBridge => {
    const existing = toolBridges.get(app.id);
    if (existing) {
      existing.app = app;
      return existing.bridge;
    }
    const session = async (path: string) => {
      const admitted = generation;
      if (!declarations.has(path)) {
        throw new Error("Tool not declared");
      }
      const result = await getSessionProvider(
        toolBridges.get(app.id)?.app ?? app
      )({
        refresh: false,
      });
      if (admitted !== generation) {
        throw new Error("Tool identity changed");
      }
      if (
        !isStringValue(result.token) ||
        !isStringValue(result.toolUrl) ||
        !Number.isFinite(result.expiresAt) ||
        result.expiresAt <= Date.now() ||
        result.identity?.installationId !== app.id
      ) {
        throw new Error("Invalid tool session");
      }
      return { ...result, identity: result.identity, url: result.toolUrl };
    };
    const bridge: ToolBridge = {
      client: async (path, input) => {
        const admitted = generation;
        const leaf = declarations.get(path);
        if (leaf?.kind !== "client") {
          throw new Error("Not a client tool");
        }
        let implementation: ClientToolTree[string] | undefined = options.tools;
        for (const part of path.split(".")) {
          if (
            !implementation ||
            isToolHandler(implementation) ||
            !Object.hasOwn(implementation, part)
          ) {
            throw new Error("Missing client tool");
          }
          implementation = implementation[part];
        }
        if (!isFunctionValue(implementation)) {
          throw new TypeError("Missing client tool");
        }
        const value = await validateToolValue(leaf.definition.input, input);
        const credential = await session(path);
        // SAFETY: The registered client path owns the schema that validated this input; its specific parameter type is erased by the shared tree.
        const toolInput =
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The registered client path owns the schema that validated this input; its specific parameter type is erased by the shared tree. */
          value as never;
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        const output = await implementation({
          context: Object.freeze({
            identity: credential.identity,
            requestId: crypto.randomUUID(),
            scope: credential.identity.scope,
          }),
          input: toolInput,
        });
        const result = await validateToolValue(leaf.definition.output, output);
        if (admitted !== generation) {
          throw new Error("Tool identity changed");
        }
        return result;
      },
      session: async (path: string) => {
        if (declarations.get(path)?.kind !== "server") {
          throw new Error("Not a server tool");
        }
        return await session(path);
      },
    };
    toolBridges.set(app.id, { app, bridge });
    return bridge;
  };
  return {
    apps: async (signal: AbortSignal): Promise<PatchSmithApp[]> => {
      const response = await request(new URL("apps", baseUrl), {
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) {
        throw new Error(
          `Unable to fetch PatchSmith apps from ${baseUrl.toString()}.`
        );
      }
      return v.parse(appListSchema, await response.json());
    },
    baseUrl,
    clearSessions,
    getSessionProvider,
    getToolBridge,
    slotInstances: async (
      app: PatchSmithApp,
      input: SlotInstancesInput,
      signal: AbortSignal
    ) => {
      signal.throwIfAborted();
      const backend = createClient({
        fetch: request,
        getSession: getSessionProvider(app),
      });
      const abort = () => {
        backend.close();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await backend.action(resolveInstances, input);
      } finally {
        signal.removeEventListener("abort", abort);
        backend.close();
      }
    },
  };
};

export type EndpointClient = ReturnType<typeof createEndpointClient>;
