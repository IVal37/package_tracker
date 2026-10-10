import { expect, test, type Page } from "@playwright/test";
import { FAKE_AUTH_URL } from "./env";

// The one launch test: sign up, add a package, see it in the list, switch to
// the map and see its marker. It runs a production build under the real
// security headers, so a policy that blocks the map fails it.

/**
 * OpenFreeMap stays out of the test: its style is replaced by a plain
 * background, and tiles and fonts answer 404. The request still goes through
 * the browser, so the content security policy applies to it.
 */
async function stubMapTiles(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 8,
            sources: {},
            glyphs:
              "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#e2e8f0" },
              },
            ],
          }),
        })
      : route.fulfill({ status: 404, body: "" }),
  );
}

test("sign up, add a package, see it in the list and on the map", async ({
  page,
  request,
}) => {
  const policyViolations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) {
      policyViolations.push(message.text());
    }
  });
  await stubMapTiles(page);

  // Sign up: ask for a link, then open the one the fake auth server "sent".
  const email = `launch-${Date.now()}@example.test`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByText("Check your email for a sign-in link."),
  ).toBeVisible();

  const link = await request.get(
    `${FAKE_AUTH_URL}/__test__/magic-link?email=${encodeURIComponent(email)}`,
  );
  expect(link.ok()).toBe(true);
  const { url } = (await link.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByText(email)).toBeVisible();

  // Add a package and see it in the list.
  await page.getByLabel("Tracking number").fill("FAKE-TRANSIT-LAUNCH1");
  await page.getByLabel("Nickname (optional)").fill("Launch boots");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Launch boots")).toBeVisible();

  // Switch to the map: the package is listed there and its marker is drawn.
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(/view=map/);
  const map = page.getByRole("region", { name: "Map of your packages" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-markers", /^[1-9]\d*$/, {
    timeout: 30_000,
  });
  await expect(page.getByText("The map couldn't load")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "On the map" }).getByText("Launch boots"),
  ).toBeVisible();

  expect(policyViolations).toEqual([]);
});
