import { expect, test } from "@playwright/test";
import { ready } from "../helpers/hydration";
import { ADMIN } from "../helpers/accounts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADAQMAAACDJEzCAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURWYzmf///129H+IAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gcVCSUTzXBDTwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wNy0yMVQwOTozNzoxOSswMDowMOuehLIAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDctMjFUMDk6Mzc6MTkrMDA6MDCawzwOAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA3LTIxVDA5OjM3OjE5KzAwOjAwzdYd0QAAAAtJREFUCNdjYAABAAAGAAFm9MlsAAAAAElFTkSuQmCC",
  "base64",
);
const TOO_WIDE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAACAEAAAABAQMAAACfGLePAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURWYzmf///129H+IAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gcVCScoTk3I6QAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wNy0yMVQwOTozOTo0MCswMDowMCgv/7YAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDctMjFUMDk6Mzk6NDArMDA6MDBZckcKAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA3LTIxVDA5OjM5OjQwKzAwOjAwDmdm1QAAAAxJREFUGNNjYBjpAAABAgABRf+HpwAAAABJRU5ErkJggg==",
  "base64",
);

// admin storageState (project default)
test("account opens on the profile section @smoke", async ({ page }) => {
  await ready(page, "/admin/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
  // save is enabled only once the name changes
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByLabel("Name", { exact: true }).fill(`Admin Preview ${Date.now()}`);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

test("account displays profile image limits and updates every avatar", async ({ page }) => {
  await ready(page, "/account");
  await page.request.delete("/api/account/profile-image");
  await page.reload();
  await expect(page.getByTestId("profile-image-hint")).toContainText("PNG, JPEG, or WebP");
  await expect(page.getByTestId("profile-image-hint")).toContainText("2 MB");
  await expect(page.getByTestId("profile-image-hint")).toContainText("2048 × 2048 px");

  await page.locator("#profile-image").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByText("Profile image updated")).toBeVisible();
  await expect(page.getByTestId("profile-image-preview").locator("img")).toBeVisible();

  await ready(page, "/");
  await expect(page.getByTestId("account-menu").locator("img")).toBeVisible();
  await ready(page, "/admin");
  await expect(page.getByTestId("sidebar-user-menu").locator("img")).toBeVisible();

  await ready(page, "/account");
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByText("Profile image removed")).toBeVisible();
  await expect(page.getByTestId("profile-image-preview").locator("img")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload image" })).toBeVisible();
});

test("account rejects invalid profile images before upload", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.locator("#profile-image").setInputFiles({
    name: "avatar.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose a valid PNG, JPEG, or WebP image")).toBeVisible();

  await page.locator("#profile-image").setInputFiles({
    name: "wide.png",
    mimeType: "image/png",
    buffer: TOO_WIDE_PNG,
  });
  await expect(page.getByText("The image must not exceed 2048 × 2048 px")).toBeVisible();
});

test("account exposes a change-email action when the address is edited", async ({ page }) => {
  await ready(page, "/admin/account");
  const email = page.getByLabel("Email");
  await expect(email).toHaveValue("admin@example.com");
  // no action until the address actually changes
  await expect(page.getByRole("button", { name: "Change email" })).toHaveCount(0);
  await email.fill("admin+changed@example.com");
  await expect(page.getByRole("button", { name: "Change email" })).toBeVisible();
  // revert without submitting — don't mutate the shared admin session
  await email.fill("admin@example.com");
  await expect(page.getByRole("button", { name: "Change email" })).toHaveCount(0);
});

test("account shows a username field when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  const username = page.getByLabel("Username", { exact: true });
  test.skip((await username.count()) === 0, "username not enabled");
  await expect(username).toBeVisible();
});

test("account can create and revoke an API key when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  const nav = page.getByRole("button", { name: "API keys" });
  test.skip((await nav.count()) === 0, "api keys not enabled");
  await nav.click();
  const name = `ui-${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  // the full key is shown once in a dialog
  await expect(page.getByText("API key created")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  // it now appears in the list; revoke it to clean up
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Key revoked")).toBeVisible();
});

test("account can register and remove a passkey when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByRole("button", { name: "Security" }).click();
  const addBtn = page.getByRole("button", { name: "Add passkey" });
  test.skip((await addBtn.count()) === 0, "passkeys not enabled");
  // A virtual authenticator lets the WebAuthn ceremony resolve without hardware.
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const pkName = `pk-${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(pkName);
  await addBtn.click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(pkName) });
  await expect(row).toBeVisible();
  // remove it so the shared admin account keeps no leftover credential
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Passkey removed")).toBeVisible();
});

test("account shows a phone field when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  const phone = page.getByLabel("Phone number", { exact: true });
  test.skip((await phone.count()) === 0, "phone number not enabled");
  await expect(phone).toBeVisible();
});

test("admin can update their profile name", async ({ page }) => {
  await ready(page, "/admin/account");
  const name = page.getByLabel("Name", { exact: true });
  await name.fill(`Admin Updated ${Date.now()}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
  await ready(page, "/admin/account");
  const refreshedName = page.getByLabel("Name", { exact: true });
  await refreshedName.fill(ADMIN.name);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
});

test("account security and sessions sub-navigation", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByRole("button", { name: "Security" }).click();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await page.getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByText("Active sessions")).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out other sessions" })).toBeVisible();
});

test("account nav shows the core sections", async ({ page }) => {
  await ready(page, "/admin/account");
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sessions" })).toBeVisible();
});

test("two-factor setup shows a scannable QR code when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  await page.getByRole("button", { name: "Security" }).click();
  const heading = page.getByText("Two-factor authentication");
  test.skip((await heading.count()) === 0, "two-factor not enabled");
  await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  // Start setup (password + Enable) and confirm the QR renders. Stop before
  // verifying so 2FA stays inactive and the shared admin session keeps working.
  await page.locator("#tf-on-pw").fill("Podokit3e-Str0ng!pw");
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByRole("img", { name: "TOTP QR code" })).toBeVisible();
});

test("danger zone offers account deletion when enabled", async ({ page }) => {
  await ready(page, "/admin/account");
  const danger = page.getByRole("button", { name: "Danger zone" });
  test.skip((await danger.count()) === 0, "account deletion not enabled");
  await danger.click();
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
});
