# Anthropic API fixtures

Saved shapes of `POST /v1/messages` responses, used with MSW. Tests never call the real service.

- `message.json`: a normal answer. The tests replace the `text` with the JSON they want the "model" to return.
- `refusal.json`: `stop_reason: "refusal"`.
- `max-tokens.json`: an answer cut off mid-JSON.
- `errors.json`: error bodies by HTTP status.

These are hand-written from the documented response format, not recordings. What Haiku 4.5 actually returns for real emails is only checked by `npm run eval:email`.
