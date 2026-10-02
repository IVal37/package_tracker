import { http, HttpResponse } from "msw";
import error400 from "../fixtures/ship24/error-400-validation.json";
import error404 from "../fixtures/ship24/error-404.json";
import error409 from "../fixtures/ship24/error-409-tracker-conflict.json";
import searchResults from "../fixtures/ship24/search-results.json";
import trackDelivered from "../fixtures/ship24/track-delivered.json";
import trackInTransit from "../fixtures/ship24/track-in-transit.json";
import unsubscribe from "../fixtures/ship24/unsubscribe.json";

const BASE = "https://api.ship24.com/public/v1";

export const VALID_NUMBER = "9400115901047177598206";
export const DELIVERED_NUMBER = "1Z999AA10123456784";
export const INVALID_NUMBER = "INVALID1";
export const CONFLICT_NUMBER = "CONFLICT123";
export const KNOWN_TRACKER_ID = "26148317-7502-d3ac-44a9-546d240ac0dd";
export const SEARCH_TRACKER_ID = "5a0c0ee6-5ea2-4c11-9a5e-000000000001";

/** Default happy-path Ship24 behaviour, served from saved fixtures. */
export const ship24Handlers = [
  http.post(`${BASE}/trackers/track`, async ({ request }) => {
    const body = (await request.json()) as { trackingNumber?: string };
    switch (body.trackingNumber) {
      case INVALID_NUMBER:
        return HttpResponse.json(error400, { status: 400 });
      case CONFLICT_NUMBER:
        return HttpResponse.json(error409, { status: 409 });
      case DELIVERED_NUMBER:
        return HttpResponse.json(trackDelivered, { status: 201 });
      default:
        return HttpResponse.json(trackInTransit, { status: 201 });
    }
  }),

  http.get(`${BASE}/trackers/search/:trackingNumber/results`, () =>
    HttpResponse.json(searchResults),
  ),

  http.get(`${BASE}/trackers/:trackerId/results`, ({ params }) =>
    params.trackerId === KNOWN_TRACKER_ID
      ? HttpResponse.json(trackInTransit)
      : HttpResponse.json(error404, { status: 404 }),
  ),

  http.patch(`${BASE}/trackers/:trackerId`, ({ params }) =>
    params.trackerId === KNOWN_TRACKER_ID
      ? HttpResponse.json(unsubscribe)
      : HttpResponse.json(error404, { status: 404 }),
  ),
];
