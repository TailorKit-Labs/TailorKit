import { z } from "zod";

const logosConfigSchema = z.object({
  dark: z.string().min(1).optional(),
  light: z.string().min(1).optional(),
});

const tailorkitConfigSchema = z.strictObject({
  appId: z.string().min(1).optional(),
  host: z.url(),
  logos: logosConfigSchema.optional(),
  name: z.string().trim().min(1).optional(),
  server: z
    .strictObject({
      entry: z.string().min(1).default("src/server.ts"),
      migrations: z.string().min(1).optional(),
    })
    .optional(),
});

/**
 * App configuration exported from `tailorkit.config.ts`.
 * Relative paths resolve from the app root: the Vite config directory when building.
 */
export interface TailorKitConfig extends z.input<typeof tailorkitConfigSchema> {
  /**
   * ID of the app on the TailorKit host, used for deployment and remote preview.
   * When omitted, the first deployment creates an app and saves its ID here.
   * Remote preview requires an existing app ID.
   * @default undefined
   */
  appId?: string;
  /**
   * URL of the TailorKit host used for authentication, deployment, remote preview,
   * and fetching the host schema for generated types. Required; has no default.
   */
  host: string;
  /**
   * Optional app logo assets included in the build and uploaded on deployment.
   * Accepts SVG, PNG, or WebP files. Omit to upload no custom logos.
   * @default undefined
   */
  logos?: {
    /**
     * Path to the app logo for dark mode. Omit to upload no dark-mode logo.
     * @default undefined
     */
    dark?: string;
    /**
     * Path to the app logo for light mode. Omit to upload no light-mode logo.
     * @default undefined
     */
    light?: string;
  };
  /**
   * App name applied during deployment, including updates to an existing app.
   * When omitted, new apps use the package.json name or app directory name,
   * and existing apps keep their current name.
   * @default undefined
   */
  name?: string;
  /**
   * Enables the private app backend and its database migrations when present.
   * Set to `{}` to use the default paths; omit for a client-only app.
   * @default undefined
   */
  server?: {
    /**
     * Source entry point for the app's private backend bundle.
     * @default "src/server.ts"
     */
    entry?: string;
    /**
     * Directory containing Drizzle migrations, used for generation and bundling.
     * When omitted, uses `./src/db/migrations` and allows that directory to be absent.
     * An explicitly configured directory must exist when building the backend.
     * @default "./src/db/migrations"
     */
    migrations?: string;
  };
}
export type ResolvedTailorKitConfig = z.output<typeof tailorkitConfigSchema>;

export { tailorkitConfigSchema };

export const defineConfig = (config: TailorKitConfig): TailorKitConfig =>
  config;
export const defineTailorKitConfig = defineConfig;
