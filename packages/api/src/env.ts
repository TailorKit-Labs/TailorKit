import { createEnv } from "@tailorkit/env";
import * as z from "zod";

export const env = createEnv({
  schema: { VERCEL_ENV: z.string().optional() },
  scope: "api",
});
