# Inbound email Worker

A small Cloudflare Email Worker. Cloudflare Email Routing hands it each message sent to an address on your inbound domain; it parses the MIME with `postal-mime` and POSTs a JSON body to the app at `/api/webhooks/inbound-email`.

It forwards and nothing else. Which user an email belongs to, repeats, daily limits and reading the email all happen in the app.

| File         | What it is                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `handler.ts` | The logic as a pure function (message, parser and `fetch` are passed in). Tested by the app's `npm test`. |
| `index.ts`   | Wires in `postal-mime` and the real `fetch`. Not part of the app's typecheck or lint.                     |

What it sends: the **envelope** recipient (the alias it was really delivered to, not the `To:` header), the From header, subject, Message-ID, date, and the text and HTML parts, each cut at 200,000 characters. Messages over 25 MiB are skipped.

What it does with the app's answer: 2xx is done; most 4xx (the app says this email is not acceptable) are dropped without a retry; 5xx, 429, no answer, and answers that mean the Worker is set up wrong (a redirect, 401, 403, 404) throw, so the sending server tries again later and nothing is lost. It does not follow redirects: they drop the secret on another origin. It never logs anything from the email.

Setup and deployment: [`docs/email-forwarding-setup.md`](../../docs/email-forwarding-setup.md). This folder has its own `package.json` so none of its packages reach the Next.js app.
