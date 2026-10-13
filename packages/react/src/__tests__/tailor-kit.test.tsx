import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { createTailorKitStore } from "@tailorkit/client-core";
import { defineContract } from "@tailorkit/core/schema";
import type { IframeUiHost } from "@tailorkit/sandbox/host";
import type {
  RemoteProps,
  HostToIframePayload,
  RemoteNode,
} from "@tailorkit/sandbox/protocol";
import {
  act,
  cleanup,
  render,
  screen as testingView,
  waitFor,
} from "@testing-library/react";
import { createElement, StrictMode } from "react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { useApps } from "../hooks/use-apps";
import { RenderSlot } from "../index";
import { RemoteViewHost } from "../remote-view";
import { createClient } from "../tailorkit";
import type { TailorKitApp } from "../tailorkit";

const hostRecords: {
  appUrl: string;
  props: RemoteProps | undefined;
  sourceText?: string;
}[] = [];

vi.mock("@tailorkit/sandbox/host", () => ({
  createIframeUiHost: (
    appUrl: string | URL,
    options: { props?: RemoteProps; sourceText?: string } = {}
  ): IframeUiHost => {
    const record = {
      appUrl: appUrl.toString(),
      props: options.props,
      sourceText: options.sourceText,
    };
    hostRecords.push(record);

    const tree: RemoteNode = {
      children: [
        {
          id: `text-${hostRecords.length}`,
          kind: "text",
          text: appUrl.toString(),
        },
      ],
      id: `root-${hostRecords.length}`,
      kind: "element",
      props: {},
      type: appUrl.toString().includes("missing-component")
        ? "MissingComponent"
        : "Button",
    };
    let listener: (() => void) | null = null;

    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    return {
      destroy: () => {},
      dispatch: (_payload: HostToIframePayload) => {},
      getSnapshot: () => tree,
      iframe: document.createElement("iframe"),
      mount: () => {
        listener?.();
      },
      setProps: (props: RemoteProps | undefined) => {
        record.props = props;
      },
      subscribe: (nextListener: () => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
    } as IframeUiHost;
  },
}));

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const emptySchema: StandardSchemaV1<unknown, Record<never, never>> &
  StandardJSONSchemaV1<unknown, Record<never, never>> = {
  "~standard": {
    jsonSchema: {
      input: () => ({}),
      output: () => ({}),
    },
    validate: (
      value: Parameters<StandardSchemaV1["~standard"]["validate"]>[0]
    ) => ({ value: value as Record<never, never> }),
    vendor: "test",
    version: 1,
  },
} as const;

const contract = defineContract({
  components: {
    Button: { children: true },
  },
  scopes: {
    organization: emptySchema,
    test: emptySchema,
    user: emptySchema,
  },
  slots: {
    navbar: { views: ["/"] },
    panel: { views: ["/", "/home", "/home/detail", "/user"] },
  },
  views: {
    "/": emptySchema,
    "/home": emptySchema,
    "/home/detail": emptySchema,
    "/user": emptySchema,
  },
});

const components = {
  Button: ({ children }: { children?: ReactNode }) =>
    createElement("button", { type: "button" }, children),
};

const CurrentViewRoute = ({
  nested,
  tailor,
}: {
  nested: boolean;
  tailor: ReturnType<typeof createClient<typeof contract>>;
}) => {
  const { useViewContext } = tailor;
  // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
  useViewContext(
    nested ? "/home/detail" : "/home",
    nested
      ? {
          context: { detail: { id: "profile" } },
        }
      : {
          context: { page: { title: "home" } },
        }
  );

  return (
    <RenderSlot
      slot="panel"
      app={{ clientPath: "/apps/todo.js", id: "todo" }}
    />
  );
};

const CurrentViewHost = ({
  nested,
  tailor,
}: {
  nested: boolean;
  tailor: ReturnType<typeof createClient<typeof contract>>;
}) => (
  <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
    <CurrentViewRoute nested={nested} tailor={tailor} />
  </tailor.Provider>
);

const HomeSlot = ({
  app,
  tailor,
}: {
  app: TailorKitApp;
  tailor: ReturnType<typeof createClient<typeof contract>>;
}) => {
  const { useViewContext } = tailor;
  // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
  useViewContext("/home", { context: { page: { title: "home" } } });
  return <RenderSlot slot="panel" app={app} />;
};

describe("tailorKitClient React adapter", () => {
  it("recreates the sandbox when a complete preview source revision changes", () => {
    const { rerender } = render(
      <RemoteViewHost
        appUrl="https://host.test/client.js"
        sourceText="one"
        components={{ Button: () => null }}
      />
    );
    expect(hostRecords.at(-1)?.sourceText).toBe("one");
    rerender(
      <RemoteViewHost
        appUrl="https://host.test/client.js"
        sourceText="two"
        components={{ Button: () => null }}
      />
    );
    expect(hostRecords.at(-1)?.sourceText).toBe("two");
    expect(hostRecords).toHaveLength(2);
  });
  beforeEach(() => {
    hostRecords.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        assetsBaseUrl: "http://assets.test/",
        schema: {},
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a preview subscription when an inline app is rendered again", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) =>
      Promise.resolve(
        input instanceof URL && input.pathname.endsWith("/preview/metadata")
          ? new Response(null, { status: 503 })
          : Response.json({ assetsBaseUrl: "http://assets.test/", schema: {} })
      )
    );
    class PreviewSocket extends EventTarget {
      static instances: PreviewSocket[] = [];
      closed = false;
      readonly protocol: string;

      constructor(_url: string, protocol: string) {
        super();
        this.protocol = protocol;
        PreviewSocket.instances.push(this);
      }

      close() {
        this.closed = true;
        this.dispatchEvent(new Event("close"));
      }
    }
    vi.stubGlobal("WebSocket", PreviewSocket);
    const tailor = createClient({
      baseUrl: "http://runtime.test/api/tailorkit",
      components,
      contract,
    });
    const suppliedApps: TailorKitApp[] = [];
    const content = (token: string) => (
      <tailor.Provider apps={suppliedApps}>
        <HomeSlot
          tailor={tailor}
          app={{
            clientPath: "/apps/preview.js",
            id: "preview",
            preview: {
              expiresAt: "later",
              sessionId: "session",
              token,
              websocketUrl: "wss://platform.test/preview",
            },
          }}
        />
      </tailor.Provider>
    );
    const view = render(content("initial-token"));
    await waitFor(() => expect(PreviewSocket.instances).toHaveLength(1));
    const metadataRequest = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input]) => input)
      .find(
        (input) =>
          input instanceof URL && input.pathname.endsWith("/preview/metadata")
      );
    expect(metadataRequest).toBeInstanceOf(URL);
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    expect(
      new URL(metadataRequest as URL).searchParams.getAll("scopes")
    ).toEqual([]);
    const [socket] = PreviewSocket.instances;
    view.rerender(content("updated-token"));
    expect(PreviewSocket.instances).toHaveLength(1);
    expect(socket?.closed).toBe(false);
    socket?.close();
    await waitFor(() => expect(PreviewSocket.instances).toHaveLength(2), {
      timeout: 2500,
    });
    expect(PreviewSocket.instances[1]?.protocol).toBe("updated-token");
    view.unmount();
    expect(PreviewSocket.instances[1]?.closed).toBe(true);
  });

  it("fetches and caches apps", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([{ id: "todo", name: "Todo", scope: { name: "user" } }])
    );
    const tailor = createClient({
      baseUrl: "http://runtime.test/api/tailorkit",
      components,
      contract,
    });

    const AppList = () => {
      const { data, isPending } = tailor.useApps({
        scopes: ["organization", "user"],
      });
      return createElement(
        "p",
        null,
        `${isPending ? "pending" : "ready"}:${(data ?? []).map((app) => app.id).join(",")}`
      );
    };

    render(
      <tailor.Provider>
        <AppList />
        <AppList />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(testingView.getAllByText("ready:todo")).toHaveLength(2);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("apps", "http://runtime.test/api/tailorkit/"),
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("filters scope selections locally using one shared request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        { id: "organization", scope: { name: "organization" } },
        { id: "user", scope: { name: "user" } },
      ])
    );
    const tailor = createClient({
      baseUrl: "http://runtime.test/api/tailorkit",
      components,
      contract,
    });
    const AppList = ({
      label,
      scopes,
    }: {
      label: string;
      scopes?: readonly ("organization" | "user")[];
    }) => {
      const { data, isPending } = tailor.useApps({ scopes });
      return (
        <p>
          {label}:{isPending ? "pending" : "ready"}:
          {data?.map((app) => app.id).join(",")}
        </p>
      );
    };
    render(
      <tailor.Provider>
        <AppList label="org" scopes={["organization"]} />
        <AppList label="user" scopes={["user"]} />
        <AppList label="all" />
        <AppList label="empty" scopes={[]} />
      </tailor.Provider>
    );
    await waitFor(() =>
      expect(testingView.getByText("all:ready:organization,user")).toBeTruthy()
    );
    expect(testingView.getByText("org:ready:organization")).toBeTruthy();
    expect(testingView.getByText("user:ready:user")).toBeTruthy();
    expect(testingView.getByText("empty:ready:")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains app discovery across subscriber unmounts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([]));
    const store = createTailorKitStore({
      baseUrl: "http://runtime.test/api/tailorkit",
      contract,
    });
    const idle = store.getAppsSnapshot();
    expect(store.getAppsSnapshot()).toBe(idle);
    const unsubscribe = store.subscribeApps(() => {});
    await store.fetchApps();
    const ready = store.getAppsSnapshot();
    unsubscribe();
    expect(store.getAppsSnapshot()).toBe(ready);
    const stop = store.subscribeApps(() => {});
    await store.fetchApps();
    stop();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to all scopes when useApps omits a selection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]));
    const tailor = createClient({
      baseUrl: "http://runtime.test/api/tailorkit",
      contract,
    });

    const AppList = () => {
      const { isPending } = tailor.useApps();
      return createElement("p", null, isPending ? "pending" : "ready");
    };

    render(
      <tailor.Provider>
        <AppList />
      </tailor.Provider>
    );

    await waitFor(() => expect(testingView.getByText("ready")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("apps", "http://runtime.test/api/tailorkit/"),
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("derives the hierarchy from the current view and reuses its extended context", async () => {
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });

    const view = render(<CurrentViewHost nested tailor={tailor} />);

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { detail: { id: "profile" } },
            path: "/home/detail",
            status: "ready",
          },
        ],
      });
    });

    await act(() => {
      view.rerender(<CurrentViewHost nested={false} tailor={tailor} />);
    });

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { page: { title: "home" } },
            path: "/home",
            status: "ready",
          },
        ],
      });
    });
  });

  it("publishes loading and error states without stale context", async () => {
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });

    const Route = ({ status }: { status: "error" | "loading" }) => {
      const { useViewContext } = tailor;
      // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
      useViewContext("/home/detail", {
        context: undefined,
        error: status === "error" ? new Error("Failed to load context") : null,
        loading: status === "loading",
      });
      return (
        <RenderSlot
          slot="panel"
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
        />
      );
    };

    const view = render(
      <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <Route status="loading" />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          { context: undefined, path: "/home/detail", status: "loading" },
        ],
      });
    });

    view.rerender(
      <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <Route status="error" />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [{ context: undefined, path: "/home/detail", status: "error" }],
      });
    });
  });

  it("renders the current match for multiple direct app props", async () => {
    hostRecords.length = 0;
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });

    const Route = () => {
      const { useViewContext } = tailor;
      // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
      useViewContext("/home", { context: { page: { title: "home" } } });
      return (
        <>
          <RenderSlot
            slot="panel"
            app={{ clientPath: "/apps/b.js", id: "b" }}
          />
          <RenderSlot
            slot="panel"
            app={{
              currentDeployment: { id: "deployment_1" },
              id: "a",
              projectId: "project_1",
            }}
          />
        </>
      );
    };

    render(
      <tailor.Provider
        apps={[
          { clientPath: "/apps/b.js", id: "b" },
          {
            currentDeployment: { id: "deployment_1" },
            id: "a",
            projectId: "project_1",
          },
        ]}
      >
        <Route />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(hostRecords).toHaveLength(2);
    });
    expect(hostRecords.map((record) => record.appUrl)).toEqual([
      "http://runtime.test/apps/b.js",
      "http://assets.test/projects/project_1/apps/a/deployments/deployment_1/client/client.js",
    ]);
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    expect(
      hostRecords.map((record) => (record.props?.layers as unknown[])?.[0])
    ).toEqual([
      { context: { page: { title: "home" } }, path: "/home", status: "ready" },
      { context: { page: { title: "home" } }, path: "/home", status: "ready" },
    ]);
  });

  it("renders a controlled view without a registered current view", async () => {
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });
    const { RenderSlot: ClientRenderSlot } = tailor;

    render(
      <tailor.Provider>
        <ClientRenderSlot.Controlled
          slot="panel"
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
          context={{ userId: "user_1" }}
          view="/user"
          status="ready"
        />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        context: { userId: "user_1" },
        controlled: true,
        status: "ready",
        view: "/user",
      });
    });
  });

  it("rejects a client RenderSlot rendered under a different client Provider", () => {
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });
    const otherTailor = createClient({
      baseUrl: "http://other-runtime.test",
      components,
      contract,
    });
    const { RenderSlot: ClientRenderSlot } = tailor;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <otherTailor.Provider>
          <ClientRenderSlot
            slot="panel"
            app={{ clientPath: "/apps/todo.js", id: "todo" }}
          />
        </otherTailor.Provider>
      )
    ).toThrow(
      "RenderSlot was created for a different TailorKit client than the surrounding Provider."
    );
  });

  it("warns when multiple hooks register views at the same hierarchy depth", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });

    const HomeRoute = () => {
      const { useViewContext } = tailor;
      // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
      useViewContext("/home", { context: { page: { title: "home" } } });
      return null;
    };

    const UserRoute = () => {
      const { useViewContext } = tailor;
      // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
      useViewContext("/user", { context: { userId: "user_1" } });
      return (
        <RenderSlot
          slot="panel"
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
        />
      );
    };

    render(
      <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeRoute />
        <UserRoute />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('"/home", "/user"')
      );
    });
  });

  it("passes primitive theme tokens into mounted views", async () => {
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
      theme: {
        tokens: {
          background: {
            surface: "var(--card)",
          },
        },
      },
    });

    render(
      <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeSlot
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
          tailor={tailor}
        />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(hostRecords).toHaveLength(1);
    });
    expect(
      document.querySelector("[data-tailorkit-theme-style]")?.textContent
    ).toContain("--tailorkit-background-surface: var(--card);");
  });

  it("renders missing component errors inside the app container", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      contract,
    });

    render(
      <tailor.Provider apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeSlot
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
          tailor={tailor}
        />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(
        testingView.getByText('TailorKit component "Button" is not registered.')
      ).toBeTruthy();
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("clears a missing component error when switching apps", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tailor = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });

    const view = render(
      <tailor.Provider
        apps={[{ clientPath: "/apps/missing-component.js", id: "bad" }]}
      >
        <HomeSlot
          app={{ clientPath: "/apps/missing-component.js", id: "bad" }}
          tailor={tailor}
        />
      </tailor.Provider>
    );

    await waitFor(() => {
      expect(
        testingView.getByText(
          'TailorKit component "MissingComponent" is not registered.'
        )
      ).toBeTruthy();
    });

    await act(() => {
      view.rerender(
        <tailor.Provider apps={[{ clientPath: "/apps/email.js", id: "email" }]}>
          <HomeSlot
            app={{ clientPath: "/apps/email.js", id: "email" }}
            tailor={tailor}
          />
        </tailor.Provider>
      );
    });

    await waitFor(() => {
      expect(
        testingView.queryByText(
          'TailorKit component "MissingComponent" is not registered.'
        )
      ).toBeNull();
      expect(testingView.getByRole("button").textContent).toContain(
        "/apps/email.js"
      );
    });
  });
});

