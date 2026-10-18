import {
  initializeObservability,
  withRequestSpan,
} from "@tailorkit/observability";

export type ApiHandler = (input: {
  request: Request;
}) => Response | Promise<Response>;

export const createApiEntry = (
  handle: ApiHandler,
  methods: readonly string[]
) => ({
  fetch: async (request: Request): Promise<Response> => {
    await initializeObservability("tailorkit-web");
    return await withRequestSpan(request, "web.request", async (span) => {
      let response: Response;
      if (methods.includes(request.method)) {
        try {
          response = await handle({ request });
        } catch (error) {
          // Authorization handlers may throw an HTTP response at their boundary.
          if (!(error instanceof Response)) {
            throw error;
          }
          response = error;
        }
      } else {
        response = new Response("Method not allowed", {
          headers: { allow: methods.join(", ") },
          status: 405,
        });
      }
      span.setAttribute("http.response.status_code", response.status);
      return response;
    });
  },
});
