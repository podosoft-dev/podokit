import { describe, expect, it } from "bun:test";
import { AppException } from "../common/app-exception";
import { analyticsRange, parseServiceAccount } from "./analytics.service";

describe("analytics validation", () => {
  it("accepts and normalizes a Google service account", () => {
    expect(parseServiceAccount(JSON.stringify({
      type: "service_account",
      client_email: "analytics@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----",
      project_id: "podokit",
    }))).toEqual({
      type: "service_account",
      clientEmail: "analytics@example.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----",
      projectId: "podokit",
    });
  });

  it("rejects malformed credentials without exposing their contents", () => {
    expect(() => parseServiceAccount("not-json")).toThrow(AppException);
    expect(() => parseServiceAccount(JSON.stringify({ type: "service_account" }))).toThrow(
      "client_email and private_key",
    );
  });

  it("accepts at most 366 days ending on the current day", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(analyticsRange("2025-08-24", "2026-08-24", now)).toEqual({
      from: "2025-08-24",
      to: "2026-08-24",
    });
    expect(() => analyticsRange("2025-08-23", "2026-08-24", now)).toThrow(
      "at most 366 days",
    );
    expect(() => analyticsRange("2026-08-25", "2026-08-25", now)).toThrow(AppException);
  });
});
