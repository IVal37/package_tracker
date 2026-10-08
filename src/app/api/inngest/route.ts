import { serve } from "inngest/next";
import { getEnv } from "@/lib/env";
import { functions, inngest } from "@/jobs";

export const dynamic = "force-dynamic";

const handlers = serve({ client: inngest, functions });

// Validate env per request (not at import) so builds need no env values, but a
// production deploy missing INNGEST_SIGNING_KEY fails loudly instead of silently.
const guarded =
  (handler: typeof handlers.GET): typeof handlers.GET =>
  (request, context) => {
    getEnv();
    return handler(request, context);
  };

export const GET = guarded(handlers.GET);
export const POST = guarded(handlers.POST);
export const PUT = guarded(handlers.PUT);
