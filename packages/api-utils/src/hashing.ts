import { createHmac } from "node:crypto";

export const hashSecret = (value: string, secret: string): string =>
  createHmac("sha256", secret).update(value).digest("hex");
