import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { defineContract } from "@tailorkit/core/schema";
import type { RemoteProps } from "@tailorkit/sandbox/protocol";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { RenderSlot } from "../index";
import { createClient } from "../tailorkit";

const requests: { appUrl: string; props: RemoteProps }[] = [];

vi.mock("../remote-view", () => ({
  RemoteViewHost: (request: { appUrl: string; props: RemoteProps }) => {
    requests.push(request);
    return null;
  },
}));

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const typedSchema = <T,>(): StandardSchemaV1<unknown, T> &
  StandardJSONSchemaV1<unknown, T> => ({
  "~standard": {
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: (value) => ({ value: value as T }),
    vendor: "test",
    version: 1,
  },
});

const contract = defineContract({
  components: {},
  scopes: { user: typedSchema<{ id: string }>() },
  slots: {
    navbar: { views: ["/"] },
    page: { multiple: true, views: ["/"] },
    panel: { views: ["/", "/customers", "/customers/detail"] },
  },
  views: {
    "/": typedSchema<{ user: { id: string } }>(),
    "/customers": typedSchema<{ canEdit: boolean }>(),
    "/customers/detail": typedSchema<{ customer: { id: string } }>(),
  },
});

const client = createClient({ baseUrl: "https://host.test/api/", contract });

const app = { clientPath: "/client.js", id: "test" };

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ schema: {} })
  );
});

afterEach(() => {
  cleanup();
  client.clearCache();
  vi.restoreAllMocks();
});

const Detail = () => {
  client.useViewContext("/customers/detail", {
    context: undefined,
    loading: true,
  });
  return null;
};

const Context = ({ detail = true }: { detail?: boolean }) => {
  client.useViewContext("/", { context: { user: { id: "registered" } } });
  client.useViewContext("/customers", { context: { canEdit: true } });
  return detail ? <Detail /> : null;
};

const contentsImplementationImplementation = (detail: boolean) => (
  <client.Provider>
    <Context detail={detail} />
    <client.RenderSlot app={app} slot="panel" />
  </client.Provider>
);

