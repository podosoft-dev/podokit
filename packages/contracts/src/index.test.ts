import { describe, it, expect } from "vitest";
import {
  AppException,
  PROFILE_IMAGE_DIMENSIONS_INVALID,
  PROFILE_IMAGE_NOT_FOUND,
  PROFILE_IMAGE_POLICY,
  PROFILE_IMAGE_REQUIRED,
  PROFILE_IMAGE_TOO_LARGE,
  PROFILE_IMAGE_TYPE_INVALID,
  PUBLIC_SIGNUP_DISABLED,
  SIGNUP_APPROVAL_REQUIRED,
  type Capabilities,
  type ErrorEnvelope,
  type ProfileImageResponse,
} from "./index";

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

  it("exports one profile-image policy for the API and UI", () => {
    expect(PROFILE_IMAGE_POLICY).toEqual({
      maxBytes: 2_097_152,
      maxWidth: 2048,
      maxHeight: 2048,
      mimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    expect([
      PROFILE_IMAGE_REQUIRED,
      PROFILE_IMAGE_TYPE_INVALID,
      PROFILE_IMAGE_TOO_LARGE,
      PROFILE_IMAGE_DIMENSIONS_INVALID,
      PROFILE_IMAGE_NOT_FOUND,
    ]).toEqual([
      "PROFILE_IMAGE_REQUIRED",
      "PROFILE_IMAGE_TYPE_INVALID",
      "PROFILE_IMAGE_TOO_LARGE",
      "PROFILE_IMAGE_DIMENSIONS_INVALID",
      "PROFILE_IMAGE_NOT_FOUND",
    ]);
    const response: ProfileImageResponse = { image: "/api/profile-images/example.png" };
    expect(response.image).toContain("profile-images");
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
    expect(PUBLIC_SIGNUP_DISABLED).toBe("PUBLIC_SIGNUP_DISABLED");
    expect(envelope.error.code).toBe("X");
  });
});
