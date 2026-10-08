# Nominatim fixtures

Saved response shapes for the `/search?format=jsonv2` endpoint of OpenStreetMap's public Nominatim, used with MSW. Tests never call the real service.

- `hit.json`: one result. Coordinates are **strings**, as Nominatim returns them.
- `empty.json`: no match (`[]`).
- `malformed.json`: valid JSON in the wrong shape.

429 and 5xx responses are built inline in the tests (status only).

Data © OpenStreetMap contributors (ODbL).
