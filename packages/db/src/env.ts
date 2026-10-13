import { createEnv } from "@tailorkit/env";
import * as z from "zod";

export const env = createEnv({
  schema: { DATABASE_URL: z.url().optional() },
  scope: "db",
  warnings: {
    DATABASE_URL:
      "DATABASE_URL is not set; database connections will be unavailable.",
  },
});
