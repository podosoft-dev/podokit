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

test("admin can create a user via the dialog @smoke", async ({ page }) => {
  await ready(page, "/dashboard/users");
  const email = `ui-create-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Created");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  await dialog.getByLabel("Confirm password").fill("password123");
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Search by email…").fill(email);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
});

test("create rejects mismatched passwords", async ({ page }) => {
  await ready(page, "/dashboard/users");
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Mismatch");
  await dialog.getByLabel("Email").fill(`ui-mismatch-${Date.now()}@example.com`);
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  await dialog.getByLabel("Confirm password").fill("different999");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByText("Passwords do not match")).toBeVisible();
  await expect(dialog).toBeVisible(); // dialog stays open, nothing submitted
});

test("admin can set a user's password", async ({ page }) => {
  await ready(page, "/dashboard/users");
  const email = `ui-setpw-${Date.now()}@example.com`;
  await seedUser(page, email);
  await page.getByPlaceholder("Search by email…").fill(email);
  await page.getByRole("row", { name: new RegExp(email) }).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Set password" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New password", { exact: true }).fill("newpass1234");
  await dialog.getByLabel("Confirm new password").fill("newpass1234");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();
});

test("set password rejects mismatched passwords", async ({ page }) => {
  await ready(page, "/dashboard/users");
  const email = `ui-setpw-mismatch-${Date.now()}@example.com`;
  await seedUser(page, email);
  await page.getByPlaceholder("Search by email…").fill(email);
  await page.getByRole("row", { name: new RegExp(email) }).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Set password" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New password", { exact: true }).fill("newpass1234");
  await dialog.getByLabel("Confirm new password").fill("different999");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Passwords do not match")).toBeVisible();
});

test("admin can delete a user with confirmation", async ({ page }) => {
  await ready(page, "/dashboard/users");
  const email = `ui-delete-${Date.now()}@example.com`;
  await seedUser(page, email);
  await page.getByPlaceholder("Search by email…").fill(email);
  await page.getByRole("row", { name: new RegExp(email) }).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("User deleted")).toBeVisible();
  await page.getByPlaceholder("Search by email…").fill(email);
  await expect(page.getByRole("cell", { name: email })).toHaveCount(0);
});
