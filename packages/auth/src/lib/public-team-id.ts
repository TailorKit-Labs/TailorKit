import { customAlphabet } from "nanoid";

// Keep the first and last characters alphanumeric so IDs remain valid DNS labels.
// Keep the middle alphabet aligned with the database and asset gateway constraints.
const createEdge = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 1);
const createMiddle = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz-",
  12
);

export const createPublicTeamId = () =>
  `${createEdge()}${createMiddle()}${createEdge()}`;

export const publicTeamIdField = {
  input: false,
  required: true,
  type: "string",
  unique: true,
} as const;

export const initializePublicTeamId = <T extends object>(organization: T) =>
  // Never trust a caller-supplied identity, even in server-side API calls.
  ({ data: { ...organization, publicId: createPublicTeamId() } });
