import { expect } from "@playwright/test";
import { PROVIDERS } from "../../apps/api/src/config/providers";

// Bun sends the local storage provider's file streams chunked, without a
// Content-Length; the S3 provider and the web proxy keep the length of objects
// up to 2 MiB. A response without a length passes only with the local provider.
export function expectObjectLength(headers: Record<string, string>, size: number): void {
  const provider: string = PROVIDERS["object-storage"];
  const length = headers["content-length"];
  if (length === undefined && provider === "local") return;
  expect(length).toBe(String(size));
}
