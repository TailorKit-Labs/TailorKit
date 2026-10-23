import type { db } from "@patchsmith/db";
import { App, AppDeployment } from "@patchsmith/db/schema/apps";
import { z } from "zod";

import type { paginationQuery } from "#pagination";
import type { scopesSchema } from "#scope";
import { canonicalizeScopes } from "#scope";

export const AppWithCurrentDeployment = App.omit({ scopeKey: true }).extend({
  clientPath: z.url().optional(),
  currentDeployment: AppDeployment.nullable(),
  logoPaths: z
    .object({ dark: z.url().optional(), light: z.url().optional() })
    .optional(),
  views: AppDeployment.shape.views,
});

export const discoverApps = async (
  database: Pick<typeof db, "query">,
  projectId: string,
  input: z.infer<typeof paginationQuery> & {
    scopes: z.infer<typeof scopesSchema>;
    appIds?: string[];
  }
) => {
  const { page, pageSize } = input;
  const scopes = canonicalizeScopes(input.scopes);

  // Browser app filters may include missing or malformed IDs; never send those to a UUID column.
  const appIds = input.appIds?.filter(
    (id) => App.shape.id.safeParse(id).success
  );

  return await database.query.app.findMany({
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
    orderBy: {
      createdAt: "desc",
      id: "desc",
    },
    where: {
      RAW: (fields, { and, eq: eqValue, or }) =>
        and(
          eqValue(fields.projectId, projectId),
          or(
            ...scopes.map(({ scope, scopeKey }) =>
              and(
                eqValue(fields.scopeKey, scopeKey),
                eqValue(fields.scope, scope)
              )
            )
          )
        ) ?? eqValue(fields.projectId, projectId),
      id: appIds === undefined ? undefined : { in: appIds },
    },
    with: {
      currentDeployment: {
        where: {
          status: "published",
        },
        with: { app: { columns: { shortId: true } } },
      },
    },
  });
};
