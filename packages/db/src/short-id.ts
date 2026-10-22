import { customAlphabet } from "nanoid";

/** Permanent, DNS-safe identifiers; uniqueness is enforced in each owning table. */
export const createShortId = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  12
);
