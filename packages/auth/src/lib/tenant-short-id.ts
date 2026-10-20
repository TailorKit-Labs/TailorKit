import { createShortId } from "@patchsmith/db/short-id";

export const tenantShortIdField = {
  input: false,
  required: true,
  type: "string",
  unique: true,
} as const;

export interface TenantRegistration {
  name?: string;
  slug?: string;
}

export const initializeTenantShortId = <T extends TenantRegistration>(
  organization: T
) =>
  // Never trust a caller-supplied identity, even in server-side API calls.
  ({ data: { ...organization, shortId: createShortId() } });
