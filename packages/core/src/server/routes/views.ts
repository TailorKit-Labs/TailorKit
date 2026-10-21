import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import type { ViewInstance } from "@patchsmith/app/client";
import { createClient, reference } from "@patchsmith/app/client/connection";

import type { PatchsmithSchema } from "#schema/schema";
import { httpPolicy, recordHttpTiming } from "#server/http";
import { o, requireHostAuth } from "#server/procedures";
import { discoverViewApps } from "#server/runtime-discovery";
import { selectPatchsmithScopes } from "#server/scope";
import {
  composeViewContext,
  getViewHierarchy,
  selectSlotView,
  viewsInputSchema,
  viewsResultSchema,
} from "#views";
import type { ViewsResult, ViewLayer, ViewContextValues } from "#views";

const resolver = reference<
  "action",
  { slot: string; path: string; context: ViewContextValues },
  ViewInstance[]
>("_patchsmith.instances.resolve", "action");

const validateLayers = async (
  schema: PatchsmithSchema,
  paths: Set<string>,
  layers: ViewLayer[]
) =>
  await Promise.all(
    layers.map(async (layer) => {
      const validator = Object.entries(schema.views).find(
        ([path]) => path === layer.path
      )?.[1];

      if (!paths.has(layer.path) || layer.status !== "ready" || !validator) {
        return layer;
      }

      const parsed = await validator["~standard"].validate(layer.context);

      if (parsed.issues) {
        throw new Error(`Invalid context for view "${layer.path}".`);
      }

      return { ...layer, context: parsed.value };
    })
  );

/** Discover authorized installations and run their generated instance actions on the host. */
export const views = o
  .meta(
    openapi({ method: "POST", path: "/views" }),
    httpPolicy({ authTiming: "views_auth", authenticate: true, json: true })
  )
  .use(requireHostAuth)
  .input(viewsInputSchema)
  .output(viewsResultSchema)
  .handler(async ({ context, input }) => {
    const { request, schema } = context;
    const viewer = context.patchsmith;

    const recordTiming = (stage: string, started: number) => {
      recordHttpTiming(context, stage, started);
    };

    let scopes;

    try {
      scopes =
        input.scopes?.length === 0
          ? []
          : selectPatchsmithScopes(viewer.scopes, input.scopes);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid views request" });
    }

    const definition = schema.slots[input.slot];

    if (!definition || !scopes.length || input.appIds?.length === 0) {
      return { data: [], status: "ready" };
    }

    if (definition.multiple === true && input.activeView === null) {
      return { status: "idle" };
    }

    const controller = new AbortController();

    const abort = () => {
      controller.abort();
    };

    request.signal.addEventListener("abort", abort, { once: true });

    try {
      request.signal.throwIfAborted();

      const discoveryStarted = performance.now();

      const { apps: discovered, sessions } = await discoverViewApps(
        context,
        input,
        definition,
        viewer,
        scopes,
        context.toolUrl,
        controller.signal
      );

      recordTiming("views_discovery", discoveryStarted);

      const apps = discovered.filter(
        (app) => input.appIds === undefined || input.appIds.includes(app.id)
      );

      if (definition.multiple !== true) {
        return {
          data: apps
            .filter((app) =>
              app.views?.some(
                (view) =>
                  view.slot === input.slot &&
                  !view.disabled &&
                  !view.instances &&
                  definition.views.includes(view.path)
              )
            )
            .map((app) => ({ app })),
          status: "ready",
        };
      }

      const active = input.activeView;

      if (!active) {
        return { status: "idle" };
      }

      const matches = apps.flatMap((app) => {
        const view = selectSlotView(
          app.views ?? [],
          input.slot,
          active.view,
          schema
        );

        return view?.instances ? [{ app, view }] : [];
      });

      const paths = new Set(
        matches.flatMap(({ view }) => getViewHierarchy(view.path))
      );

      let layers;

      try {
        layers = await validateLayers(schema, paths, active.layers);
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid view context" });
      }

      const resolved = matches.map(({ app, view }) => ({
        app,
        props: composeViewContext(view.path, {
          declaredViews: Object.keys(schema.views),
          layers,
        }),
      }));

      if (resolved.some(({ props }) => props.status === "error")) {
        throw new ORPCError("BAD_REQUEST", {
          message: "View context is unavailable",
        });
      }

      if (resolved.some(({ props }) => props.status === "loading")) {
        return { status: "loading" };
      }

      const instancesStarted = performance.now();

      const data = await Promise.all(
        resolved.map(async ({ app, props }) => {
          if (props.status !== "ready") {
            return [];
          }

          const backend = createClient({
            // oxlint-disable-next-line require-await -- The async provider returns this request's already authorized session without I/O.
            getSession: async () => {
              const session = sessions.get(app.id);

              if (!session) {
                throw new Error("Missing discovered runtime session");
              }

              return session;
            },
          });

          const close = () => {
            backend.close();
          };

          controller.signal.addEventListener("abort", close, { once: true });

          try {
            controller.signal.throwIfAborted();

            const instances = await backend.action(resolver, {
              context: props.context,
              path: props.view,
              slot: input.slot,
            });

            return instances.map((instance) => ({ ...instance, app }));
          } finally {
            controller.signal.removeEventListener("abort", close);
            backend.close();
          }
        })
      );

      recordTiming("views_instances", instancesStarted);

      const result: ViewsResult = { data: data.flat(), status: "ready" };

      return result;
    } catch (error) {
      controller.abort();

      if (error instanceof ORPCError) {
        throw error;
      }

      throw new ORPCError("BAD_GATEWAY", {
        message: "Unable to resolve views",
      });
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  });
