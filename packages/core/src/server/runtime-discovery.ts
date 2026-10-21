import { appsRuntimeDiscover } from "@patchsmith/client-platform/client";
import type {
  AppsRuntimeDiscoverData,
  AppsRuntimeDiscoverResponses,
} from "@patchsmith/client-platform/client/types.gen";

import { getViewHierarchy } from "#views";
import type { ViewsInput } from "#views";

import type { Context, PatchsmithRuntimeContext } from "./context";
import { listApps } from "./list-apps";

/** Sessions stay on the host; the public views response contains only app metadata and instances. */
export const discoverRuntimeApps = async (
  context: Pick<Context, "platform" | "platformHeaders">,
  input: Omit<AppsRuntimeDiscoverData["body"], "page" | "pageSize">,
  signal: AbortSignal
): Promise<AppsRuntimeDiscoverResponses[200]["items"]> => {
  const items: AppsRuntimeDiscoverResponses[200]["items"] = [];
  let page = 1;

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- Each discovery page depends on the preceding pagination response.
    const { data } = await appsRuntimeDiscover({
      body: { ...input, page, pageSize: 100 },
      client: context.platform,
      headers: context.platformHeaders,
      responseStyle: "fields",
      signal,
      throwOnError: true,
    });

    items.push(...data.items);

    if (!data.pagination.hasMore) {
      return items;
    }

    page += 1;
  }
};

export const discoverViewApps = async (
  context: Context,
  input: ViewsInput,
  definition: { multiple?: boolean; views: readonly string[] },
  viewer: PatchsmithRuntimeContext,
  scopes: AppsRuntimeDiscoverData["body"]["scopes"],
  toolUrl: string,
  signal: AbortSignal
) => {
  const runtimeApps =
    definition.multiple === true && input.activeView
      ? await discoverRuntimeApps(
          context,
          {
            appIds: input.appIds === undefined ? undefined : [...input.appIds],
            scopes,
            slot: input.slot,
            subjectId: viewer.subjectId,
            toolUrl,
            viewPaths: getViewHierarchy(input.activeView.view).filter((path) =>
              definition.views.includes(path)
            ),
          },
          signal
        )
      : null;

  return {
    apps: runtimeApps
      ? runtimeApps.map(({ app }) => app)
      : await listApps(context, scopes, signal),
    sessions: new Map(
      runtimeApps?.map(({ app, session }) => [app.id, session])
    ),
  };
};
