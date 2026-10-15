import { createApiClient } from "@podosoft/podokit-api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeUpload, uploadFile, type UploadSession } from "./uploads";

const PART = 10;

// The default client in ./api, pointed at whichever fake server a test installs.
const defaultClient = vi.hoisted(() => ({
  fetch: (async () => {
    throw new Error("No fake server installed");
  }) as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
}));
vi.mock("./api", async () => {
  const { createApiClient } = await import("@podosoft/podokit-api-client");
  const fetch: typeof globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => defaultClient.fetch(input, init),
    { preconnect: globalThis.fetch.preconnect },
  );
  return { api: createApiClient({ fetch }) };
});

interface Session {
  id: string;
  size: number;
  partCount: number;
  parts: Map<number, number>;
  status: "open" | "completed" | "aborted";
}

type Reply = Response | undefined;

/** An in-memory stand-in for the API's /files/uploads routes. */
class FakeUploads {
  readonly sessions = new Map<string, Session>();
  readonly log: string[] = [];
  /** Answers the next matching request instead of the fake, once per entry. */
  readonly overrides: Array<{ match: string; reply: () => Response }> = [];
  private nextId = 1;
  inFlight = 0;
  maxInFlight = 0;
  /** Resolves part uploads only when released, to observe concurrency. */
  gate?: Promise<void>;

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const method = init.method ?? "GET";
    const route = `${method} ${url.pathname}`;
    this.log.push(route);
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
    const override = this.overrides.findIndex((entry) => route.endsWith(entry.match));
    if (override >= 0) {
      const [entry] = this.overrides.splice(override, 1);
      return entry?.reply() ?? json(500, {});
    }
    return (await this.handle(method, url.pathname, init)) ?? json(404, error("NOT_FOUND", 404));
  };

  private async handle(method: string, path: string, init: RequestInit): Promise<Reply> {
    const [, , , , id, action, number] = path.split("/");
    if (method === "POST" && path === "/api/files/uploads") {
      const body = JSON.parse(String(init.body)) as { size: number };
      const session: Session = {
        id: `u${this.nextId++}`,
        size: body.size,
        partCount: Math.max(1, Math.ceil(body.size / PART)),
        parts: new Map(),
        status: "open",
      };
      this.sessions.set(session.id, session);
      return json(201, { id: session.id, partSize: PART, partCount: session.partCount, expiresAt: "2026-01-02T00:00:00.000Z" });
    }
    const session = this.sessions.get(id ?? "");
    if (!session) return json(404, error("UPLOAD_NOT_FOUND", 404));
    if (method === "GET" && action === undefined) {
      return json(200, {
        id: session.id,
        status: session.status,
        size: session.size,
        partSize: PART,
        partCount: session.partCount,
        receivedParts: [...session.parts.keys()].sort((left, right) => left - right),
      });
    }
    if (method === "PUT" && action === "parts") {
      if (session.status === "aborted") return json(410, error("UPLOAD_ABORTED", 410));
      const headers = new Headers(init.headers);
      expect(headers.get("content-type")).toBe("application/octet-stream");
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        await this.gate;
        if (init.signal?.aborted) throw init.signal.reason;
        const bytes = await (init.body as Blob).arrayBuffer();
        session.parts.set(Number(number), bytes.byteLength);
        return json(200, { partNumber: Number(number), size: bytes.byteLength });
      } finally {
        this.inFlight -= 1;
      }
    }
    if (method === "POST" && action === "complete") {
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      if (session.parts.size < session.partCount) return json(409, error("UPLOAD_INCOMPLETE", 409));
      session.status = "completed";
      return json(200, { id: session.id, status: "completed", key: `uploads/${session.id}`, size: session.size, contentType: null, url: "/files/x" });
    }
    if (method === "DELETE" && action === undefined) {
      session.status = "aborted";
      return new Response(null, { status: 204 });
    }
    return undefined;
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function error(code: string, statusCode: number): unknown {
  return { success: false, error: { code, message: code, statusCode, path: "/", timestamp: "" } };
}

function file(size: number): File {
  return new File([new Uint8Array(size).fill(7)], "data.bin", { type: "application/octet-stream" });
}

