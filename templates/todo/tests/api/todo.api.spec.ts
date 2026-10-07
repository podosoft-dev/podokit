import { expect, test } from "@playwright/test";

test("Todo CRUD preserves UUIDs, booleans, and timestamps @smoke", async ({ request, baseURL }): Promise<void> => {
  const title = `Todo API ${crypto.randomUUID()}`;
  const headers = { Origin: baseURL ?? "http://localhost:5001" };
  const response = await request.post("/api/todos", { data: { title }, headers });
  expect(response.status()).toBe(201);
  const created: unknown = await response.json();
  expect(created).toMatchObject({ title, completed: false, id: expect.any(String), createdAt: expect.any(String) });
  if (typeof created !== "object" || created === null || !("id" in created) || typeof created.id !== "string"
    || !("createdAt" in created) || typeof created.createdAt !== "string") {
    throw new Error("Todo response must include an ID and timestamp");
  }
  const id = created.id;
  try {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    const list = await request.get("/api/todos");
    expect(list.status()).toBe(200);
    expect(await list.json()).toEqual(expect.arrayContaining([created]));

    const update = await request.patch(`/api/todos/${id}`, { data: { title: `${title} updated`, completed: true }, headers });
    expect(update.status()).toBe(200);
    expect(await update.json()).toEqual({ ...created, title: `${title} updated`, completed: true });
    expect((await request.delete(`/api/todos/${id}`, { headers })).status()).toBe(204);
    expect((await request.get(`/api/todos/${id}`)).status()).toBe(404);
    expect((await request.patch(`/api/todos/${id}`, { data: { completed: false }, headers })).status()).toBe(404);
    expect((await request.delete(`/api/todos/${id}`, { headers })).status()).toBe(404);
  } finally {
    await request.delete(`/api/todos/${id}`, { headers });
  }
});
