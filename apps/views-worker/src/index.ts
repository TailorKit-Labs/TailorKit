import { ORPCError } from "@orpc/server";
import { createProjectHostVerifier } from "@patchsmith/auth/project-host";
import { relations } from "@patchsmith/db/relations";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { readEnv } from "#env";

import {
  errorResponse,
  projectKey,
  readInput,
  resolutionPath,
  resolveRequest,
} from "./handler";
import { sharedStorage } from "./storage";

export default {
  async fetch(
    request: Request,
    bindings: Parameters<typeof readEnv>[0]
  ): Promise<Response> {
    if (new URL(request.url).pathname !== resolutionPath) {
      return errorResponse(new ORPCError("NOT_FOUND"));
    }

    if (request.method !== "POST") {
      return new Response(null, {
        headers: { allow: "POST", "cache-control": "no-store" },
        status: 405,
      });
    }

    let client: Client | undefined;

    try {
      projectKey(request);
      const input = await readInput(request);
      const env = readEnv(bindings);

      const storage = sharedStorage({
        token: env.KV_REST_API_TOKEN,
        url: env.KV_REST_API_URL,
      });

      // Hyperdrive owns the reusable pool. The request owns this client/socket.
      client = new Client({
        connectionString: env.HYPERDRIVE.connectionString,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
      });
      await client.connect();
      const database = drizzle({ client, relations });

      const auth = createProjectHostVerifier({
        baseURL: env.PLATFORM_URL,
        database,
        secondaryStorage: storage.secondaryStorage,
        secret: env.AUTH_SECRET,
      });

      return await resolveRequest(request, input, {
        assetDomain: env.ASSET_DOMAIN,
        database,
        limit: storage.limit,
        signing: {
          issuer: env.PLATFORM_URL,
          keyId: env.APP_RUNTIME_SIGNING_KEY.kid,
          privateKey: env.APP_RUNTIME_SIGNING_KEY,
        },
        stores: env.STORES,
        verifyKey: async (key) =>
          await auth.api.verifyApiKey({
            body: { configId: "project-host", key },
          }),
      });
    } catch (error) {
      if (error instanceof ORPCError) {
        return errorResponse(error);
      }

      // Do not log a Postgres connection string, project key, or private signing material.
      console.error("Cloudflare view resolution failed");

      return errorResponse(new ORPCError("SERVICE_UNAVAILABLE"));
    } finally {
      await client?.end().catch(() => {
        console.error("Could not close view resolution database client");
      });
    }
  },
};
