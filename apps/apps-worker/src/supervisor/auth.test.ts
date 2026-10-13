import { APP_AUDIENCE, issueAppToken } from "@tailorkit/api-utils/app-auth";
import { Effect } from "effect";
import { expect, it, vi, afterEach } from "vite-plus/test";

import { createAppRuntimeVerifierEffect } from "./auth";

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const issuer = "https://platform.test/api/platform";
const signing = {
  audience: APP_AUDIENCE,
  issuer,
  keyId: "platform",
  privateKey: pair.privateKey,
};
const publicKeys = {
  keys: [
    {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: "platform",
    },
  ],
};
const identity = {
  appId: "app",
  appPublicId: "app000000001",
  deploymentId: "deployment",
  installationId: "installation",
  projectId: "project",
  publicTeamId: "abc123def45678",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([publicKeys, JSON.stringify(publicKeys)])(
  "verifies configured public keys without external requests (%#)",
  async (keys) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const verify = createAppRuntimeVerifierEffect({
      platformUrl: issuer,
      publicKeys: keys,
    });
    const session = await issueAppToken(signing, identity);
    expect(await Effect.runPromise(verify(session.token))).toMatchObject(
      identity
    );
    expect(await Effect.runPromise(verify(session.token))).toMatchObject(
      identity
    );
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it.each([{ issuer: "https://attacker.test" }, { audience: "other" }])(
  "rejects incorrect platform claims %j",
  async (overrides) => {
    const session = await issueAppToken({ ...signing, ...overrides }, identity);
    await expect(
      Effect.runPromise(
        createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys })(
          session.token
        )
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
);

it.each([
  undefined,
  "invalid",
  { keys: [] },
  { keys: [{ k: "secret", kid: "bad", kty: "oct" }] },
])("fails closed for invalid configured keys %j", async (keys) => {
  await expect(
    Effect.runPromise(
      createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys: keys })(
        "token"
      )
    )
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

it("exposes verification as an Effect", async () => {
  const session = await issueAppToken(signing, identity);
  expect(
    await Effect.runPromise(
      createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys })(
        session.token
      )
    )
  ).toMatchObject(identity);
});
