import { z } from "zod";

export const tailorkitUploadManifestSchema = z.object({
  assets: z.object({
    client: z.literal("client/client.js"),
    logos: z
      .object({
        dark: z
          .string()
          .regex(/^client\/logo-dark\.(?:png|svg|webp)$/u)
          .optional(),
        light: z
          .string()
          .regex(/^client\/logo-light\.(?:png|svg|webp)$/u)
          .optional(),
      })
      .optional(),
    server: z.literal("server/server.js").optional(),
  }),
  version: z.literal(1),
  views: z
    .array(
      z.object({
        disabled: z.literal(true).optional(),
        instances: z.literal(true).optional(),
        path: z.string().startsWith("/").max(1024),
        slot: z.string().min(1).max(255),
      })
    )
    .max(1000)
    .optional(),
});

export type TailorKitUploadManifest = z.output<
  typeof tailorkitUploadManifestSchema
>;

export const createTailorKitUploadManifest = (
  logos?: TailorKitUploadManifest["assets"]["logos"],
  server = false,
  views?: TailorKitUploadManifest["views"]
): TailorKitUploadManifest => {
  const assets: TailorKitUploadManifest["assets"] = {
    client: "client/client.js",
  };
  if (server) {
    assets.server = "server/server.js";
  }
  if (logos && Object.keys(logos).length > 0) {
    assets.logos = logos;
  }
  return tailorkitUploadManifestSchema.parse({ assets, version: 1, views });
};