const DetailImplementation = ({
  client,
}: {
  client: ReturnType<typeof createClient<typeof contract>>;
}) => {
  const { useViewContext } = client;
  // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
  useViewContext("/home/detail", { context: undefined, loading: true });
  return null;
};

describe("view registries", () => {
  beforeEach(() => {
    hostRecords.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ schema: {} }))
    );
  });

  afterEach(cleanup);

  const Detail = DetailImplementation;

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep the generator or mutable callback with its owning test or cancellation lifecycle.
  const Layers = ({
    client,
    detail = true,
  }: {
    client: ReturnType<typeof createClient<typeof contract>>;
    detail?: boolean;
  }) => {
    const { useViewContext } = client;
    // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
    useViewContext("/", { context: { user: { id: "u1" } } });
    // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
    useViewContext("/home", { context: { page: { title: "Home" } } });
    return (
      <>
        {detail ? <Detail client={client} /> : null}
        <RenderSlot slot="navbar" app={{ clientPath: "/nav.js", id: "nav" }} />
        <RenderSlot
          slot="panel"
          app={{ clientPath: "/panel.js", id: "panel" }}
        />
      </>
    );
  };

  it("publishes the same active chain to simultaneous slots and removes unmounted layers", async () => {
    const client = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });
    const view = render(
      <client.Provider>
        <Layers client={client} />
      </client.Provider>
    );
    await waitFor(() => expect(hostRecords).toHaveLength(2));
    expect(hostRecords.map((record) => record.props?.slot)).toEqual([
      "navbar",
      "panel",
    ]);
    expect(hostRecords[0]?.props).toMatchObject({
      layers: [
        { context: { user: { id: "u1" } }, path: "/", status: "ready" },
        {
          context: { page: { title: "Home" } },
          path: "/home",
          status: "ready",
        },
        { path: "/home/detail", status: "loading" },
      ],
      view: "/home/detail",
    });
    view.rerender(
      <client.Provider>
        <Layers client={client} detail={false} />
      </client.Provider>
    );
    await waitFor(() => expect(hostRecords.at(-1)?.props?.view).toBe("/home"));
    expect(hostRecords.at(-1)?.props?.layers).toHaveLength(2);
    // Context changes must not remount either slot.
    expect(hostRecords).toHaveLength(2);
  });

  it("isolates roots sharing a client and survives Strict Mode effect replay", async () => {
    const client = createClient({
      assetsBaseUrl: "http://assets.test/",
      baseUrl: "http://runtime.test",
      components,
      contract,
    });
    const OtherRoute = () => {
      const { useViewContext } = client;
      // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
      useViewContext("/user", { context: { userId: "other" } });
      return (
        <RenderSlot
          slot="panel"
          app={{ clientPath: "/other.js", id: "other" }}
        />
      );
    };
    render(
      <StrictMode>
        <client.Provider>
          <Layers client={client} />
        </client.Provider>
        <client.Provider>
          <OtherRoute />
        </client.Provider>
      </StrictMode>
    );
    await waitFor(() =>
      expect(
        hostRecords.some((record) => record.appUrl.endsWith("other.js"))
      ).toBe(true)
    );
    const other = hostRecords.find((record) =>
      record.appUrl.endsWith("other.js")
    );
    expect(other?.props).toMatchObject({
      layers: [{ context: { userId: "other" }, path: "/user" }],
      view: "/user",
    });
    expect(other?.props?.layers).toHaveLength(1);
    expect(
      hostRecords.find((record) => record.appUrl.endsWith("panel.js"))?.props
        ?.view
    ).toBe("/home/detail");
  });
});

