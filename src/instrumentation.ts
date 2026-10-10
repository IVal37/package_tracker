import type { Instrumentation } from "next";

// Error reporting for the server. Sentry runs in the Node.js runtime only and
// is never loaded in the browser; without SENTRY_DSN nothing leaves the server.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMonitoring } = await import("@/lib/monitoring");
  startMonitoring();
}

/**
 * Any error Next.js catches while handling a request. The route and its kind
 * go with it; the request's headers, path parameters and body never do.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring");
  reportError(error, {
    method: request.method.toLowerCase(),
    route_type: context.routeType,
    router: context.routerKind === "App Router" ? "app" : "pages",
  });
};
