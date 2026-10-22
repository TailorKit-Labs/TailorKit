import { asyncFixture } from "@patchsmith/config/testing";
import { defineContract } from "@patchsmith/core/schema";
import type { ViewsResult } from "@patchsmith/core/views";
import {
  CancelledError,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createClient } from "#patchsmith";

const contract = defineContract({
  slots: { panel: { views: ["/"] } },
  views: { "/": z.object({}) },
});

const input = { activeView: null, slot: "panel" };

afterEach(cleanup);

const PanelApps = ({
  client,
}: {
  client: ReturnType<typeof createClient<typeof contract>>;
}) => {
  const { data } = useQuery({
    queryFn: async ({ signal }) => await client.api.views({ ...input, signal }),
    queryKey: ["patchsmith", "views", input],
  });

  return <p>{data?.status === "ready" ? data.data[0]?.app.id : "pending"}</p>;
};

it("lets React Query deduplicate and invalidate views independently of the nanostore cache", async () => {
  let appId = "nanostore";

  const request = vi.fn<typeof fetch>().mockImplementation(
    asyncFixture(() =>
      Response.json({
        data: [{ app: { id: appId } }],
        status: "ready",
        warnings: [],
      } satisfies ViewsResult)
    )
  );

  const client = createClient({
    baseUrl: "https://host.test/api/patchsmith",
    cache: { staleTime: Infinity },
    contract,
    fetch: request,
  });

  const cached = client.fetchClient?.views(input);
  await cached?.fetch();
  appId = "tanstack";

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  try {
    render(
      <QueryClientProvider client={queryClient}>
        <PanelApps client={client} />
        <PanelApps client={client} />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(
        queryClient.getQueryState(["patchsmith", "views", input])
      ).toMatchObject({ error: null, status: "success" });
      expect(screen.getAllByText("tanstack")).toHaveLength(2);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      new URL("https://host.test/api/patchsmith/views"),
      expect.objectContaining({
        body: JSON.stringify(input),
        credentials: "same-origin",
        method: "POST",
      })
    );

    appId = "updated";
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["patchsmith", "views"],
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("updated")).toHaveLength(2);
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(cached?.getSnapshot().data).toEqual({
      data: [{ app: { id: "nanostore" } }],
      status: "ready",
      warnings: [],
    });
  } finally {
    cleanup();
    queryClient.clear();
    client.clearCache();
  }
});

it("provides validated apps and views as promises without a provider or abort signal", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: "app" }]))
    .mockResolvedValueOnce(Response.json({ status: "loading" }))
    .mockResolvedValueOnce(Response.json({ status: "idle" }))
    .mockResolvedValueOnce(
      Response.json({
        data: [{ app: { id: 1 } }],
        status: "ready",
        warnings: [],
      })
    )
    .mockResolvedValueOnce(
      new Response("Host rejected the query", { status: 403 })
    )
    .mockResolvedValueOnce(Response.json([{ id: 1 }]));

  const client = createClient({
    baseUrl: "https://host.test/",
    contract,
    fetch: request,
  });

  await expect(client.api.apps()).resolves.toEqual([{ id: "app" }]);
  await expect(client.api.views(input)).resolves.toEqual({ status: "loading" });
  await expect(client.api.views(input)).resolves.toEqual({ status: "idle" });
  await expect(client.api.views(input)).rejects.toThrow();
  await expect(client.api.views(input)).rejects.toThrow(
    "Host rejected the query"
  );
  await expect(client.api.apps()).rejects.toThrow();
});

it.each(["apps", "views"] as const)(
  "forwards React Query cancellation to the %s request",
  async (endpoint) => {
    let requestSignal: AbortSignal | null | undefined;

    const request: typeof fetch = async (_url, init) => {
      requestSignal = init?.signal;

      const { promise, reject } = Promise.withResolvers<Response>();
      requestSignal?.addEventListener("abort", () => {
        reject(new DOMException("Cancelled", "AbortError"));
      });

      return await promise;
    };

    const client = createClient({
      baseUrl: "https://host.test/",
      contract,
      fetch: request,
    });

    const queryClient = new QueryClient();
    const queryKey = ["patchsmith", endpoint];

    try {
      const pending = queryClient.query({
        queryFn: async ({ signal }) => {
          if (endpoint === "apps") {
            return await client.api.apps({ signal });
          }

          return await client.api.views({ ...input, signal });
        },
        queryKey,
      });

      const cancelled = expect(pending).rejects.toBeInstanceOf(CancelledError);
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      await queryClient.cancelQueries({ queryKey });
      expect(requestSignal?.aborted).toBe(true);
      await cancelled;
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    } finally {
      queryClient.clear();
    }
  }
);
