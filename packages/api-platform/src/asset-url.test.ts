import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { withAppAssetUrl } from "./asset-url";

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const env = vi.hoisted(() => ({
  ASSET_BASE_URL: undefined as string | undefined,
  ASSET_DOMAIN: "tailorkit.app",
  NODE_ENV: "production" as "development" | "production",
  PORT: undefined as number | undefined,
}));
vi.mock("../../api-utils/src/env.ts", () => ({ env }));

const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "33333333-3333-4333-8333-333333333333";
const deploymentId = "44444444-4444-4444-8444-444444444444";
const appPublicId = "app000000001";
const deploymentPublicId = "deploy000001";

describe("hosted asset URLs", () => {
  afterEach(() => {
    env.ASSET_BASE_URL = undefined;
    env.NODE_ENV = "production";
  });

  it("uses stable team, project, app and deployment identifiers", () => {
    const app = {
      currentDeployment: {
        appId,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        createdAt: new Date(),
        errorMessage: null,
        id: deploymentId,
        logoDarkPath: `logos/${"a".repeat(64)}.svg`,
        logoLightPath: `logos/${"b".repeat(64)}.webp`,
        publicId: deploymentPublicId,
        publishedAt: new Date(),
        status: "published" as const,
        updatedAt: new Date(),
      },
      id: appId,
      publicId: appPublicId,
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client/client.js`
    );
    expect(withAppAssetUrl(app, "abc123def45678", projectId).logoPaths).toEqual(
      {
        dark: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/logos/${"a".repeat(64)}.svg`,
        light: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/logos/${"b".repeat(64)}.webp`,
      }
    );
  });

  it("uses deployment URLs for content-addressed logos without duplicating stored files", () => {
    const logoHash = "b".repeat(64);
    const app = {
      currentDeployment: {
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        logoDarkPath: `logos/${logoHash}.svg`,
        logoLightPath: null,
        publicId: deploymentPublicId,
        status: "published" as const,
      },
      publicId: appPublicId,
    };

    expect(withAppAssetUrl(app, "abc123def45678", projectId).logoPaths).toEqual(
      {
        dark: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/logos/${logoHash}.svg`,
      }
    );
  });

  it("uses the same-origin Node route in local development", () => {
    env.NODE_ENV = "development";
    const app = {
      currentDeployment: {
        appId,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        createdAt: new Date(),
        errorMessage: null,
        id: deploymentId,
        publicId: deploymentPublicId,
        publishedAt: new Date(),
        status: "published" as const,
        updatedAt: new Date(),
      },
      publicId: appPublicId,
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `http://localhost:3000/api/assets/t/abc123def45678/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client/client.js`
    );
  });

  it("supports the Node asset route in self-hosted production", () => {
    env.ASSET_BASE_URL = "https://tailorkit.example.com/api/assets/";
    const app = {
      currentDeployment: {
        appId,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        createdAt: new Date(),
        errorMessage: null,
        id: deploymentId,
        publicId: deploymentPublicId,
        publishedAt: new Date(),
        status: "published" as const,
        updatedAt: new Date(),
      },
      publicId: appPublicId,
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `https://tailorkit.example.com/api/assets/t/abc123def45678/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client/client.js`
    );
  });

  it("does not expose incomplete deployments", () => {
    const deployment = {
      appId,
      clientEntryFileId: null,
      createdAt: new Date(),
      errorMessage: null,
      id: deploymentId,
      publicId: deploymentPublicId,
      publishedAt: null,
      status: "uploading" as const,
      updatedAt: new Date(),
    };
    expect(
      withAppAssetUrl(
        { currentDeployment: deployment, publicId: appPublicId },
        "abc123def45678",
        projectId
      ).clientPath
    ).toBeUndefined();
  });
});
