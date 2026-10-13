export { createEndpointClient } from "./endpoints";
export type { EndpointClient, SlotInstancesInput } from "./endpoints";
export { createTailorKitFetchClient } from "./fetch-client";
export type {
  TailorKitFetchClient,
  TailorKitFetchClientOptions,
  TailorKitCacheOptions,
} from "./fetch-client";
export { toBaseUrl } from "./url";
export { matchesApp } from "./apps";
export { normalizeScopeSelection, appendScopeSelection } from "./scope-query";
export { resolveSlotView, selectSlotView } from "./slot-view";
export { refetchViews } from "./views";
export type { ViewsQueryOptions } from "./views";

// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "./config";
export * from "./slot-types";
export { buildPrimitiveCss, buildThemeCss } from "./primitive-css";
export type { PrimitiveProps } from "./primitive-css";
export { createValueMemo } from "./value-memo";
