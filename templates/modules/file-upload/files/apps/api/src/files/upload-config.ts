import { MAX_MULTIPART_PARTS, MIN_MULTIPART_PART_BYTES } from "@podosoft/podokit-runtime";

const MIB = 1024 * 1024;

export interface UploadConfig {
  /** The largest file one chunked upload may hold. */
  maxBytes: number;
  /** Part size for uploads small enough to stay within MAX_MULTIPART_PARTS. */
  partBytes: number;
  /** Seconds an open upload may sit idle; each stored part restarts the clock. */
  sessionTtlSeconds: number;
  /** Seconds between sweeps of expired uploads. 0 turns the sweep off. */
  sweepIntervalSeconds: number;
  /** Part uploads per caller in each rate-limit window, when rate-limit is installed. */
  rateLimitMax: number;
}

export const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  maxBytes: 1024 * MIB,
  partBytes: 8 * MIB,
  sessionTtlSeconds: 24 * 60 * 60,
  sweepIntervalSeconds: 5 * 60,
  rateLimitMax: 3000,
};

export interface PartLayout {
  partSize: number;
  partCount: number;
}

/**
 * Splits `size` bytes into parts of at least `partBytes`. Files that would need
 * more than MAX_MULTIPART_PARTS parts get larger parts, rounded up to a whole
 * MiB, instead.
 */
export function partLayout(size: number, partBytes: number): PartLayout {
  const needed = Math.ceil(size / MAX_MULTIPART_PARTS);
  const partSize = Math.max(partBytes, Math.ceil(needed / MIB) * MIB);
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

/** The byte count part `partNumber` must have: `partSize`, except the last part. */
export function expectedPartSize(size: number, layout: PartLayout, partNumber: number): number {
  return partNumber < layout.partCount ? layout.partSize : size - layout.partSize * (layout.partCount - 1);
}

function wholeNumber(
  source: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
): number {
  const text = source[name]?.trim() ?? "";
  if (text === "") return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a whole number of at least ${minimum}`);
  }
  return value;
}

/**
 * Reads the FILE_UPLOAD_* settings. `maxRequestBodySize` is the API server's
 * body limit: the part size of the largest allowed upload must fit in it.
 */
export function uploadConfig(
  source: Record<string, string | undefined>,
  maxRequestBodySize: number,
): UploadConfig {
  const config: UploadConfig = {
    maxBytes: wholeNumber(source, "FILE_UPLOAD_MAX_BYTES", DEFAULT_UPLOAD_CONFIG.maxBytes, 1),
    partBytes: wholeNumber(
      source,
      "FILE_UPLOAD_PART_BYTES",
      DEFAULT_UPLOAD_CONFIG.partBytes,
      MIN_MULTIPART_PART_BYTES,
    ),
    sessionTtlSeconds: wholeNumber(
      source,
      "FILE_UPLOAD_SESSION_TTL",
      DEFAULT_UPLOAD_CONFIG.sessionTtlSeconds,
      60,
    ),
    sweepIntervalSeconds: wholeNumber(
      source,
      "FILE_UPLOAD_SWEEP_INTERVAL",
      DEFAULT_UPLOAD_CONFIG.sweepIntervalSeconds,
      0,
    ),
    rateLimitMax: wholeNumber(source, "FILE_UPLOAD_RATE_LIMIT_MAX", DEFAULT_UPLOAD_CONFIG.rateLimitMax, 1),
  };
  const largestPart = partLayout(config.maxBytes, config.partBytes).partSize;
  if (largestPart > maxRequestBodySize) {
    throw new Error(
      `Chunked uploads of FILE_UPLOAD_MAX_BYTES need ${largestPart}-byte parts, more than the API body limit of ${maxRequestBodySize} bytes; raise API_MAX_REQUEST_BODY_SIZE or lower FILE_UPLOAD_PART_BYTES or FILE_UPLOAD_MAX_BYTES`,
    );
  }
  return config;
}
