import { handleAssetRequest } from "@patchsmith/api-platform/assets";
import { getStorage } from "@patchsmith/storage";

import { createApiEntry } from "./entry";

export const handleAssetsRequest = async ({ request }: { request: Request }) =>
  await handleAssetRequest(request, getStorage());

export default createApiEntry(handleAssetsRequest, [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
