import { expect, test } from "@playwright/test";

test("Todo items persist through create, complete, reload, and delete @smoke", async ({ page, request, baseURL }): Promise<void> => {
  const title = `Todo UI ${crypto.randomUUID()}`;
  try {
    await page.goto("/");
    await page.getByPlaceholder("Add a todo…").fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    await row.getByRole("checkbox").check();
    await expect(row.getByRole("checkbox")).toBeChecked();
    await page.reload();
    await expect(row.getByRole("checkbox")).toBeChecked();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(row).toHaveCount(0);
  } finally {
    const items: unknown = await (await request.get("/api/todos")).json();
    if (Array.isArray(items)) {
      for (const item of items as unknown[]) {
        if (typeof item === "object" && item !== null && "title" in item && item.title === title
          && "id" in item && typeof item.id === "string") {
          await request.delete(`/api/todos/${item.id}`, { headers: { Origin: baseURL ?? "http://localhost:5001" } });
        }
      }
    }
  }
});
