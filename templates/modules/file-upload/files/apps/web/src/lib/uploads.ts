import { ApiError, type ApiClient } from "@podosoft/podokit-api-client";
import { api } from "./api";

// Resumable uploads through the API's /files/uploads routes (file-upload module).
// Parts go to the same-origin /api/files/uploads path. The module declares it as
// a direct API path, so `podo add` lists it in the gateway's apiPaths and parts
// larger than the web server's BODY_SIZE_LIMIT reach the API.

export interface UploadSession {
  id: string;
  partSize: number;
  partCount: number;
  expiresAt: string;
}

export type UploadState = "open" | "completing" | "completed" | "aborted";

export interface UploadStatus extends UploadSession {
  status: UploadState;
  filename: string;
  contentType: string | null;
  size: number;
  receivedParts: number[];
  key?: string;
}

export interface UploadedFile {
  id: string;
  status: "completed";
  key: string;
  size: number;
  contentType: string | null;
  url: string;
}

export interface UploadOptions {
  /**
   * Called with the bytes sent so far. With the default client in a browser it
   * reports bytes as they leave; otherwise it reports when a part is stored.
   * The value never decreases: when a part fails, its bytes stop counting and
   * the value holds until the retry passes it.
   */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Aborting stops the transfer and cancels the upload on the server. */
  signal?: AbortSignal;
  /** Parts in flight at once. Defaults to 3. */
  concurrency?: number;
  /**
   * Further attempts for a request that fails with a network error, 408, 425,
   * 429, or 5xx. Defaults to 5.
   */
  retries?: number;
  /** First retry delay in milliseconds, doubled per attempt up to 30 s. A Retry-After header wins. Defaults to 500. */
  retryDelayMs?: number;
  /**
   * Defaults to the app's same-origin client, which sends parts with
   * XMLHttpRequest in a browser. A custom client sends parts with its fetch.
   */
  client?: ApiClient;
}

export interface NewUploadOptions extends UploadOptions {
  /** Defaults to the File's name. */
  filename?: string;
  /** Defaults to the Blob's type. */
  contentType?: string;
  /** Receives the session as soon as it exists; keep its id to resume after a reload. */
  onSession?: (session: UploadSession) => void;
}

const BASE = "/files/uploads";
/** The REST prefix of the default same-origin client in ./api. */
const API_PREFIX = "/api";
const MAX_DELAY_MS = 30_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The upload was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Network failures surface from fetch, and from sendPart, as a TypeError. */
function transient(error: unknown): boolean {
  return error instanceof ApiError ? RETRYABLE_STATUS.has(error.statusCode) : error instanceof TypeError;
}

/** Reads Retry-After as delay seconds or an HTTP date, as the API client does. */
function retryAfterSeconds(value: string | null): number | undefined {
  const header = value?.trim();
  if (!header) return undefined;
  if (/^\d+$/.test(header)) return Number(header);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** The API client's error for a failed response: the standard envelope, or HTTP_ERROR for text bodies. */
function responseError(request: XMLHttpRequest): ApiError {
  const retryAfter = retryAfterSeconds(request.getResponseHeader("retry-after"));
  let body: unknown;
  try {
    body = request.responseText ? JSON.parse(request.responseText) : undefined;
  } catch {
    body = undefined;
  }
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return new ApiError(
      typeof record.code === "string" ? record.code : "HTTP_ERROR",
      typeof record.message === "string" ? record.message : request.statusText,
      typeof record.statusCode === "number" ? record.statusCode : request.status,
      record.details,
      retryAfter,
    );
  }
  return new ApiError("HTTP_ERROR", request.statusText || "Request failed", request.status, undefined, retryAfter);
}

/**
 * PUTs one part with XMLHttpRequest, whose upload progress events report bytes
 * as the browser sends them; fetch has no upload progress.
 */
