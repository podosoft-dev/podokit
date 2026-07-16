import { describe, it, expect } from "vitest";
import { AppException, SIGNUP_APPROVAL_REQUIRED, type Capabilities, type ErrorEnvelope } from "./index";

describe("AppException", () => {
  it("carries a stable code and defaults the status", () => {
    const err = new AppException("EMAIL_TAKEN", "Email already registered");
    expect(err.code).toBe("EMAIL_TAKEN");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("AppException");
    expect(err).toBeInstanceOf(Error);
  });
  it("accepts an explicit status", () => {
    expect(new AppException("FORBIDDEN", "no", 403).statusCode).toBe(403);
  });
});

describe("contract shapes", () => {
  it("Capabilities and ErrorEnvelope are structurally usable", () => {
    const caps: Pick<Capabilities, "twoFactor" | "signupApprovalRequired" | "roles"> = {
      twoFactor: true,
      signupApprovalRequired: true,
      roles: ["admin"],
    };
    const envelope: ErrorEnvelope = {
      success: false,
      error: { code: "X", message: "m", statusCode: 400, path: "/x", timestamp: "t" },
    };
    expect(caps.roles).toEqual(["admin"]);
    expect(SIGNUP_APPROVAL_REQUIRED).toBe("SIGNUP_APPROVAL_REQUIRED");
    expect(envelope.error.code).toBe("X");
  });
});
