# Email forwarding: setup

Phase 5 lets a user forward order and shipping emails to a private address (for example `izaak-7f3k@in.wayfind.app`) and have the packages appear in their list. Local development needs no domain and no Cloudflare. These steps are for the real thing.

How it fits together:

```
sender -> Cloudflare Email Routing -> Email Worker (workers/inbound-email)
       -> POST /api/webhooks/inbound-email (Bearer INBOUND_WEBHOOK_SECRET)
       -> app stores the email, sends an Inngest event, answers 200
       -> job process-inbound-email reads it (Claude Haiku 4.5) and creates orders / shipments
```

## Try it locally (no domain, no Cloudflare)

Uses the fake extractor and the fake tracking provider, so nothing leaves your machine and nothing costs money.

1. `.env.local` needs `INNGEST_DEV=1` (as in `docs/webhooks-and-jobs-setup.md`). The inbound settings all have development defaults: domain `in.localhost`, secret `dev-inbound-secret`, extractor `fake`.
2. Run `npm run dev` and, in another terminal, `npm run jobs:dev`.
3. Sign in, open **Settings** (header) and copy your address. It looks like `you-7f3k@in.localhost`. Use it as `recipient` below.
4. Send an order confirmation. PowerShell:

```powershell
$headers = @{ Authorization = "Bearer dev-inbound-secret" }
$order = @{
  recipient = "you-7f3k@in.localhost"
  from      = "Amazon.com <auto-confirm@amazon.com>"
  subject   = "Order confirmation"
  messageId = "<order-1@example.test>"
  text      = "Thanks for your order`nOrder #112-4455667-8899001`nItem: Merino running socks`n"
} | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri http://localhost:3000/api/webhooks/inbound-email `
  -Headers $headers -ContentType "application/json" -Body $order -UseBasicParsing |
  Select-Object -ExpandProperty StatusCode
```

Expected: `200`, and after a reload (and the job running, a few seconds) the list shows an **Ordered** section with "Merino running socks".

5. Send the matching shipping email:

```powershell
$shipped = @{
  recipient = "you-7f3k@in.localhost"
  from      = "Amazon.com <shipment-tracking@amazon.com>"
  subject   = "Your order has shipped"
  messageId = "<ship-1@example.test>"
  text      = "Your package has shipped.`nTracking number: TBA309876543210`nOrder #112-4455667-8899001`nItem: Merino running socks`n"
} | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri http://localhost:3000/api/webhooks/inbound-email `
  -Headers $headers -ContentType "application/json" -Body $shipped -UseBasicParsing |
  Select-Object -ExpandProperty StatusCode
