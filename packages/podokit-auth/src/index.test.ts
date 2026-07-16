import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, envAuthConfig, SUPPORTED_PROVIDER_IDS, socialKey } from "./index";

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
  it("SUPPORTED_PROVIDER_IDS gates provider keys and socialKey formats", () => {
    expect(SUPPORTED_PROVIDER_IDS.has("google")).toBe(true);
    expect(socialKey("google")).toBe("social.google");
  });
});
