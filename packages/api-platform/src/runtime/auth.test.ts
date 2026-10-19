import { APP_AUDIENCE, appTokenVerifier } from "@patchsmith/api-utils/app-auth";
import { expect, it, vi } from "vite-plus/test";

import { appRuntimePublicKeys, issueAppRuntimeToken } from "./auth";

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const settings = vi.hoisted(() => ({
  APP_RUNTIME_PREVIOUS_PUBLIC_KEYS: undefined as string | undefined,
  APP_RUNTIME_SIGNING_KEY: "",
  OPENAPI_SERVER_URL: "https://platform.test/api/platform",
}));

vi.mock("../env", () => ({ env: settings }));

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

settings.APP_RUNTIME_SIGNING_KEY = JSON.stringify({
  ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  kid: "platform",
});

it("publishes only public keys and issues platform-bound short-lived access", async () => {
  const publicKeys = appRuntimePublicKeys();
  expect(publicKeys.keys[0]).not.toHaveProperty("d");
  const identity = {
    appId: "app",
    appShortId: "app000000001",
    deploymentId: "deployment",
    installationId: "installation",
    projectId: "project",
    projectShortId: "abc123def456",
    scope: { name: "org", value: { id: "tenant" } },
    subjectId: "service-principal",
    toolUrl: "https://host.test/api/patchsmith/tools/execute",
  };
  const issuedAfter = Math.floor(Date.now() / 1000);
  const session = await issueAppRuntimeToken(identity);
  const issuedBefore = Math.floor(Date.now() / 1000);
  const verify = appTokenVerifier({
    audience: APP_AUDIENCE,
    issuer: settings.OPENAPI_SERVER_URL,
    publicKeys,
  });
  expect(await verify(session.token)).toMatchObject(identity);
  expect(session.expiresAt).toBeGreaterThanOrEqual((issuedAfter + 300) * 1000);
  expect(session.expiresAt).toBeLessThanOrEqual((issuedBefore + 300) * 1000);
});

it("refuses to expose private material in retired keys", () => {
  settings.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS = JSON.stringify({
    keys: [JSON.parse(settings.APP_RUNTIME_SIGNING_KEY)],
  });
  expect(() => appRuntimePublicKeys()).toThrow("public ES256");
  settings.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS = undefined;
});