describe("RenderSlot", () => {
  const contentsImplementation = contentsImplementationImplementation;

  it("uses the registered hierarchy and removes unmounted contexts", async () => {
    const contents = contentsImplementation;
    const result = render(contents(true));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { user: { id: "registered" } },
            path: "/",
            status: "ready",
          },
          { context: { canEdit: true }, path: "/customers", status: "ready" },
          { path: "/customers/detail", status: "loading" },
        ],
        slot: "panel",
        view: "/customers/detail",
      })
    );
    result.rerender(contents(false));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { user: { id: "registered" } },
            path: "/",
            status: "ready",
          },
          { context: { canEdit: true }, path: "/customers", status: "ready" },
        ],
        view: "/customers",
      })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("renders nothing and does not fetch before a context is registered", () => {
    const { container } = render(
      <client.Provider>
        <client.RenderSlot app={app} slot="panel" />
      </client.Provider>
    );
    expect(container.childElementCount).toBe(0);
    expect(requests).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses the contract across slots and isolates roots during Strict Mode", async () => {
    render(
      <StrictMode>
        <client.Provider>
          <Context />
          <RenderSlot app={app} slot="panel" />
          <RenderSlot app={app} slot="navbar" />
        </client.Provider>
        <client.Provider>
          <RenderSlot
            app={{ clientPath: "/other.js", id: "other" }}
            slot="panel"
          />
        </client.Provider>
      </StrictMode>
    );
    await waitFor(() =>
      expect(requests.some(({ props }) => props.slot === "navbar")).toBe(true)
    );
    expect(
      requests.every(({ appUrl }) => appUrl === "https://host.test/client.js")
    ).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

const contentsImplementation4Implementation = (
  status: "ready" | "loading" | "error"
) => (
  <client.Provider>
    {status === "ready" ? (
      <client.RenderSlot.Controlled
        app={app}
        slot="navbar"
        view="/"
        status="ready"
        context={{ user: { id: "u1" } }}
      />
    ) : (
      <client.RenderSlot.Controlled
        app={app}
        slot="navbar"
        view="/"
        status={status}
      />
    )}
  </client.Provider>
);

const contentsImplementation3Implementation = (detail: boolean) => (
  <client.Provider>
    <Context detail={detail} />
    <client.RenderSlot.Controlled
      app={app}
      slot="panel"
      view="/customers"
      status="ready"
      context={{ canEdit: false, user: { id: "explicit" } }}
    />
  </client.Provider>
);

const contentsImplementation2Implementation = (id: string) => (
  <client.Provider>
    <client.RenderSlot.Controlled
      app={app}
      slot="panel"
      view="/customers/detail"
      status="ready"
      context={{
        canEdit: false,
        customer: { id },
        user: { id: "explicit" },
      }}
    />
  </client.Provider>
);

describe("RenderSlot.Controlled", () => {
  const contentsImplementation2 = contentsImplementation2Implementation;

  it("renders supplied combined context without registrations and keeps equivalent context stable", async () => {
    const contents = contentsImplementation2;
    const result = render(contents("c1"));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        context: {
          canEdit: false,
          customer: { id: "c1" },
          user: { id: "explicit" },
        },
        controlled: true,
        slot: "panel",
        status: "ready",
        view: "/customers/detail",
      })
    );
    expect(requests.at(-1)?.props).not.toHaveProperty("layers");
    const initial = requests.at(-1)?.props;
    result.rerender(contents("c1"));
    expect(requests.at(-1)?.props).toBe(initial);
    result.rerender(contents("c2"));
    await waitFor(() =>
      expect(requests.at(-1)?.props.context).toMatchObject({
        customer: { id: "c2" },
      })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  const contentsImplementation3 = contentsImplementation3Implementation;

  it("does not inherit or react to registered context", async () => {
    const contents = contentsImplementation3;
    const result = render(contents(true));
    await waitFor(() =>
      expect(requests.at(-1)?.props.context).toEqual({
        canEdit: false,
        user: { id: "explicit" },
      })
    );
    const initial = requests.at(-1)?.props;
    await act(() => result.rerender(contents(false)));
    expect(requests.at(-1)?.props).toBe(initial);
  });

  const contentsImplementation4 = contentsImplementation4Implementation;

  it("drops ready context when explicitly switched to loading or error", async () => {
    const contents = contentsImplementation4;
    const result = render(contents("ready"));
    await waitFor(() => expect(requests.at(-1)?.props.status).toBe("ready"));
    for (const status of ["loading", "error"] as const) {
      result.rerender(contents(status));
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      await waitFor(() =>
        expect(requests.at(-1)?.props).toMatchObject({
          context: undefined,
          status,
        })
      );
    }
  });
});

it.each(["managed", "controlled"] as const)(
  "rejects a %s RenderSlot under the wrong client",
  (mode) => {
    const other = createClient({
      baseUrl: "https://other.test/api/",
      contract,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <other.Provider>
          {mode === "managed" ? (
            <client.RenderSlot app={app} slot="panel" />
          ) : (
            <client.RenderSlot.Controlled
              app={app}
              slot="panel"
              view="/customers"
              status="loading"
            />
          )}
        </other.Provider>
      )
    ).toThrow(
      `${mode === "managed" ? "RenderSlot" : "RenderSlot.Controlled"} was created for a different TailorKit client`
    );
  }
);

const instanceApp = {
  ...app,
  views: [{ instances: true as const, path: "/", slot: "page" }],
};

const overview = {
  data: { reportId: "r1" },
  key: "overview",
  metadata: { title: "Overview" },
};

const summary = {
  data: { reportId: "r2" },
  key: "summary",
  metadata: { title: "Summary" },
};

const contentImplementation = (key: string) => (
  <client.Provider>
    <Context detail={false} />
    <client.RenderSlot app={instanceApp} slot="page" instanceKey={key} />
  </client.Provider>
);

it("resolves the key and sends a complete controlled instance through the renderer", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi
    .mocked(globalThis.fetch)
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    .mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/backend/session")) {
        return Response.json({
          expiresAt: Date.now() + 300_000,
          token: "token",
          url: "https://runtime.test/rpc",
        });
      }
      if (url.endsWith("/actions")) {
        return (() => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            finish = resolve;
          } catch (error) {
            rejectPending(error);
          }
          return pendingPromise;
        })();
      }
      return Response.json({ schema: {} });
    });
  const content = contentImplementation;
  const view = render(content("overview"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Loading view…")
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(requests).toHaveLength(0);
  await act(
    async () => await finish(Response.json({ json: [overview, summary] }))
  );
  await waitFor(() =>
    expect(requests.at(-1)?.props).toMatchObject({
      context: { user: { id: "registered" } },
      controlled: true,
      instance: overview,
      slot: "page",
      status: "ready",
      view: "/",
    })
  );
  expect(requests.at(-1)?.props).not.toHaveProperty("layers");
  const initialProps = requests.at(-1)?.props;
  view.rerender(content("overview"));
  expect(requests.at(-1)?.props).toBe(initialProps);
  view.rerender(content("summary"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(summary));
  expect(
    fetch.mock.calls.filter(([input]) => String(input).endsWith("/actions"))
  ).toHaveLength(1);
  view.rerender(content("missing"));
  expect(screen.getByRole("alert").textContent).toBe(
    'View instance "missing" is unavailable.'
  );
  view.rerender(content("overview"));
  await waitFor(() =>
    expect(requests.at(-1)?.props.instance).toEqual(overview)
  );
});

it("reports resolver failures and missing keys without mounting stale instances", async () => {
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/backend/session")) {
      return Response.json({
        expiresAt: Date.now() + 300_000,
        token: "token",
        url: "https://runtime.test/rpc",
      });
    }
    if (url.endsWith("/actions")) {
      return Response.json(
        {
          json: {
            code: "FORBIDDEN",
            defined: false,
            message: "No reports available",
          },
        },
        { status: 403 }
      );
    }
    return Response.json({ schema: {} });
  });
  render(
    <client.Provider>
      <Context />
      <client.RenderSlot app={instanceApp} slot="page" instanceKey="overview" />
    </client.Provider>
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("No reports available")
  );
  expect(requests).toHaveLength(0);
});