const createRootClientImplementation = (baseUrl: string | URL) =>
  createClient({ baseUrl, components, contract });

const ContentsImplementation = ({
  client,
}: {
  client: ReturnType<typeof createClient<typeof contract>>;
}) => {
  const { useApps: useAppsValue, useViewContext } = client;
  // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
  const { data } = useAppsValue();
  // oxlint-disable-next-line react/hooks -- This test uses hooks from a client created once outside render; the compiler cannot infer that lifetime.
  useViewContext("/user", { context: { userId: "u1" } });
  return (
    <>
      <span>{data?.[0]?.id}</span>
      <RenderSlot slot="panel" app={{ clientPath: "client.js", id: "test" }} />
    </>
  );
};

it("isolates a new client cache even when its endpoint is equivalent", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => {
      const url = new URL(input.toString());
      return Promise.resolve(
        Response.json(
          url.pathname.endsWith("/apps")
            ? [{ id: url.hostname }]
            : { schema: {} }
        )
      );
    });
  const Contents = ContentsImplementation;
  const createRootClient = createRootClientImplementation;
  const firstClient = createRootClient("http://first.test/api");
  const view = render(
    <firstClient.Provider>
      <Contents client={firstClient} />
    </firstClient.Provider>
  );
  await waitFor(() => expect(testingView.getByText("first.test")).toBeTruthy());
  const count = fetchMock.mock.calls.length;
  const equivalentClient = createRootClient(new URL("http://first.test/api/"));
  view.rerender(
    <equivalentClient.Provider>
      <Contents client={equivalentClient} />
    </equivalentClient.Provider>
  );
  await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(count + 1));
  const secondClient = createRootClient("http://second.test/api");
  view.rerender(
    <secondClient.Provider>
      <Contents client={secondClient} />
    </secondClient.Provider>
  );
  await waitFor(() =>
    expect(testingView.getByText("second.test")).toBeTruthy()
  );
  await waitFor(() =>
    expect(hostRecords.at(-1)?.appUrl).toBe("http://second.test/api/client.js")
  );
  expect(hostRecords.at(-1)?.props?.view).toBe("/user");
  view.unmount();
});

