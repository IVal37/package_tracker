# Ship24 fixtures

Hand-built from the examples in Ship24's OpenAPI spec
(https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml, read 2026-10-02).
They are not captured from real Ship24 calls, so tests never touch the real service.

| File                    | Used for                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `track-in-transit.json` | `POST /trackers/track` and `GET /trackers/{id}/results`. Mixes a no-offset datetime, a `Z` datetime and a date-only datetime. |
| `track-delivered.json`  | Delivered shipment, offset datetime, ETA from `courierEstimatedDeliveryDate.to`                                               |
| `search-results.json`   | `GET /trackers/search/{trackingNumber}/results`, the 409 fallback. Different `trackerId` so tests can tell it apart.          |
| `unsubscribe.json`      | `PATCH /trackers/{id}` with `isSubscribed: false`                                                                             |
| `webhook-events.json`   | Webhook body containing a duplicated `eventId`                                                                                |
| `error-*.json`          | Error bodies in Ship24's `{ errors: [{ code, message }], data: null }` shape                                                  |