```

Expected: the **Ordered** row is gone and `TBA309876543210` is a tracked package. Open it: the drawer says "Ordered from Amazon.com · #112-4455667-8899001".

6. Things that should happen and do nothing visible:
   - Send either request again with the same `messageId`: still `200`, still one package.
   - Change `recipient` to `nobody-abcd@in.localhost`: `200`, nothing stored.
   - Leave the `Authorization` header off, or change the secret: `401`.
7. Gmail's confirmation message: send `from = "Gmail Team <forwarding-noreply@google.com>"`, any `subject`, `text = "Your confirmation code: 12345678"`. The code appears on **Settings** for 3 days.
8. **Regenerate address** on Settings: the old address now gets `200` and nothing is stored.

The fake extractor reads emails with plain rules, so it needs wording like "Thanks for your order" / "has shipped" / "Tracking number:". The real model reads far more varied emails.

## Real forwarding

You need a domain. Any registrar works; the domain's DNS must be on Cloudflare (a free plan is enough).

### 1. Cloudflare Email Routing on a subdomain

Use a subdomain such as `in.wayfind.app` so your normal email on the main domain is untouched.

1. Add the domain to Cloudflare and point its nameservers there.
2. Dashboard → the domain → **Email** → **Email Routing** → enable it for the subdomain (Settings → add subdomain `in`). Cloudflare adds the MX and SPF records it needs; accept them.
3. Routing rules → **Catch-all address** → action **Send to a Worker** → pick `wayfind-inbound-email` (after step 2 below), and turn the rule on.

Menu names move around over time; the idea is "everything sent to `*@in.<domain>` goes to the Worker".

### 2. Deploy the Worker

1. Make a secret for the app and the Worker to share:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. In `workers/inbound-email/wrangler.toml` set `APP_URL` to your deployed app's origin.
3. From that folder:
   ```
   npm install
   npx wrangler login
   npx wrangler secret put INBOUND_WEBHOOK_SECRET   # paste the secret
   npx wrangler deploy
   ```
   If npm warns that `esbuild` or `workerd` install scripts were not run, allow them with `npm approve-scripts` and install again; Wrangler needs both.
4. Go back to the catch-all rule in step 1.3 and select the deployed Worker.

### 3. App settings (Vercel)

| Key                      | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| `INBOUND_EMAIL_DOMAIN`   | `in.<your domain>` (exactly the subdomain Email Routing receives for)    |
| `INBOUND_WEBHOOK_SECRET` | the secret from step 2.1                                                 |
| `EMAIL_EXTRACTOR`        | `claude`                                                                 |
| `ANTHROPIC_API_KEY`      | a key from console.anthropic.com (server-only; never `NEXT_PUBLIC_*`)    |
| `INBOUND_DAILY_LIMIT`    | optional; emails stored per user per day, default 50                     |

`INBOUND_EMAIL_DOMAIN` and `INBOUND_WEBHOOK_SECRET` are required in production; reading the settings fails without them. The app only needs Inngest set up the same way as for tracking (`docs/webhooks-and-jobs-setup.md`).

### 4. Forward from Gmail

Settings (in Wayfind) shows the same steps with your address filled in.

1. Gmail → Settings → See all settings → **Forwarding and POP/IMAP** → **Add a forwarding address** → your Wayfind address.
2. Gmail sends a confirmation message to that address. Wayfind recognises it (sender `forwarding-noreply@google.com`) and shows the 8-digit code on **Settings**. Enter it in Gmail. Only the digits are kept, never the link.
3. Gmail → **Filters and Blocked Addresses** → **Create a new filter** (for example subject contains `order` or `shipped`, or from your favourite retailers) → **Forward it to** your Wayfind address.

If the code does not show within a couple of minutes, see "Troubleshooting".

### 5. Forward from Outlook

Settings → Mail → **Rules** → **Add new rule**: condition "Subject includes" `order` or `shipped`, action **Forward to** your Wayfind address. Outlook asks for no confirmation code.

## Troubleshooting

- **Nothing arrives.** Email Routing → Activity log shows whether Cloudflare received the message and which rule handled it. `npx wrangler tail` (in `workers/inbound-email`) shows the Worker running; it logs nothing from the email itself.
- **Everything is dropped silently.** An unknown address answers `200` on purpose. Check that the address on Settings is the one used, that `INBOUND_EMAIL_DOMAIN` matches the subdomain exactly, and that you did not regenerate the address after setting up the forward.
- **`401` in the Worker's logs.** The secret differs between `wrangler secret put` and the app's `INBOUND_WEBHOOK_SECRET`. The Worker drops a rejected email without retrying.
- **The email is stored but no package appears.** Open the Inngest dashboard and look at `process-inbound-email`. Settings shows how many emails could not be read; add those packages by hand.
- **The Worker retries.** It throws on a `5xx` or an unreachable app on purpose, so the sending server tries again later.
- **Cost.** One email is roughly half a cent with Claude Haiku 4.5. `INBOUND_DAILY_LIMIT` caps what one address can cost per day.

## Checking what the model really reads

The automated tests use a mocked model. To see how Haiku 4.5 handles real emails, run `npm run eval:email` (it needs `ANTHROPIC_API_KEY` and costs a few cents). It scores the synthetic fixtures in `tests/fixtures/email/retailers.json` and any examples you put in `tests/fixtures/email/real/` (gitignored, so personal details never get committed). A real example is a `.txt` file: `From:` and `Subject:` lines, a blank line, then the body. Remove names, street addresses and phone numbers first. Add `<same name>.expect.json` (same shape as the `model` entries in `retailers.json`) to have it scored; without one the answer is only printed.