function setup(): { server: FakeUploads; client: ReturnType<typeof createApiClient> } {
  const server = new FakeUploads();
  const fetch: typeof globalThis.fetch = Object.assign(server.fetch, { preconnect: globalThis.fetch.preconnect });
  return { server, client: createApiClient({ fetch }) };
}

/**
 * A browser XMLHttpRequest backed by the fake server. Like a browser, it
 * reports the body as sent, in two steps, before the server answers, so a
 * failed attempt leaves bytes that were reported but never stored.
 */
class FakeXhr {
  static server: FakeUploads;
  static readonly requests: FakeXhr[] = [];
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 0;
  statusText = "";
  responseText = "";
  method = "";
  url = "";
  aborted = false;
  readonly headers = new Headers();
  private responseHeaders = new Headers();
  private readonly controller = new AbortController();

  constructor() {
    FakeXhr.requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name);
  }

  abort(): void {
    this.aborted = true;
    this.controller.abort(new DOMException("Aborted", "AbortError"));
    queueMicrotask(() => this.onabort?.());
  }

  send(body: Blob): void {
    void this.exchange(body);
  }

  private progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }

  private async exchange(body: Blob): Promise<void> {
    for (const loaded of [Math.floor(body.size / 2), body.size]) {
      await Promise.resolve();
      if (this.aborted) return;
      this.progress(loaded, body.size);
    }
    let response: Response;
    try {
      response = await FakeXhr.server.fetch(this.url, {
        method: this.method,
        headers: this.headers,
        body,
        signal: this.controller.signal,
      });
    } catch {
      if (!this.aborted) this.onerror?.();
      return;
    }
    if (this.aborted) return;
    this.status = response.status;
    this.statusText = response.statusText;
    this.responseHeaders = response.headers;
    this.responseText = await response.text();
    this.onload?.();
  }
}

