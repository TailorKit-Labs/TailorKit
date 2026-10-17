import * as v from "valibot";

export const tailorkitUploadManifestSchema = v.object({
  assets: v.object({
    client: v.literal("client/client.js"),
    logos: v.optional(
      v.object({
        dark: v.optional(
          v.pipe(v.string(), v.regex(/^client\/logo-dark\.(?:png|svg|webp)$/u))
        ),
        light: v.optional(
          v.pipe(v.string(), v.regex(/^client\/logo-light\.(?:png|svg|webp)$/u))
        ),
      })
    ),
    server: v.optional(v.literal("server/server.js")),
  }),
  version: v.literal(1),
  views: v.optional(
    v.pipe(
      v.array(
        v.object({
          disabled: v.optional(v.literal(true)),
          instances: v.optional(v.literal(true)),
          path: v.pipe(v.string(), v.startsWith("/"), v.maxLength(1024)),
          slot: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
        })
      ),
      v.maxLength(1000)
    )
  ),
});

export type TailorKitUploadManifest = v.InferOutput<
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
  return v.parse(tailorkitUploadManifestSchema, { assets, version: 1, views });
};
