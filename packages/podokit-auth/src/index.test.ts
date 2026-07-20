import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  MAX_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_MINUTES,
  decryptSecret,
  encryptSecret,
  envAuthConfig,
  isSessionIdleTimeoutMinutes,
  resolveSessionIdleTimeoutMinutes,
  sessionIdleOptions,
  socialKey,
  SUPPORTED_PROVIDER_IDS,
} from "./index";

describe("secret envelope", () => {
  it("round-trips a value", () => {
    const secret = "s3cr3t-value";
    const envelope = encryptSecret(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.split("|")).toHaveLength(3);
    expect(decryptSecret(envelope)).toBe(secret);
  });
  it("rejects a tampered envelope", () => {
    const envelope = encryptSecret("x");
    const [iv, tag, ct] = envelope.split("|");
    expect(() => decryptSecret(`${iv}|${tag}|${Buffer.from("nope").toString("base64")}`)).toThrow();
  });
  it("throws on a malformed envelope", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow(/malformed/);
  });
});

describe("auth-config helpers", () => {
  it("envAuthConfig returns a config object", () => {
    const config = envAuthConfig();
    expect(config).toHaveProperty("social");
    expect(config).toHaveProperty("requireSignupApproval");
    expect(config.version).toBe("env");
  });
  it("reads the sign-up approval environment fallback", () => {
    const previous = process.env.AUTH_REQUIRE_SIGNUP_APPROVAL;
    try {
      process.env.AUTH_REQUIRE_SIGNUP_APPROVAL = "true";
      expect(envAuthConfig().requireSignupApproval).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AUTH_REQUIRE_SIGNUP_APPROVAL;
      else process.env.AUTH_REQUIRE_SIGNUP_APPROVAL = previous;
    }
  });
  it("reads and validates the session idle-timeout environment fallback", () => {
    const previous = process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
    try {
      process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = String(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
      expect(envAuthConfig().sessionIdleTimeoutMinutes).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
      process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = "4";
      expect(envAuthConfig().sessionIdleTimeoutMinutes).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
      else process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = previous;
    }
  });
  it("normalizes idle timeout values and builds sliding session options", () => {
    expect(isSessionIdleTimeoutMinutes(null)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MIN_SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MAX_SESSION_IDLE_TIMEOUT_MINUTES)).toBe(true);
    expect(isSessionIdleTimeoutMinutes(MIN_SESSION_IDLE_TIMEOUT_MINUTES - 1)).toBe(false);
    expect(isSessionIdleTimeoutMinutes(MAX_SESSION_IDLE_TIMEOUT_MINUTES + 1)).toBe(false);
    expect(isSessionIdleTimeoutMinutes(30.5)).toBe(false);
    expect(resolveSessionIdleTimeoutMinutes("30", null)).toBeNull();
    expect(sessionIdleOptions(null)).toBeUndefined();
    expect(sessionIdleOptions(30)).toEqual({ expiresIn: 1_800, updateAge: 60 });
  });
  it("SUPPORTED_PROVIDER_IDS gates provider keys and socialKey formats", () => {
    expect(SUPPORTED_PROVIDER_IDS.has("google")).toBe(true);
    expect(socialKey("google")).toBe("social.google");
  });
});
