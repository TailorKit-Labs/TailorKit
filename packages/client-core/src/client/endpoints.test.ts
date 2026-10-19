import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it, vi } from "vite-plus/test";

import type { PatchSmithApp } from "#types";

import { createEndpointClient } from "./endpoints";
import { createPatchSmithFetchClient } from "./fetch-client";

const session = (token: string) =>
  Response.json({
    expiresAt: Date.now() + 300_000,
    subjectId: "principal",
    token,
    url: "https://runtime.test/rpc",
  });

const deployedApp: PatchSmithApp = {
  currentDeployment: { id: "first" },
  id: "app",
};
it.each([
  ["deployment", { ...deployedApp, currentDeployment: { id: "second" } }],
])(
  "replaces obsolete %s sessions while held providers follow the current app",
  async (_, next) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session("first"))
      .mockResolvedValueOnce(session("other"))
      .mockResolvedValueOnce(session("second"))
      .mockResolvedValueOnce(session("third"));
    const client = createEndpointClient({
      baseUrl: "https://host.test/",
      fetch: request,
    });
    const held = client.getSessionProvider(deployedApp);
    const other = client.getSessionProvider({ id: "other" });
    await expect(held({ refresh: false })).resolves.toMatchObject({
      token: "first",
    });
    await expect(other({ refresh: false })).resolves.toMatchObject({
      token: "other",
    });
    const current = client.getSessionProvider(next);
    await expect(current({ refresh: false })).resolves.toMatchObject({
      token: "second",
    });
    await expect(held({ refresh: false })).resolves.toMatchObject({
      token: "second",
    });
    expect(client.getSessionProvider(next)).toBe(current);
    await expect(other({ refresh: false })).resolves.toMatchObject({
      token: "other",
    });
    // Revisiting a deployment must not retrieve its previously cached credentials.
    const restored = client.getSessionProvider(deployedApp);
    expect(restored).not.toBe(held);
    await expect(restored({ refresh: false })).resolves.toMatchObject({
      token: "third",
    });
    await expect(current({ refresh: false })).resolves.toMatchObject({
      token: "third",
    });
    expect(request).toHaveBeenCalledTimes(4);
  }
);

const respondImplementation = () => {};

it("clears sessions for held consumers through the public client and shares replacement requests", async () => {
  let respond: (response: Response) => void = respondImplementation;
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(session("before"))
    .mockImplementationOnce(
      async () =>
        await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            respond = resolve;
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })()
    )
    .mockResolvedValueOnce(session("after-again"));
  const fetchClient = createPatchSmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: request,
  });
  const client = fetchClient.endpoints;
  const held = client.getSessionProvider(deployedApp);
  await held({ refresh: false });
  fetchClient.clear();
  const pending = held({ refresh: false });
  const fresh = client.getSessionProvider(deployedApp);
  expect(fresh).not.toBe(held);
  const second = fresh({ refresh: false });
  expect(request).toHaveBeenCalledTimes(2);
  respond(session("after"));
  await expect(pending).resolves.toMatchObject({ token: "after" });
  await expect(second).resolves.toMatchObject({ token: "after" });
  fetchClient.clear();
  await expect(held({ refresh: false })).resolves.toMatchObject({
    token: "after-again",
  });
  await expect(fresh({ refresh: false })).resolves.toMatchObject({
    token: "after-again",
  });
  expect(request).toHaveBeenCalledTimes(3);
});

it("reauthorizes held consumers after host sign-out and account changes", async () => {
  let user: string | null = "first-user";
  const request = vi.fn<typeof fetch>().mockImplementation(
    asyncFixture(() =>
      user !== undefined && user !== null && user !== ""
        ? Response.json({
            expiresAt: Date.now() + 300_000,
            subjectId: user,
            token: `${user}-token`,
            url: "https://runtime.test/rpc",
          })
        : new Response(null, { status: 401 })
    )
  );
  const fetchClient = createPatchSmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: request,
  });
  const held = fetchClient.endpoints.getSessionProvider(deployedApp);
  await expect(held({ refresh: false })).resolves.toMatchObject({
    token: "first-user-token",
  });

  user = null;
  fetchClient.clear();
  await expect(held({ refresh: false })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });

  user = "next-user";
  fetchClient.clear();
  await expect(held({ refresh: false })).resolves.toMatchObject({
    token: "next-user-token",
  });
  await expect(held({ refresh: false })).resolves.toMatchObject({
    token: "next-user-token",
  });

  user = "third-user";
  fetchClient.clear();
  await expect(held({ refresh: false })).resolves.toMatchObject({
    token: "third-user-token",
  });
  expect(request).toHaveBeenCalledTimes(4);
});

const respondImplementation2 = () => {};

it.each(["clear", "deployment"])(
  "rejects a late session response after %s invalidates its credentials",
  async (change) => {
    let respond: (response: Response) => void = respondImplementation2;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async () =>
          await (async () => {
            const {
              promise: pendingPromise,
              resolve,
              reject: rejectPending,
            } = Promise.withResolvers<Response>();
            try {
              respond = resolve;
            } catch (error) {
              rejectPending(error);
            }
            return await pendingPromise;
          })()
      )
      .mockResolvedValueOnce(session("current"));
    const fetchClient = createPatchSmithFetchClient({
      baseUrl: "https://host.test/",
      fetch: request,
    });
    const client = fetchClient.endpoints;
    const held = client.getSessionProvider(deployedApp);
    const pending = held({ refresh: false });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    if (change === "clear") {
      fetchClient.clear();
    } else {
      client.getSessionProvider({
        ...deployedApp,
        currentDeployment: { id: "second" },
      });
    }
    await expect(held({ refresh: false })).resolves.toMatchObject({
      token: "current",
    });
    respond(session("obsolete"));
    await rejected;
    await expect(held({ refresh: false })).resolves.toMatchObject({
      token: "current",
    });
    expect(request).toHaveBeenCalledTimes(2);
  }
);