function sendPart(
  url: string,
  part: Blob,
  signal: AbortSignal | undefined,
  onBytes: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const request = new XMLHttpRequest();
    const onAbort = (): void => request.abort();
    const settle = (outcome: () => void): void => {
      signal?.removeEventListener("abort", onAbort);
      outcome();
    };
    request.open("PUT", url);
    // Same-origin requests carry the session cookie without withCredentials.
    request.withCredentials = false;
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.onprogress = (event) => onBytes(Math.min(event.loaded, part.size));
    request.onload = () =>
      settle(() => (request.status >= 200 && request.status < 300 ? resolve() : reject(responseError(request))));
    request.onerror = () => settle(() => reject(new TypeError("Network request failed")));
    request.onabort = () =>
      settle(() => reject(signal?.aborted ? abortReason(signal) : new DOMException("Aborted", "AbortError")));
    signal?.addEventListener("abort", onAbort, { once: true });
    request.send(part);
  });
}

class Transfer {
  private readonly client: ApiClient;
  private readonly signal?: AbortSignal;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly concurrency: number;
  /** Parts go through XMLHttpRequest only for the default client, whose URLs this file knows. */
  private readonly xhr: boolean;

  constructor(private readonly options: UploadOptions) {
    this.client = options.client ?? api;
    this.xhr = options.client === undefined && typeof XMLHttpRequest !== "undefined";
    this.signal = options.signal;
    this.retries = Math.max(0, options.retries ?? 5);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  }

  async attempt<T>(request: () => Promise<T>, retryable: (error: unknown) => boolean = transient): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(this.signal);
      try {
        return await request();
      } catch (error) {
        throwIfAborted(this.signal);
        if (attempt >= this.retries || !retryable(error)) throw error;
        const retryAfter = error instanceof ApiError ? error.retryAfterSeconds : undefined;
        const delay = retryAfter !== undefined
          ? retryAfter * 1000
          : Math.min(MAX_DELAY_MS, this.retryDelayMs * 2 ** attempt);
        await sleep(delay, this.signal);
      }
    }
  }

  create(body: { filename: string; size: number; contentType?: string }): Promise<UploadSession> {
    return this.attempt(() => this.client.post<UploadSession>(BASE, body, { signal: this.signal }));
  }

  status(id: string): Promise<UploadStatus> {
    return this.attempt(() => this.client.get<UploadStatus>(`${BASE}/${id}`, { signal: this.signal }));
  }

  /** Runs the transfer; when the caller aborts, cancels the upload and rethrows the abort reason. */
  async cancelOnAbort(id: string, transfer: () => Promise<UploadedFile>): Promise<UploadedFile> {
    try {
      return await transfer();
    } catch (error) {
      if (!this.signal?.aborted) throw error;
      // Sent without the caller's signal, which has just aborted.
      await this.client.del<void>(`${BASE}/${id}`).catch(() => undefined);
      throw abortReason(this.signal);
    }
  }

  private putPart(sessionId: string, partNumber: number, part: Blob, onBytes: (loaded: number) => void): Promise<void> {
    const path = `${BASE}/${sessionId}/parts/${partNumber}`;
    if (this.xhr) return sendPart(`${API_PREFIX}${path}`, part, this.signal, onBytes);
    return this.client
      .put(path, part, { contentType: "application/octet-stream", signal: this.signal })
      .then(() => undefined);
  }

  /** Sends the parts not yet stored, then completes the upload. */
  async run(session: UploadSession, file: Blob, stored: Iterable<number>): Promise<UploadedFile> {
    const size = (partNumber: number): number =>
      partNumber < session.partCount ? session.partSize : file.size - session.partSize * (session.partCount - 1);
    const all = Array.from({ length: session.partCount }, (_, index) => index + 1);
    const received = new Set(stored);
    let sent = 0;
    for (const partNumber of received) sent += size(partNumber);
    // Bytes of each part's current attempt. A failed attempt's entry is dropped,
    // so its retry starts from zero instead of counting those bytes twice, and
    // the reported value holds until the retry passes it.
    const inFlight = new Map<number, number>();
    let reported = -1;
    const report = (): void => {
      let bytes = sent;
      for (const loaded of inFlight.values()) bytes += loaded;
      if (bytes <= reported) return;
      reported = bytes;
      this.options.onProgress?.(bytes, file.size);
    };
    report();

    const send = async (numbers: number[]): Promise<void> => {
      const queue = [...numbers];
      let failure: { error: unknown } | undefined;
      const worker = async (): Promise<void> => {
        for (let partNumber = queue.shift(); partNumber !== undefined && !failure; partNumber = queue.shift()) {
          const start = (partNumber - 1) * session.partSize;
          const part = file.slice(start, start + size(partNumber));
          const number = partNumber;
          try {
            await this.attempt(async () => {
              try {
                await this.putPart(session.id, number, part, (loaded) => {
                  // A part sent again after completion reported it missing is already counted.
                  if (received.has(number)) return;
                  inFlight.set(number, loaded);
                  report();
                });
              } finally {
                inFlight.delete(number);
              }
            });
          } catch (error) {
            failure ??= { error };
            return;
          }
          if (!received.has(number)) {
            received.add(number);
            sent += part.size;
          }
          report();
        }
      };
      // Every worker settles before a failure is reported, so no part is still
      // in flight when the caller cancels the upload.
      await Promise.all(Array.from({ length: Math.min(this.concurrency, numbers.length) }, worker));
      if (failure) throw failure.error;
    };

    await send(all.filter((partNumber) => !received.has(partNumber)));
    for (let round = 0; ; round++) {
      try {
        return await this.attempt(
          () => this.client.post<UploadedFile>(`${BASE}/${session.id}/complete`, {}, { signal: this.signal }),
          (error) => transient(error) || (error instanceof ApiError && error.code === "UPLOAD_COMPLETING"),
        );
      } catch (error) {
        if (round > 0 || !(error instanceof ApiError)) throw error;
        // The server is the source of truth: resend what it lacks, once.
        if (error.code === "UPLOAD_INCOMPLETE") {
          const stored = new Set((await this.status(session.id)).receivedParts);
          await send(all.filter((partNumber) => !stored.has(partNumber)));
        } else if (error.code === "UPLOAD_INVALID_PART") {
          await send(all);
        } else {
          throw error;
        }
      }
    }
  }
}

