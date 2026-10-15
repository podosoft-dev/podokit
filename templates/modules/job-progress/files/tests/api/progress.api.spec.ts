import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5001";
const origin = { origin: base };

type Playwright = PlaywrightWorkerArgs["playwright"];

async function session(playwright: Playwright): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: origin });
  const email = `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Podokit3e-Str0ng!pw", name: "P" } }).catch(() => undefined);
  return ctx;
}

async function signedIn(ctx: APIRequestContext): Promise<boolean> {
  const response = await ctx.get("/api/auth/get-session");
  if (!response.ok()) return false;
  const body = await response.json() as { user?: { id?: string } } | null;
  return Boolean(body?.user?.id);
}

class ProgressStream {
  private readonly decoder = new TextDecoder();
  private buffered = "";

  private constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly controller: AbortController,
  ) {}

  static async open(ctx: APIRequestContext): Promise<ProgressStream> {
    const controller = new AbortController();
    const cookie = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await fetch(`${base}/api/events/stream?topics=job-progress`, {
      headers: { ...origin, cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("event stream has no body");
    const stream = new ProgressStream(reader, controller);
    await stream.until("retry:");
    return stream;
  }

  async until(text: string, timeoutMs = 15_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!this.buffered.includes(text)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${text}`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      });
      const result = await Promise.race([this.reader.read(), timeout]);
      clearTimeout(timer);
      if (result === "timeout") continue;
      if (result.done) throw new Error(`stream ended before ${text}`);
      this.buffered += this.decoder.decode(result.value, { stream: true });
    }
    const end = this.buffered.indexOf(text) + text.length;
    const seen = this.buffered.slice(0, end);
    this.buffered = this.buffered.slice(end);
    return seen;
  }

  close(): void {
    this.controller.abort();
  }
}

function completed(jobId: string): string {
  return JSON.stringify({ topic: "job-progress", data: { jobId, progress: 100 } });
}

test("job-progress: starting a job returns a job id @smoke", async ({ playwright }) => {
  const ctx = await session(playwright);
  const res = await ctx.post("/api/progress", { data: { steps: 3 } });
  test.skip(res.status() >= 500, "redis not reachable");
  expect(res.ok()).toBeTruthy();
  expect(typeof (await res.json()).jobId).toBe("string");
  await ctx.dispose();
});

test("job-progress: progress reaches only the user who started the job", async ({ playwright }) => {
  const owner = await session(playwright);
  const other = await session(playwright);
  const streams: ProgressStream[] = [];
  try {
    test.skip(!(await signedIn(owner)) || !(await signedIn(other)), "requires the auth module");
    const ownerStream = await ProgressStream.open(owner);
    const otherStream = await ProgressStream.open(other);
    streams.push(ownerStream, otherStream);

    const started = await owner.post("/api/progress", { data: { steps: 2 } });
    test.skip(started.status() >= 500, "redis not reachable");
    expect(started.status()).toBe(201);
    const { jobId } = await started.json() as { jobId: string };
    await ownerStream.until(completed(jobId));

    // Every event the owner's job produced was published before the other user's
    // job started, so it would precede that job's completion on the other stream.
    const otherStarted = await other.post("/api/progress", { data: { steps: 1 } });
    expect(otherStarted.status()).toBe(201);
    const { jobId: otherJobId } = await otherStarted.json() as { jobId: string };
    expect(await otherStream.until(completed(otherJobId))).not.toContain(JSON.stringify(jobId));
  } finally {
    for (const stream of streams) stream.close();
    await owner.dispose();
    await other.dispose();
  }
});
