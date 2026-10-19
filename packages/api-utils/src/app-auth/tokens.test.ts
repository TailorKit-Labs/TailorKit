import { Clock, Effect } from "effect";
// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vite-plus/test";

import {
  bearerToken,
  issueAppToken,
  issueAppTokenEffect,
  appTokenVerifier,
  appTokenVerifierEffect,
} from "./tokens";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const { publicKey, privateKey } = await generateKeyPair("ES256", {
  extractable: true,
});
const privateJwk = await exportJWK(privateKey);
const publicKeys = {
  keys: [{ ...(await exportJWK(publicKey)), kid: "host-key" }],
};
const signing = {
  audience: "tailorkit-app",
  issuer: "https://host.test",
  keyId: "host-key",
  privateKey,
};
const identity = {
  appId: "app",
  appShortId: "app000000001",
  deploymentId: "deployment",
  installationId: "installation",
  projectId: "project",
  projectShortId: "abc123def456",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "principal",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};
const verify = appTokenVerifier({
  ...signing,
  appId: "app",
  projectId: "project",
  publicKeys,
});
it("verifies platform-signed identity and installation access", async () => {
  const session = await issueAppToken(signing, identity);
  const claims = decodeJwt(session.token);
  expect(requireValue(claims.exp) - requireValue(claims.iat)).toBe(300);
  expect(await verify(session.token)).toEqual({
    ...identity,
    expiresAt: session.expiresAt,
  });
  expect(
    bearerToken(
      new Request("https://runtime.test", {
        headers: { authorization: `Bearer ${session.token}` },
      })
    )
  ).toBe(session.token);
});
it("rejects wrong signature, issuer, audience, app, expiry, missing claims and excessive lifetime", async () => {
  const attacker = await generateKeyPair("ES256");
  const invalid = [
    await issueAppToken(
      { ...signing, privateKey: attacker.privateKey },
      identity
    ),
    await issueAppToken(
      { ...signing, issuer: "https://attacker.test" },
      identity
    ),
    await issueAppToken({ ...signing, audience: "other" }, identity),
    await issueAppToken(signing, { ...identity, appId: "other" }),
    await issueAppToken(signing, { ...identity, projectId: "other" }),
  ];
  await Promise.all(
    invalid.map(async ({ token }) => {
      await expect(verify(token)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    })
  );
  const sign = async (claims: ConstructorParameters<typeof SignJWT>[0]) =>
    await new SignJWT({
      ...identity,
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
      .setSubject(identity.installationId)
      .setIssuer(signing.issuer)
      .setAudience(signing.audience)
      .sign(privateKey);
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = [
    {
      appId: "app",
      exp: now - 1,
      iat: now - 100,
      installationId: "installation",
    },
    { appId: "app", iat: now, installationId: "installation" },
    { appId: "app", exp: now + 120, iat: now, installationId: undefined },
    { appId: "app", exp: now + 1000, iat: now, installationId: "installation" },
    {
      appId: "app",
      exp: now + 120,
      iat: now + 60,
      installationId: "installation",
    },
  ];
  await Promise.all(
    invalidClaims.map(async (claims) => {
      await expect(verify(await sign(claims))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    })
  );
  await expect(verify("not-a-token")).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
it("rejects symmetric keys, private verification keys and missing bearer credentials", () => {
  expect(() =>
    appTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ ...privateJwk, kid: "host-key" }] },
    })
  ).toThrow("public signing keys");
  expect(() =>
    bearerToken(new Request("https://runtime.test?token=ignored"))
  ).toThrow("required");
  expect(() =>
    appTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ k: "bad", kid: "host-key", kty: "oct" }] },
    })
  ).toThrow();
});

it("composes signing and verification with an injected clock, including expiry", async () => {
  const clock = Effect.runSync(
    Clock.clockWith((value) => Effect.succeed(value))
  );
  let now = Date.UTC(2000, 0, 1);
  const verifyEffect = appTokenVerifierEffect({ ...signing, publicKeys });
  const program = Effect.gen(function* authenticate() {
    const session = yield* issueAppTokenEffect(signing, identity);
    const access = yield* verifyEffect(session.token);
    now += 300_000;
    const expired = yield* verifyEffect(session.token).pipe(
      Effect.match({
        onFailure: (error) => error.code,
        onSuccess: (value) => value,
      })
    );
    return { access, expired, expiresAt: session.expiresAt };
  }).pipe(
    Effect.provideService(
      Clock.Clock,
      Object.assign(Object.create(clock), {
        currentTimeMillis: Effect.sync(() => now),
        currentTimeMillisUnsafe: () => now,
      })
    )
  );
  const result = await Effect.runPromise(program);
  expect(result.access).toEqual({
    ...identity,
    expiresAt: Date.UTC(2000, 0, 1) + 300_000,
  });
  expect(result.expiresAt).toBe(result.access.expiresAt);
  expect(result.expired).toBe("UNAUTHORIZED");
});

it("keeps invalid signing configuration in the recoverable Effect error channel", async () => {
  const program = issueAppTokenEffect(
    { ...signing, lifetimeSeconds: 301 },
    identity
  ).pipe(
    Effect.match({
      onFailure: (error) => error.message,
      onSuccess: (value) => value,
    })
  );
  await expect(Effect.runPromise(program)).resolves.toBe(
    "App tokens must last 1–300 seconds"
  );
});

it("rejects a token that expires while its signature is being verified", async () => {
  const session = await issueAppToken(signing, identity);
  const clock = Effect.runSync(
    Clock.clockWith((value) => Effect.succeed(value))
  );
  let reads = 0;
  const program = appTokenVerifierEffect({ ...signing, publicKeys })(
    session.token
  ).pipe(
    Effect.provideService(
      Clock.Clock,
      Object.assign(Object.create(clock), {
        currentTimeMillis: Effect.sync(() =>
          (reads += 1) === 1 ? session.expiresAt - 1 : session.expiresAt
        ),
      })
    ),
    Effect.match({
      onFailure: (error) => error.code,
      onSuccess: (value) => value,
    })
  );
  await expect(Effect.runPromise(program)).resolves.toBe("UNAUTHORIZED");
});

it.each([
  "projectId",
  "deploymentId",
  "projectShortId",
  "appShortId",
  "subjectId",
])("requires the signed %s claim", async (field) => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...identity,

    [field]: undefined,

    exp: now + 120,

    iat: now,
  };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
    .setSubject(identity.installationId)
    .setIssuer(signing.issuer)
    .setAudience(signing.audience)
    .sign(privateKey);
  await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("preserves arbitrary product principals in the shared app session", async () => {
  const session = await issueAppToken(signing, {
    ...identity,
    subjectId: "job:invoice-run",
  });
  expect(await verify(session.token)).toMatchObject({
    installationId: identity.installationId,
    scope: identity.scope,
    subjectId: "job:invoice-run",
  });
  const claims = decodeJwt(session.token);
  expect(claims.sub).toBe(identity.installationId);
  expect(claims.aud).toBe(signing.audience);
  expect(requireValue(claims.exp) - requireValue(claims.iat)).toBe(300);
});

it.each([undefined, null, "", 123, "x".repeat(257)])(
  "rejects invalid subjects when issuing and verifying tokens: %j",
  async (subjectId) => {
    await expect(
      // @ts-expect-error Exercise runtime issuance with an invalid host-supplied subject.
      issueAppToken(signing, { ...identity, subjectId })
    ).rejects.toThrow();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ ...identity, subjectId })
      .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
      .setSubject(identity.installationId)
      .setIssuer(signing.issuer)
      .setAudience(signing.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 120)
      .sign(privateKey);
    await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
);
