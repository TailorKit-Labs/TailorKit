import { AppError } from "@patchsmith/app/server";
import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { installationDiagnostic, probeLocation } from "./diagnostics";
import type { InstallationLocation } from "./diagnostics";

const secret = "s".repeat(32);
const objectId = "a".repeat(64);
const url = "https://internal.tailorkit.app/diagnostics/installation";

const setup = () => {
  const lookups: string[] = [];
  const requests: string[] = [];

  const options = {
    assetDomain: "tailorkit.app",
    installation: (id: string) => {
      lookups.push(id);

      return {
        diagnoseLocation: asyncFixture(
          (requestId: string): InstallationLocation => {
            requests.push(requestId);

            return {
              colo: "IAD",
              installationMs: 0,
              objectId: id,
              probeMs: 0,
              requestId,
              source: "outbound-trace",
            };
          }
        ),
      };
    },
    serviceToken: secret,
  };

  return { lookups, options, requests };
};

const post = (body = JSON.stringify({ objectId }), token = secret) =>
  new Request(url, {
    body,
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
  });

it("probes a fixed URL without forwarding credentials and returns only the colo", async () => {
  const calls: Request[] = [];

  const fetcher: typeof fetch = asyncFixture((input, init) => {
    calls.push(new Request(input, init));

    return new Response("ip=private\r\ncolo=IAD\r\nloc=US\r\n");
  });

  expect(await probeLocation(fetcher)).toBe("IAD");
  expect(calls).toHaveLength(1);
  const [request] = calls;

  expect(request?.url).toBe("https://www.cloudflare.com/cdn-cgi/trace");
  expect(request?.headers.get("authorization")).toBeNull();
  expect(request?.redirect).toBe("manual");
  expect(request?.signal).toBeInstanceOf(AbortSignal);
});

it.each(["ip=private\n", "colo=invalid\n", `colo=IAD\n${"x".repeat(4096)}`])(
  "rejects unusable trace responses without exposing their contents",
  async (body) => {
    await expect(
      probeLocation(asyncFixture(() => new Response(body)))
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Location probe unavailable",
    });
  }
);

it.each(["upstream", "network", "timeout"])(
  "sanitizes a failed %s location probe",
  async (failure) => {
    const fetcher: typeof fetch = asyncFixture(() => {
      if (failure === "upstream") {
        return new Response("private upstream details", { status: 503 });
      }

      if (failure === "timeout") {
        throw new DOMException("private timeout details", "TimeoutError");
      }

      throw new Error("private network details");
    });

    await expect(probeLocation(fetcher)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Location probe unavailable",
    });
  }
);

it("correlates gateway and supervisor diagnostics without caching", async () => {
  const { options, lookups, requests } = setup();
  const request = post();
  request.headers.set("cf-placement", "remote-IAD");
  Object.defineProperty(request, "cf", { value: { colo: "EWR" } });
  const response = await installationDiagnostic(request, options);

  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  const requestId = response?.headers.get("x-patchsmith-request-id");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(lookups).toEqual([objectId]);
  expect(requests).toEqual([requestId]);
  const body: unknown = await response?.json();

  expect(body).toMatchObject({
    colo: "IAD",
    gateway: { ingressColo: "EWR", placementHeader: "remote-IAD" },
    objectId,
    requestId,
    source: "outbound-trace",
  });

  const { timings } = z
    .object({
      timings: z.record(z.string(), z.number().nonnegative()),
    })
    .parse(body);

  expect(Object.keys(timings)).toEqual([
    "lookupMs",
    "outsideInstallationMs",
    "roundtripMs",
  ]);
});

it.each(["invalid", "app-session"])(
  "rejects the %s credential before an installation lookup",
  async (token) => {
    const { options, lookups } = setup();

    const response = await installationDiagnostic(
      post(undefined, token),
      options
    );

    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(lookups).toEqual([]);
  }
);

it.each(["{", "{}", JSON.stringify({ objectId: "invalid" }), "x".repeat(1025)])(
  "rejects invalid diagnostic input before an installation lookup",
  async (body) => {
    const { options, lookups } = setup();
    const response = await installationDiagnostic(post(body), options);

    expect(response?.status).toBe(400);
    expect(lookups).toEqual([]);
  }
);

it("restricts diagnostics to POST", async () => {
  const { options, lookups } = setup();
  const response = await installationDiagnostic(new Request(url), options);

  expect(response?.status).toBe(405);
  expect(response?.headers.get("allow")).toBe("POST");
  expect(lookups).toEqual([]);
});

it.each([
  url.replace("internal", "abc123def456"),
  url.replace("https:", "http:"),
  url.replace(".app/", ".app:8443/"),
  `${url}?probe=true`,
  `${url}/extra`,
  "https://internal.attacker.test/diagnostics/installation",
])("does not expose diagnostics at %s", (otherUrl) => {
  const { options, lookups } = setup();

  expect(
    installationDiagnostic(new Request(otherUrl), options)
  ).toBeUndefined();
  expect(lookups).toEqual([]);
});

it.each(["typed", "unexpected"])(
  "handles %s supervisor failures",
  async (failure) => {
    const error =
      failure === "typed"
        ? new AppError("NOT_FOUND", "Supervisor has no prepared deployment")
        : new Error("private RPC details");

    const { options } = setup();
    options.installation = () => ({
      diagnoseLocation: asyncFixture(() => {
        throw error;
      }),
    });
    const response = await installationDiagnostic(post(), options);

    expect(response?.status).toBe(error instanceof AppError ? 404 : 500);
    expect(await response?.text()).not.toContain("private RPC details");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  }
);
