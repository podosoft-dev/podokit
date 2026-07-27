import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "../helpers/accounts";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const headers = { origin: base };

async function signedIn(
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
  account: { email: string; password: string }
) {
  const context = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: headers,
  });
  await context.post("/api/auth/sign-in/email", { data: account });
  return context;
}

const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "example-project",
  client_email: "analytics@example-project.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nnot-a-real-private-key\n-----END PRIVATE KEY-----\n",
});

test("analytics public config exposes no report credential", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: headers,
  });
  const response = await anonymous.get("/api/analytics/config");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.provider).toBe("ga4");
  expect(body.consentMode).toBe("advanced");
  expect(body).not.toHaveProperty("propertyId");
  expect(body).not.toHaveProperty("credentials");
  expect(body).not.toHaveProperty("serviceAccountJson");
  await anonymous.dispose();
});

test("analytics administrator config is protected and write-only", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: headers,
  });
  expect((await anonymous.get("/api/admin/analytics/config")).status()).toBe(
    401
  );

  const user = await signedIn(playwright, USER);
  expect((await user.get("/api/admin/analytics/config")).status()).toBe(403);

  const admin = await signedIn(playwright, ADMIN);
  try {
    const invalid = await admin.put("/api/admin/analytics/config", {
      data: {
        measurementId: "G-TEST1234",
        propertyId: "123456789",
        serviceAccountJson: "{}",
      },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe(
      "ANALYTICS_CREDENTIALS_INVALID"
    );

    const saved = await admin.put("/api/admin/analytics/config", {
      data: {
        measurementId: "G-TEST1234",
        propertyId: "123456789",
        serviceAccountJson: SERVICE_ACCOUNT,
      },
    });
    expect(saved.ok()).toBeTruthy();
    const view = (await saved.json()) as Record<string, unknown>;
    expect(view.hasCredentials).toBe(true);
    expect(view).not.toHaveProperty("encryptedCredentials");
    expect(view).not.toHaveProperty("serviceAccountJson");

    const read = (await (
      await admin.get("/api/admin/analytics/config")
    ).json()) as Record<string, unknown>;
    expect(read.hasCredentials).toBe(true);
    expect(JSON.stringify(read)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(read)).not.toContain("client_email");
  } finally {
    await admin.delete("/api/admin/analytics/config/credentials");
    await admin.dispose();
    await user.dispose();
    await anonymous.dispose();
  }
});

test("analytics report rejects invalid ranges before provider access", async ({
  playwright,
}) => {
  const admin = await signedIn(playwright, ADMIN);
  const response = await admin.get(
    "/api/admin/analytics/report?from=2025-01-01&to=2026-12-31"
  );
  expect(response.status()).toBe(400);
  expect((await response.json()).error.code).toBe("ANALYTICS_RANGE_INVALID");
  await admin.dispose();
});
