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

  it("creates its table on a later start after the database was unreachable", async () => {
    const database = new SQL(":memory:");
    sql = database;
    let unreachable = true;
    const flaky = new Proxy(database, {
      apply: (target, thisArg, args) =>
        unreachable
          ? Promise.reject(new Error("Connection refused"))
          : Reflect.apply(target, thisArg, args),
    });
    const queue = new LocalJobQueue(flaky, { pollIntervalMs: 10 });
    const payloads: unknown[] = [];
    await queue.process("demo", (payload) => { payloads.push(payload); });

    await expect(queue.start()).rejects.toThrow("Connection refused");
    unreachable = false;
    await queue.start();
    await queue.enqueue("demo", { text: "after outage" });
    for (let waited = 0; payloads.length === 0 && waited < 1_000; waited += 10) await Bun.sleep(10);
    expect(payloads).toEqual([{ text: "after outage" }]);
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