const ContentsImplementation2 = () => {
  const { data } = useApps();
  return <span>{data?.[0]?.id}</span>;
};

it("keeps each provider bound to its client's fetch transport", async () => {
  const explicitFetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json([{ id: "explicit-user" }]))
    );
  const fallbackFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(Response.json([{ id: "fallback-user" }]))
    );
  const client = createClient({
    baseUrl: "http://runtime.test/api",
    components,
    contract,
    fetch: explicitFetch,
  });
  const fallback = createClient({
    baseUrl: client.baseUrl,
    components,
    contract,
  });
  const Contents = ContentsImplementation2;
  const view = render(
    <client.Provider>
      <Contents />
    </client.Provider>
  );
  await waitFor(() =>
    expect(testingView.getByText("explicit-user")).toBeTruthy()
  );
  view.rerender(
    <fallback.Provider>
      <Contents />
    </fallback.Provider>
  );
  await waitFor(() =>
    expect(testingView.getByText("fallback-user")).toBeTruthy()
  );
  view.rerender(
    <fallback.Provider>
      <Contents />
    </fallback.Provider>
  );
  expect(testingView.getByText("fallback-user")).toBeTruthy();
  expect(fallbackFetch).toHaveBeenCalledOnce();
  view.rerender(
    <client.Provider>
      <Contents />
    </client.Provider>
  );
  await waitFor(() =>
    expect(testingView.getByText("explicit-user")).toBeTruthy()
  );
  expect(explicitFetch).toHaveBeenCalledOnce();
  expect(fallbackFetch).toHaveBeenCalledOnce();
  view.unmount();
});