/**
 * Uploads a file in parts and returns the stored file. Failed parts are
 * retried with backoff; aborting `signal` cancels the upload on the server.
 */
export async function uploadFile(file: Blob, options: NewUploadOptions = {}): Promise<UploadedFile> {
  const transfer = new Transfer(options);
  const named = typeof File !== "undefined" && file instanceof File && file.name !== "";
  const filename = options.filename ?? (named ? (file as File).name : "upload");
  const contentType = options.contentType ?? (file.type || undefined);
  const session = await transfer.create({
    filename,
    size: file.size,
    ...(contentType ? { contentType } : {}),
  });
  options.onSession?.(session);
  return transfer.cancelOnAbort(session.id, () => transfer.run(session, file, []));
}

/**
 * Continues an upload started earlier, for example before a page reload, with
 * the same file: only the parts the server has not stored are sent.
 */
export async function resumeUpload(id: string, file: Blob, options: UploadOptions = {}): Promise<UploadedFile> {
  const transfer = new Transfer(options);
  const status = await transfer.status(id);
  if (status.size !== file.size) {
    throw new Error(`The file has ${file.size} bytes, but upload ${id} expects ${status.size}`);
  }
  return transfer.cancelOnAbort(id, () => transfer.run(status, file, status.receivedParts));
}

/** Cancels an upload and discards its stored parts. */
export async function cancelUpload(id: string, options: { client?: ApiClient } = {}): Promise<void> {
  await (options.client ?? api).del<void>(`${BASE}/${id}`);
}
