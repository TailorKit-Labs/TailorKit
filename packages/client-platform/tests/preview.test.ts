import { describe, expect, it } from "vite-plus/test";

import {
  previewBuildManifestSchema,
  previewEventSchema,
  previewFileManifestSchema,
  previewMetadataSchema,
} from "../src/preview";

describe("preview message schemas", () => {
  const manifest = {
    files: [
      {
        chunks: 1,
        contentType: "text/javascript",
        path: "client.js",
        sha256: "a".repeat(64),
        size: 1,
      },
    ],
  };

  it("accepts a valid build event", () => {
    expect(
      previewEventSchema.parse({
        buildId: "build",
        manifest,
        revision: 1,
        type: "begin",
      })
    ).toMatchObject({ type: "begin" });
  });

  it("rejects malformed and oversized stream messages", () => {
    expect(
      previewEventSchema.safeParse({
        base64: "***",
        chunkIndex: 0,
        fileIndex: 0,
        revision: 1,
        type: "chunk",
      }).success
    ).toBe(false);
    expect(
      previewEventSchema.safeParse({
        base64: "A".repeat(350_000),
        chunkIndex: 0,
        fileIndex: 0,
        revision: 1,
        type: "chunk",
      }).success
    ).toBe(false);
    expect(
      previewEventSchema.safeParse({ revision: -1, type: "complete" }).success
    ).toBe(false);
    expect(previewEventSchema.safeParse({ type: "unknown" }).success).toBe(
      false
    );
  });

  it.each([
    { path: "assets/😀.js", valid: true },
    { path: "assets/\u007F.js", valid: true },
    { path: "assets/\u0000.js", valid: false },
    { path: "assets/\u001F.js", valid: false },
    { path: "assets/😀\n.js", valid: false },
  ])(
    "validates control characters in preview path $path",
    ({ path, valid }) => {
      expect(
        previewBuildManifestSchema.safeParse({
          files: [...manifest.files, { ...manifest.files[0], path }],
        }).success
      ).toBe(valid);
    }
  );

  it("rejects invalid manifest and metadata values", () => {
    expect(
      previewBuildManifestSchema.safeParse({
        files: [{ ...manifest.files[0], size: -1 }],
      }).success
    ).toBe(false);
    expect(
      previewMetadataSchema.safeParse({
        expiresAt: "later",
        sessionId: "bad",
        token: "token",
        websocketUrl: "bad",
      }).success
    ).toBe(false);
  });
});

const fileImplementation = (path: string, contentType = "text/javascript") => ({
  chunks: 0,
  contentType,
  path,
  sha256: "0".repeat(64),
  size: 0,
});

describe("preview file manifest", () => {
  const file = fileImplementation;

  it("enforces the path limit in UTF-8 bytes", () => {
    expect(
      previewFileManifestSchema.safeParse(file("é".repeat(512))).success
    ).toBe(true);
    expect(
      previewFileManifestSchema.safeParse(file("é".repeat(513))).success
    ).toBe(false);
  });

  it("rejects CR and LF in content types", () => {
    expect(
      previewFileManifestSchema.safeParse(file("client.js", "text/javascript"))
        .success
    ).toBe(true);
    expect(
      previewFileManifestSchema.safeParse(
        file("client.js", "text/javascript\rbad")
      ).success
    ).toBe(false);
    expect(
      previewFileManifestSchema.safeParse(
        file("client.js", "text/javascript\nbad")
      ).success
    ).toBe(false);
  });
});