it("retains equivalent explicit context identity and publishes changed values", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ schema: {} }))
  );
  const client = createClient({
    assetsBaseUrl: "http://assets.test/",
    baseUrl: "http://runtime.test",
    components,
    contract,
  });
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep the generator or mutable callback with its owning test or cancellation lifecycle.
  const content = (userId: string) => (
    <client.Provider>
      <RenderSlot.Controlled
        slot="panel"
        view="/user"
        context={{ userId }}
        app={{ clientPath: "/client.js", id: "test" }}
        status="ready"
      />
    </client.Provider>
  );
  const view = render(content("u1"));
  await waitFor(() => expect(hostRecords.at(-1)?.props?.view).toBe("/user"));
  const initialProps = hostRecords.at(-1)?.props;
  view.rerender(content("u1"));
  expect(hostRecords.at(-1)?.props).toBe(initialProps);
  view.rerender(content("u2"));
  await waitFor(() =>
    expect(hostRecords.at(-1)?.props?.context).toEqual({ userId: "u2" })
  );
  view.unmount();
});

describe("supplied app discovery", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const Apps = () => {
    // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
    const { data, isPending, fetch } = client.useApps();
    return (
      <button type="button" onClick={() => fetch()}>
        {isPending ? "pending" : "ready"}:{data?.map((app) => app.id).join(",")}
      </button>
    );
  };
  const client = createClient({ baseUrl: "https://apps.test/api/", contract });

  it("uses supplied apps for discovery, including updates and empty lists, without fetching", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const view = render(
      <client.Provider apps={[{ id: "first" }]}>
        <Apps />
      </client.Provider>
    );
    expect(testingView.getByText("ready:first")).toBeTruthy();
    expect(view.container.childElementCount).toBe(1);
    expect(view.container.firstElementChild).toBe(
      testingView.getByRole("button")
    );
    await act(() => testingView.getByRole("button").click());
    view.rerender(
      <client.Provider apps={[{ id: "second" }]}>
        <Apps />
      </client.Provider>
    );
    await waitFor(() =>
      expect(testingView.getByText("ready:second")).toBeTruthy()
    );
    view.rerender(
      <client.Provider apps={[]}>
        <Apps />
      </client.Provider>
    );
    await waitFor(() => expect(testingView.getByText("ready:")).toBeTruthy());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores an in-flight fetch when apps are supplied and resumes fetching when removed", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        (() => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            resolveRequest = resolve;
          } catch (error) {
            rejectPending(error);
          }
          return pendingPromise;
        })()
      )
      .mockResolvedValue(Response.json([{ id: "fresh" }]));
    const view = render(
      <client.Provider>
        <Apps />
      </client.Provider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(
      <client.Provider apps={[{ id: "provided" }]}>
        <Apps />
      </client.Provider>
    );
    await waitFor(() =>
      expect(testingView.getByText("ready:provided")).toBeTruthy()
    );
    await act(() => {
      resolveRequest(Response.json([{ id: "stale" }]));
    });
    expect(testingView.getByText("ready:provided")).toBeTruthy();
    view.rerender(
      <client.Provider>
        <Apps />
      </client.Provider>
    );
    await waitFor(() =>
      expect(testingView.getByText("ready:fresh")).toBeTruthy()
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

it("updates component renderers without recreating the remote sandbox", async () => {
  const appUrl = "https://apps.example/client.js";
  const props = { example: true };
  const { rerender } = render(
    <RemoteViewHost appUrl={appUrl} components={components} props={props} />
  );
  await waitFor(() =>
    expect(testingView.getByRole("button").textContent).toBe(appUrl)
  );
  const mounted = hostRecords.length;
  const replacement = {
    Button: ({ children }: { children?: ReactNode }) =>
      createElement("a", { href: "/" }, children),
  };
  rerender(
    <RemoteViewHost appUrl={appUrl} components={replacement} props={props} />
  );
  await waitFor(() =>
    expect(testingView.getByRole("link").textContent).toBe(appUrl)
  );
  expect(hostRecords).toHaveLength(mounted);
  expect(testingView.queryByRole("button")).toBeNull();
});
