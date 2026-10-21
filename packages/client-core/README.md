# Patchsmith client core

`@patchsmith/client-core` contains shared client functionality for Patchsmith integrations.

`createPatchsmithClientConfig` exposes `api.apps(signal?)` and `api.views(input, signal?)` for uncached, validated host requests. The React `createClient` exposes the same `api`. Use these promises with TanStack Query or another cache; see the [TanStack Query example](../react/README.md#tanstack-query). For standalone server requests, `createEndpointClient` exposes the same methods without creating a response cache. Supply a request-scoped authenticated `fetch` implementation.

View queries send one `POST /views` request to the host. The host discovers installations in the authenticated scopes, selects the supported view, validates and composes its ancestor context, and resolves instances through each app's generated action. `useViews` and managed instance rendering use this transport. Apps supplied to a React provider only seed `useApps`; they do not override host view discovery. Use `appIds` or `scopes` to filter a view query.

Server code can prefetch without mounting React or starting a sandbox:

```ts
import { createPatchsmithFetchClient } from "@patchsmith/client-core";
import type { ViewsInput } from "@patchsmith/core/views";

export const loadViews = async (
  authenticatedFetch: typeof fetch,
  input: ViewsInput
) => {
  const client = createPatchsmithFetchClient({
    baseUrl: "https://your-product.com/api/patchsmith/",
    fetch: authenticatedFetch,
  });
  const query = client.views(input);
  await query.fetch();
  const { data, error } = query.getSnapshot();
  if (error) {
    throw error;
  }
  return data;
};
```

Create the client per authenticated server request and supply a fetch implementation that forwards that request's host credentials. Pass `activeView: null` for a single-instance slot. For a multiple-instance slot, supply `activeView.view` and its ancestor `layers`, each with `path`, `context`, and `status`. Successful resolution returns `{ status: "ready", data }`; unresolved context returns `idle` or `loading`. This API fetches and caches the result; transferring that cache to the browser is left to the host framework.