it("requires a key for a dynamic managed view", async () => {
  render(
    <client.Provider>
      <Context />
      <RenderSlot app={instanceApp} slot="page" />
    </client.Provider>
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Pass instanceKey to RenderSlot"
    )
  );
  expect(requests).toHaveLength(0);
});

it.each([false, true])(
  "checks instance support without composing invalid context (dynamic: %s)",
  async (dynamic) => {
    const DuplicateContext = () => {
      client.useViewContext("/", { context: { user: { id: "registered" } } });
      const context = { canEdit: true, user: { id: "duplicate" } };
      client.useViewContext("/customers", { context });
      return null;
    };
    const appWithViews = {
      ...app,
      views: [
        dynamic
          ? { instances: true as const, path: "/customers", slot: "panel" }
          : { path: "/customers", slot: "panel" },
      ],
    };
    render(
      <client.Provider>
        <DuplicateContext />
        <client.RenderSlot app={appWithViews} slot="panel" />
      </client.Provider>
    );
    if (dynamic) {
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          'Slot "panel" does not support instances.'
        )
      );
      expect(requests).toHaveLength(0);
    } else {
      await waitFor(() =>
        expect(requests.at(-1)?.props).toMatchObject({
          layers: [
            {
              context: { user: { id: "registered" } },
              path: "/",
              status: "ready",
            },
            {
              context: { canEdit: true, user: { id: "duplicate" } },
              path: "/customers",
              status: "ready",
            },
          ],
          view: "/customers",
        })
      );
      expect(screen.queryByRole("alert")).toBeNull();
    }
  }
);

it("passes supplied instances without resolving them and clears them while loading", async () => {
  const content = (instance: typeof overview, status: "ready" | "loading") => (
    <client.Provider>
      {status === "ready" ? (
        <client.RenderSlot.Controlled
          app={instanceApp}
          slot="page"
          view="/"
          status="ready"
          context={{ user: { id: "explicit" } }}
          instance={instance}
        />
      ) : (
        <client.RenderSlot.Controlled
          app={instanceApp}
          slot="page"
          view="/"
          status="loading"
        />
      )}
    </client.Provider>
  );
  const view = render(content(overview, "ready"));
  await waitFor(() =>
    expect(requests.at(-1)?.props.instance).toEqual(overview)
  );
  view.rerender(content(summary, "ready"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(summary));
  view.rerender(content(summary, "loading"));
  expect(requests.at(-1)?.props).not.toHaveProperty("instance");
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("reports a missing controlled instance and recovers when one is supplied", async () => {
  const content = (instance?: typeof overview) => (
    <client.Provider>
      <RenderSlot.Controlled
        app={instanceApp}
        slot="page"
        view="/"
        status="ready"
        context={{ user: { id: "explicit" } }}
        instance={instance}
      />
    </client.Provider>
  );
  const view = render(content());
  expect(screen.getByRole("alert").textContent).toContain(
    "Pass instance to RenderSlot.Controlled"
  );
  expect(requests).toHaveLength(0);
  view.rerender(content(overview));
  await waitFor(() =>
    expect(requests.at(-1)?.props.instance).toEqual(overview)
  );
});

it("rejects instance keys and controlled instances for single-instance slots at runtime", async () => {
  const singleApp = {
    ...app,
    views: [{ instances: true as const, path: "/", slot: "navbar" }],
  };
  const rendered = render(
    <client.Provider>
      <Context />
      <RenderSlot app={singleApp} slot="navbar" instanceKey="overview" />
    </client.Provider>
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      'Slot "navbar" does not support instances.'
    )
  );
  expect(requests).toHaveLength(0);
  rendered.rerender(
    <client.Provider>
      <RenderSlot.Controlled
        app={app}
        slot="navbar"
        view="/"
        status="ready"
        context={{ user: { id: "u1" } }}
        instance={overview}
      />
    </client.Provider>
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      'Slot "navbar" does not support instances.'
    )
  );
  expect(requests).toHaveLength(0);
});
