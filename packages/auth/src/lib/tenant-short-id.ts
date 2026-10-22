import { createShortId } from "@patchsmith/db/short-id";

export const tenantShortIdField = {
  // Dash filters input:false fields out of organization-hook results. Supply
  // the identity at the adapter boundary when that removes the hook's value.
  defaultValue: createShortId,
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