/** A browser: XMLHttpRequest and the default client both reach a fresh fake server. */
function browser(): FakeUploads {
  const server = new FakeUploads();
  FakeXhr.server = server;
  FakeXhr.requests.length = 0;
  defaultClient.fetch = server.fetch;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return server;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("uploadFile", () => {
  it("sends every part with bounded concurrency, reports progress, and completes", async () => {
    const { server, client } = setup();
    let release = (): void => undefined;
    server.gate = new Promise((resolve) => { release = resolve; });
    const progress: Array<[number, number]> = [];
    const sessions: UploadSession[] = [];

    const done = uploadFile(file(95), {
      client,
      concurrency: 3,
      onProgress: (sent, total) => progress.push([sent, total]),
      onSession: (session) => sessions.push(session),
    });
    await vi.waitFor(() => expect(server.inFlight).toBe(3));
    release();
    const result = await done;

    expect(result).toMatchObject({ status: "completed", size: 95, key: "uploads/u1" });
    expect(sessions).toEqual([expect.objectContaining({ id: "u1", partCount: 10 })]);
    expect(server.maxInFlight).toBe(3);
    expect(server.sessions.get("u1")?.parts.get(10)).toBe(5);
    expect(progress[0]).toEqual([0, 95]);
    expect(progress.at(-1)).toEqual([95, 95]);
    expect(progress.map(([sent]) => sent)).toEqual([...progress.map(([sent]) => sent)].sort((a, b) => a - b));
    expect(server.log.filter((route) => route.startsWith("POST") && route.endsWith("/complete"))).toHaveLength(1);
  });

  it("retries a failed part after the Retry-After delay and after network errors", async () => {
    vi.useFakeTimers();
    const { server, client } = setup();
    server.overrides.push({ match: "/parts/2", reply: () => json(429, error("RATE_LIMIT_EXCEEDED", 429), { "retry-after": "7" }) });
    server.overrides.push({
      match: "/parts/3",
      reply: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const done = uploadFile(file(30), { client, concurrency: 1, retryDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(6_999);
    expect(server.sessions.get("u1")?.parts.has(2)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(100);
    const result = await done;
    expect(result.status).toBe("completed");
    expect(server.log.filter((route) => route.endsWith("/parts/2"))).toHaveLength(2);
    expect(server.log.filter((route) => route.endsWith("/parts/3"))).toHaveLength(2);
  });

  it("retries a gateway's non-JSON 502 page", async () => {
    const { server, client } = setup();
    server.overrides.push({ match: "/parts/1", reply: () => new Response("<html>Bad Gateway</html>", { status: 502 }) });
    expect((await uploadFile(file(10), { client, retryDelayMs: 0 })).status).toBe("completed");
    expect(server.log.filter((route) => route.endsWith("/parts/1"))).toHaveLength(2);
  });

  it("does not retry a request the server rejected and stops after the retry budget", async () => {
    const { server, client } = setup();
    server.overrides.push({ match: "/parts/1", reply: () => json(400, error("UPLOAD_PART_SIZE_MISMATCH", 400)) });
    await expect(uploadFile(file(10), { client })).rejects.toMatchObject({ code: "UPLOAD_PART_SIZE_MISMATCH" });
    expect(server.log.filter((route) => route.endsWith("/parts/1"))).toHaveLength(1);

    for (let index = 0; index < 3; index++) {
      server.overrides.push({ match: "/parts/1", reply: () => json(503, error("UNAVAILABLE", 503)) });
    }
    await expect(uploadFile(file(10), { client, retries: 2, retryDelayMs: 0 })).rejects.toMatchObject({ statusCode: 503 });
    expect(server.log.filter((route) => route === "PUT /api/files/uploads/u2/parts/1")).toHaveLength(3);
  });

  it("cancels the upload on the server when the signal aborts", async () => {
    const { server, client } = setup();
    const controller = new AbortController();
    let release = (): void => undefined;
    server.gate = new Promise((resolve) => { release = resolve; });
    const done = uploadFile(file(50), { client, signal: controller.signal });
    await vi.waitFor(() => expect(server.inFlight).toBeGreaterThan(0));
    controller.abort();
    release();

    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(server.log).toContain("DELETE /api/files/uploads/u1");
    expect(server.sessions.get("u1")?.status).toBe("aborted");
    expect(server.log.some((route) => route.endsWith("/complete"))).toBe(false);
  });

  it("resends missing parts once when completion reports the upload incomplete", async () => {
    const { server, client } = setup();
    server.overrides.push({ match: "/parts/2", reply: () => json(200, { partNumber: 2, size: PART }) });
    const result = await uploadFile(file(30), { client });
    expect(result.status).toBe("completed");
    expect(server.log.filter((route) => route.endsWith("/parts/2"))).toHaveLength(2);
    expect(server.log.filter((route) => route.endsWith("/complete"))).toHaveLength(2);
  });
});

describe("uploadFile in a browser", () => {
  it("sends parts with XMLHttpRequest and reports bytes as they are sent", async () => {
    const server = browser();
    const progress: number[] = [];

    const result = await uploadFile(file(25), {
      concurrency: 1,
      onProgress: (sent, total) => {
        expect(total).toBe(25);
        progress.push(sent);
      },
    });

    expect(result).toMatchObject({ status: "completed", size: 25 });
    expect(progress).toEqual([0, 5, 10, 15, 20, 22, 25]);
    expect(FakeXhr.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "PUT /api/files/uploads/u1/parts/1",
      "PUT /api/files/uploads/u1/parts/2",
      "PUT /api/files/uploads/u1/parts/3",
    ]);
    for (const request of FakeXhr.requests) {
      expect(request.withCredentials).toBe(false);
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
    }
    expect(server.log.filter((route) => route.startsWith("POST"))).toEqual([
      "POST /api/files/uploads",
      "POST /api/files/uploads/u1/complete",
    ]);
  });

  it("drops a failed part's bytes and retries it after Retry-After without going backwards", async () => {
    vi.useFakeTimers();
    const server = browser();
    server.overrides.push({ match: "/parts/1", reply: () => json(429, error("RATE_LIMIT_EXCEEDED", 429), { "retry-after": "7" }) });
    const progress: number[] = [];
    const done = uploadFile(file(30), { concurrency: 2, onProgress: (sent) => progress.push(sent) });

    await vi.advanceTimersByTimeAsync(6_999);
    // Parts 2 and 3 are stored; the bytes part 1 reported before its 429 are no longer counted.
    expect([...(server.sessions.get("u1")?.parts.keys() ?? [])].sort()).toEqual([2, 3]);
    expect(progress.at(-1)).toBe(20);
    await vi.advanceTimersByTimeAsync(1);
    const result = await done;

    expect(result.status).toBe("completed");
    expect(server.log.filter((route) => route.endsWith("/parts/1"))).toHaveLength(2);
    expect(progress.at(-1)).toBe(30);
    expect(progress).toEqual([...new Set(progress)].sort((left, right) => left - right));
  });

  it("retries a network error and reads the error envelope of a rejected part", async () => {
    const server = browser();
    server.overrides.push({
      match: "/parts/1",
      reply: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect((await uploadFile(file(10), { retryDelayMs: 0 })).status).toBe("completed");
    expect(server.log.filter((route) => route.endsWith("/parts/1"))).toHaveLength(2);

    server.overrides.push({ match: "/parts/1", reply: () => json(400, error("UPLOAD_PART_SIZE_MISMATCH", 400)) });
    await expect(uploadFile(file(10))).rejects.toMatchObject({
      name: "ApiError",
      code: "UPLOAD_PART_SIZE_MISMATCH",
      statusCode: 400,
    });
  });

  it("aborts the request in flight and cancels the upload", async () => {
    const server = browser();
    const controller = new AbortController();
    let release = (): void => undefined;
    server.gate = new Promise((resolve) => { release = resolve; });
    const done = uploadFile(file(50), { signal: controller.signal });
    await vi.waitFor(() => expect(server.inFlight).toBe(3));
    controller.abort();
    release();

    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.requests).toHaveLength(3);
    expect(FakeXhr.requests.every((request) => request.aborted)).toBe(true);
    expect(server.log).toContain("DELETE /api/files/uploads/u1");
    expect(server.sessions.get("u1")?.status).toBe("aborted");
    expect(server.log.some((route) => route.endsWith("/complete"))).toBe(false);
  });

  it("sends parts with fetch when a custom client is given", async () => {
    const server = browser();
    const { server: other, client } = setup();
    expect((await uploadFile(file(20), { client })).status).toBe("completed");
    expect(FakeXhr.requests).toHaveLength(0);
    expect(server.log).toHaveLength(0);
    expect(other.log.filter((route) => route.startsWith("PUT"))).toHaveLength(2);
  });
});

describe("resumeUpload", () => {
  it("sends only the parts the server lacks and counts stored ones as progress", async () => {
    const { server, client } = setup();
    const data = file(45);
    const controller = new AbortController();
    server.overrides.push({ match: "/parts/3", reply: () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    } });
    await expect(uploadFile(data, { client, concurrency: 1, signal: controller.signal })).rejects.toBeDefined();
    // The first attempt was cancelled; start again and drop part 3 to resume.
    const session = server.sessions.get("u1");
    if (!session) throw new Error("no session");
    session.status = "open";
    session.parts.delete(3);
    server.log.length = 0;

    const progress: number[] = [];
    const result = await resumeUpload("u1", data, { client, onProgress: (sent) => progress.push(sent) });
    expect(result.status).toBe("completed");
    expect(server.log.filter((route) => route.startsWith("PUT")).sort()).toEqual([
      "PUT /api/files/uploads/u1/parts/3",
      "PUT /api/files/uploads/u1/parts/4",
      "PUT /api/files/uploads/u1/parts/5",
    ]);
    expect(progress[0]).toBe(20);
    expect(progress.at(-1)).toBe(45);
  });

  it("refuses a file of another size", async () => {
    const { server, client } = setup();
    const { id } = await client.post<UploadSession>("/files/uploads", { filename: "a", size: 20 });
    await expect(resumeUpload(id, file(21), { client })).rejects.toThrow("expects 20");
    expect(server.log.some((route) => route.startsWith("PUT"))).toBe(false);
  });
});
