import { afterEach, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { LocalJobQueue } from "./local-job.queue";

let sql: SQL | undefined;

afterEach(async () => {
  await sql?.close();
  sql = undefined;
});

describe("local job queue", () => {
  it("persists and processes a job", async () => {
    sql = new SQL(":memory:");
    const queue = new LocalJobQueue(sql, { pollIntervalMs: 10 });
    const payloads: unknown[] = [];
    await queue.process("demo", (payload) => { payloads.push(payload); });
    const job = await queue.enqueue("demo", { text: "hello" });
    expect(await queue.runOnce()).toBe(true);
    expect(payloads).toEqual([{ text: "hello" }]);
    await expect(queue.get(job.id)).resolves.toMatchObject({
      status: "completed",
      attempts: 1,
    });
    queue.close();
  });

  it("retries failures and records the final error", async () => {
    sql = new SQL(":memory:");
    let now = 1_000;
    const queue = new LocalJobQueue(sql, { pollIntervalMs: 10, now: () => now });
    await queue.process("fail", () => { throw new Error("expected failure"); });
    const job = await queue.enqueue("fail", {}, { attempts: 2 });
    expect(await queue.runOnce()).toBe(true);
    expect((await queue.get(job.id))?.status).toBe("waiting");
    now += 10;
    expect(await queue.runOnce()).toBe(true);
    await expect(queue.get(job.id)).resolves.toMatchObject({
      status: "failed",
      attempts: 2,
      error: "expected failure",
    });
    queue.close();
  });
});
