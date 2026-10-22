import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@patchsmith/client-platform/client";
import * as v from "valibot";

import { httpPolicy } from "#server/http";
import { listApps } from "#server/list-apps";
import { platformAppSelector } from "#server/platform-app-selector";
import {
  getPatchsmithScope,
  getPatchsmithScopes,
  o,
  requireCliDeployToken,
  requireHostAuth,
} from "#server/procedures";
import { selectPatchsmithScopes } from "#server/scope";

const paginationInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  pageSize: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
  ),
});

const appInput = v.object({
  description: v.nullable(v.string()),
  name: v.string(),
  slug: v.optional(v.string()),
});

export const appRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(v.strictObject(appInput.entries))
    .handler(async ({ context, input }) => {
      const { data } = await appsCreate({
        body: { ...input, scope: getPatchsmithScope(context) },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });

      return data;
    }),
  delete: o
    .use(requireCliDeployToken)
    .input(v.object({ appId: v.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDelete({
          body: {
            app: platformAppSelector(input.appId),
            scope: getPatchsmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(v.object({ appId: v.string(), deploymentId: v.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: {
            app: platformAppSelector(input.appId),
            deploymentId: input.deploymentId,
            scope: getPatchsmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  get: o
    .use(requireCliDeployToken)
    .input(
      v.object({ appId: v.string(), scopes: v.optional(v.array(v.string())) })
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsGet({
        body: {
          app: platformAppSelector(input.appId),
          scopes: getPatchsmithScopes(context, input.scopes),
        },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });

      return data;
    }),
  list: o
    .use(requireCliDeployToken)
    .input(
      v.optional(
        v.object({
          ...paginationInput.entries,
          scopes: v.optional(v.array(v.string())),
        })
      )
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsList({
        body: {
          page: input?.page,
          pageSize: input?.pageSize,
          scopes: getPatchsmithScopes(context, input?.scopes),
        },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });

      return data;
    }),
  update: o
    .use(requireCliDeployToken)
    .input(
      v.strictObject({
        appId: v.string(),
        ...v.omit(appInput, ["slug"]).entries,
      })
    )
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            app: platformAppSelector(input.appId),
            description: input.description,
            name: input.name,
            scope: getPatchsmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
};

/** Browser discovery uses host authentication; CLI app operations keep deploy-token authentication. */
export const discoverApps = o
  .meta(
    openapi({ method: "GET", path: "/apps" }),
    httpPolicy({ authenticate: true })
  )
  .use(requireHostAuth)
  .input(
    v.object({
      scopes: v.optional(
        v.union([
          v.pipe(
            v.string(),
            v.transform((name) => [name])
          ),
          v.array(v.string()),
        ])
      ),
    })
  )
  .handler(async ({ context, input }) => {
    const names = input.scopes;

    let scopes;

    try {
      scopes =
        names?.length === 1 && names[0] === ""
          ? []
          : selectPatchsmithScopes(context.patchsmith.scopes, names);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error ? error.message : "Invalid scope selection.",
      });
    }

    return scopes.length
      ? await listApps(context, scopes, context.request.signal)
      : [];
  });
