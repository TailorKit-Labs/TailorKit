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
    request: Request & { cf?: { colo?: string } },
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

    const started = performance.now();
    let client: Client | undefined;
    let connectMs = 0;
    let closeMs = 0;
    let response: Response;

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
      const connectStarted = performance.now();
      await client.connect();
      connectMs = performance.now() - connectStarted;
      const database = drizzle({ client, relations });

      const auth = createProjectHostVerifier({
        baseURL: env.PLATFORM_URL,
        database,
        secondaryStorage: storage.secondaryStorage,
        secret: env.AUTH_SECRET,
      });

      response = await resolveRequest(request, input, {
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
        response = errorResponse(error);
      } else {
        // Do not log a Postgres connection string, project key, or private signing material.
        console.error("Cloudflare view resolution failed");
        response = errorResponse(new ORPCError("SERVICE_UNAVAILABLE"));
      }
    } finally {
      const closeStarted = performance.now();
      await client?.end().catch(() => {
        console.error("Could not close view resolution database client");
      });
      closeMs = performance.now() - closeStarted;
    }

    response.headers.append(
      "server-timing",
      `platform_connect;dur=${connectMs.toFixed(1)}, platform_close;dur=${closeMs.toFixed(1)}, platform_request;dur=${(performance.now() - started).toFixed(1)}`
    );

    const ingress = request.cf?.colo;

    if (ingress !== undefined && /^[A-Z]{3}$/u.test(ingress)) {
      response.headers.append(
        "server-timing",
        `platform_ingress;desc="${ingress}"`
      );
    }

    return response;
  },
};
