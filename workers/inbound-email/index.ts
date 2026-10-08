// Cloudflare Email Worker entry point. Not part of the app's typecheck or lint
// (it needs this folder's own packages); handler.ts holds the logic and tests.
import PostalMime from "postal-mime";
import { handleInboundMessage, type ParseMail } from "./handler";

interface Env {
  /** The app's public origin, e.g. https://wayfind.app (a plain variable). */
  APP_URL: string;
  /** Same value as INBOUND_WEBHOOK_SECRET in the app (a Wrangler secret). */
  INBOUND_WEBHOOK_SECRET: string;
}

const parse: ParseMail = async (raw) => {
  const bytes = await new Response(raw).arrayBuffer();
  const email = await new PostalMime().parse(bytes);
  return {
    from: email.from,
    subject: email.subject,
    messageId: email.messageId,
    date: email.date,
    text: email.text,
    html: email.html,
  };
};

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleInboundMessage(message, {
      endpoint: new URL("/api/webhooks/inbound-email", env.APP_URL).toString(),
      secret: env.INBOUND_WEBHOOK_SECRET,
      fetch,
      parse,
    });
  },
};
