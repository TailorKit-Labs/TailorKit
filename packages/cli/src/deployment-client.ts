import { deploymentsCreate, deploymentsPublish } from "@tailorkit/client-platform/client";
import type { DeploymentsCreateData } from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import { createTailorKitClient } from "@tailorkit/core/server";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { z } from "zod";

const agentClaimsSchema = z.object({
  iss: z.literal("tailorkit-agent"),
  aud: z.literal("tailorkit-platform-deploy"),
  platformUrl: z.url({ protocol: /^https?$/u }),
  appId: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.object({ name: z.string().min(1), value: z.record(z.string(), z.json()) }),
  exp: z.number().int(),
  iat: z.number().int(),
});

/** Decode routing data only. The platform verifies the signature and authorization. */
export function getAgentAuth() {
  const token = process.env.TAILORKIT_AGENT_TOKEN;
  if (token === undefined) return undefined;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "HS256" || header.typ !== "tailorkit-agent+jwt") throw new Error();
    const claims = agentClaimsSchema.parse(decodeJwt(token));
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(claims.platformUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      claims.iat > now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 3600
    )
      throw new Error();
    if (claims.exp <= now) throw new Error("Agent authorization expired. Start a new agent turn.");
    return { ...claims, token };
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith("Agent authorization expired")
        ? error.message
        : "Invalid agent authorization. Start a new agent turn.",
    );
  }
}

async function request<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error) throw error;
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    )
      throw Object.assign(new Error(error.message, { cause: error }), {
        code: "code" in error ? error.code : undefined,
      });
    throw new Error(String(error), { cause: error });
  }
}

export function createDeploymentClient(
  hostUrl: string,
  token: string,
  agent?: ReturnType<typeof getAgentAuth>,
) {
  if (!agent)
    return createTailorKitClient({ url: hostUrl, headers: { authorization: `Bearer ${token}` } });
  const client = createClient({
    baseUrl: agent.platformUrl,
    headers: { authorization: `Bearer ${agent.token}` },
    responseStyle: "data",
    throwOnError: true,
  });
  return {
    apps: {
      create: async (_body: { name: string; description: string | null }) => {
        throw new Error("Agent deployment must use the authorized existing app.");
      },
    },
    deployments: {
      create: (body: Omit<DeploymentsCreateData["body"], "scope">) =>
        request(deploymentsCreate({ client, body: { ...body, scope: agent.scope } })),
      publish: ({ deploymentId, rollout }: { deploymentId: string; rollout?: boolean }) =>
        request(
          deploymentsPublish({
            client,
            path: { deploymentId },
            body: { rollout, scope: agent.scope },
          }),
        ),
    },
  };
}
