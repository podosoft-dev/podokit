import { describe, expect, it } from "bun:test";
import { validateEnv } from "./env.validation";

describe("environment validation", () => {
  it("listens on every address and keeps SQLite under data/ by default", () => {
    expect(validateEnv({})).toMatchObject({ HOST: "0.0.0.0", SQLITE_PATH: "./data/podokit.sqlite" });
  });

  it("reads HOST and SQLITE_PATH", () => {
    expect(validateEnv({ HOST: " 127.0.0.1 ", SQLITE_PATH: "/var/lib/app/app.sqlite" }))
      .toMatchObject({ HOST: "127.0.0.1", SQLITE_PATH: "/var/lib/app/app.sqlite" });
    expect(() => validateEnv({ HOST: " " })).toThrow("Invalid environment");
  });
});
