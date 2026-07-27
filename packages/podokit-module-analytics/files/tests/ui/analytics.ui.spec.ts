import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";

const PUBLIC_CONFIG = {
  enabled: true,
  provider: "ga4",
  measurementId: "G-TEST1234",
  consentMode: "advanced",
};

test("analytics consent starts denied and persists the cookie choice", async ({
  page,
}) => {
  await page.route("**/api/analytics/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PUBLIC_CONFIG),
    })
  );
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
  );
  await page.addInitScript(() => {
    const resetKey = "podokit.analytics.test-consent-reset";
    if (sessionStorage.getItem(resetKey) === "done") return;
    localStorage.removeItem("podokit.analytics.consent.v1");
    sessionStorage.setItem(resetKey, "done");
  });

  await ready(page, "/");
  const consent = page.getByTestId("analytics-consent");
  await expect(consent).toBeVisible();

  const commands = await page.evaluate(
    () => (window as Window & { dataLayer?: unknown[][] }).dataLayer ?? []
  );
  expect(commands[0]).toEqual([
    "consent",
    "default",
    expect.objectContaining({
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    }),
  ]);
  expect(
    commands.filter(
      (command) => command[0] === "event" && command[1] === "page_view"
    )
  ).toHaveLength(1);

  await consent
    .getByRole("button", { name: "Continue without analytics cookies" })
    .click();
  await expect(consent).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Analytics privacy settings" })
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("podokit.analytics.consent.v1")
    )
  ).toBe("denied");

  await page.reload();
  await expect(page.getByTestId("analytics-consent")).toBeHidden();
  await page
    .getByRole("button", { name: "Analytics privacy settings" })
    .click();
  await expect(page.getByTestId("analytics-consent")).toBeVisible();
});

test("analytics excludes administrator routes from page views", async ({
  page,
}) => {
  await page.route("**/api/analytics/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PUBLIC_CONFIG),
    })
  );
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
  );
  await ready(page, "/admin");
  const commands = await page.evaluate(
    () => (window as Window & { dataLayer?: unknown[][] }).dataLayer ?? []
  );
  expect(
    commands.filter(
      (command) => command[0] === "event" && command[1] === "page_view"
    )
  ).toHaveLength(0);
});

test("analytics settings explains how to issue GA4 credentials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Analytics" }).click();
  await page
    .getByRole("button", { name: "How to issue GA4 credentials" })
    .click();

  const dialog = page.getByRole("dialog", {
    name: "Issue Google Analytics 4 credentials",
  });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(
    dialog.getByText("Create or select a GA4 property and web stream")
  ).toBeVisible();
  await expect(
    dialog.getByText("Enable the Google Analytics Data API")
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Google Analytics Data API guide" })
  ).toHaveAttribute(
    "href",
    "https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart"
  );
  await expect(
    dialog.getByRole("link", { name: "Service account key guide" })
  ).toHaveAttribute(
    "href",
    "https://cloud.google.com/iam/docs/keys-create-delete"
  );

  const scrollState = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  expect(["auto", "scroll"]).toContain(scrollState.overflowY);

  await dialog.getByRole("button", { name: "Close guide" }).click();
  await expect(dialog).toBeHidden();
});

test("analytics settings stores credentials without reading them back", async ({
  page,
}) => {
  await ready(page, "/admin/settings");
  await page.getByRole("tab", { name: "Analytics" }).click();
  await page.getByLabel("Measurement ID").fill("G-TEST1234");
  await page.getByLabel("Property ID").fill("123456789");
  await page.getByLabel("Service-account JSON").fill(
    JSON.stringify({
      type: "service_account",
      project_id: "example-project",
      client_email: "analytics@example-project.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nnot-a-real-private-key\n-----END PRIVATE KEY-----\n",
    })
  );
  try {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Credentials are stored")).toBeVisible();
    await expect(page.getByLabel("Service-account JSON")).toHaveValue("");
    const config = (await (
      await page.request.get("/api/admin/analytics/config")
    ).json()) as Record<string, unknown>;
    expect(config.hasCredentials).toBe(true);
    expect(JSON.stringify(config)).not.toContain("PRIVATE KEY");
  } finally {
    await page.request.delete("/api/admin/analytics/config/credentials");
  }
});
