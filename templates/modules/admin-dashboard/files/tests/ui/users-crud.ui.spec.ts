import { expect, test, type Page } from "@playwright/test";
import { ready } from "../helpers/hydration";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";

// Seed a throwaway user via the API (admin cookies come from storageState) so
// the mutating UI tests don't touch the shared admin/user seed accounts.
async function seedUser(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/auth/admin/create-user", {
    headers: { origin: base },
    data: { email, password: "password123", name: "Throwaway", role: "user" },
  });
  expect(res.ok()).toBeTruthy();
}

// Open the Manage two-pane modal for a seeded user.
async function openManage(page: Page, email: string): Promise<void> {
  await page.getByPlaceholder("Search by email…").fill(email);
  await page.getByRole("row", { name: new RegExp(email) }).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Manage" }).click();
}

test("admin can create a user via the dialog @smoke", async ({ page }) => {
  await ready(page, "/admin/users");
  const email = `ui-create-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Created");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  await dialog.getByLabel("Confirm password").fill("password123");
  await dialog.getByRole("button", { name: "Create" }).click();
  // Wait for the create to settle (dialog closes + list reloads) before searching,
  // otherwise the search input can be refilled by the post-create reload.
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByPlaceholder("Search by email…").fill(email);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
});

test("create rejects mismatched passwords", async ({ page }) => {
  await ready(page, "/admin/users");
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Mismatch");
  await dialog.getByLabel("Email").fill(`ui-mismatch-${Date.now()}@example.com`);
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  await dialog.getByLabel("Confirm password").fill("different999");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByText("Passwords do not match")).toBeVisible();
});

test("manage: edit profile name @smoke", async ({ page }) => {
  await ready(page, "/admin/users");
  const email = `ui-edit-${Date.now()}@example.com`;
  await seedUser(page, email);
  await openManage(page, email);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Edited Name");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("User updated")).toBeVisible();
});

test("manage: set a password (and reject mismatch)", async ({ page }) => {
  await ready(page, "/admin/users");
  const email = `ui-setpw-${Date.now()}@example.com`;
  await seedUser(page, email);
  await openManage(page, email);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Security" }).click();
  await dialog.getByLabel("New password", { exact: true }).fill("newpass1234");
  await dialog.getByLabel("Confirm new password").fill("different999");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await expect(dialog.getByText("Passwords do not match")).toBeVisible();
  await dialog.getByLabel("Confirm new password").fill("newpass1234");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();
});

test("manage: ban a user with a reason", async ({ page }) => {
  await ready(page, "/admin/users");
  const email = `ui-ban-${Date.now()}@example.com`;
  await seedUser(page, email);
  await openManage(page, email);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Security" }).click();
  await dialog.getByLabel("Reason (optional)").fill("policy violation");
  await dialog.getByRole("button", { name: "Ban", exact: true }).click();
  await expect(page.getByText("User banned", { exact: true })).toBeVisible();
});

test("manage: revoke a user's session", async ({ page, playwright }) => {
  await ready(page, "/admin/users");
  const email = `ui-sess-${Date.now()}@example.com`;
  await seedUser(page, email);
  // create a session for the user in an isolated context (don't touch the admin cookie)
  const uctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  expect((await uctx.post("/api/auth/sign-in/email", { data: { email, password: "password123" } })).ok()).toBeTruthy();
  await uctx.dispose();
  await openManage(page, email);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sessions" }).click();
  await dialog.getByRole("button", { name: "Revoke", exact: true }).first().click();
  await expect(page.getByText("Session revoked")).toBeVisible();
});

test("manage: delete a user from the danger zone", async ({ page }) => {
  await ready(page, "/admin/users");
  const email = `ui-delete-${Date.now()}@example.com`;
  await seedUser(page, email);
  await openManage(page, email);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Danger zone" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click(); // arm
  await dialog.getByRole("button", { name: "Delete" }).click(); // confirm
  await expect(page.getByText("User deleted")).toBeVisible();
  await page.getByPlaceholder("Search by email…").fill(email);
  await expect(page.getByRole("cell", { name: email })).toHaveCount(0);
});

test("users list shows pagination beyond one page", async ({ page }) => {
  await ready(page, "/admin/users");
  for (let i = 0; i < 6; i += 1) {
    await page.request.post("/api/auth/admin/create-user", {
      headers: { origin: base },
      data: { email: `pg-${Date.now()}-${i}@example.com`, password: "password123", name: `Pg${i}`, role: "user" },
    });
  }
  await page.reload();
  const nav = page.getByRole("navigation", { name: "pagination" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Page 2" })).toBeVisible();
});
