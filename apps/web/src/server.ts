import {
  initializeObservability,
  withRequestSpan,
} from "@tailorkit/observability";

await initializeObservability("tailorkit-web");

const { default: handler, createServerEntry } =
  await import("@tanstack/react-start/server-entry");

export default createServerEntry({
  fetch: async (request) =>
    await withRequestSpan(request, "web.request", async (span) => {
      const response = await handler.fetch(request);
      span.setAttribute("http.response.status_code", response.status);
      return response;
    }),
});
