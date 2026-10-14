import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@tailorkit/client-platform/client";
import { z } from "zod";

import {
  getTailorKitScope,
  getTailorKitScopes,
  o,
  requireCliDeployToken,
} from "#server/procedures";

const paginationInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const appInput = z.object({
  description: z.string().nullable(),
  name: z.string(),
});

export const appRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(appInput.strict())
    .handler(async ({ context, input }) => {
      const { data } = await appsCreate({
        body: { ...input, scope: getTailorKitScope(context) },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });
      return data;
    }),
  delete: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDelete({
          body: { scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string(), deploymentId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: {
            deploymentId: input.deploymentId,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
  get: o
    .use(requireCliDeployToken)
    .input(
      z.object({ appId: z.string(), scopes: z.array(z.string()).optional() })
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsGet({
        body: { scopes: getTailorKitScopes(context, input.scopes) },
        client: context.platform,
        headers: context.platformHeaders,
        path: { appId: input.appId },
        responseStyle: "fields",
        throwOnError: true,
      });
      return data;
    }),
  list: o
    .use(requireCliDeployToken)
    .input(
      paginationInput
        .extend({ scopes: z.array(z.string()).optional() })
        .optional()
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsList({
        body: {
          page: input?.page,
          pageSize: input?.pageSize,
          scopes: getTailorKitScopes(context, input?.scopes),
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
    .input(z.object({ appId: z.string() }).extend(appInput.shape))
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            description: input.description,
            name: input.name,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
};
