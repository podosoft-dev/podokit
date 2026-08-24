import { describe, expect, it } from "bun:test";
import {
  assertApiContract,
  documentedApiRoutes,
  expectedApiRoutes,
  missingApiRoutes,
} from "./api-contract";

describe("API contract inventory", () => {
  it("covers the core, Todo, module, and Better Auth routes", () => {
    const expected = expectedApiRoutes("todo", ["auth", "redis", "file-upload"]);

    expect(expected).toContain("GET /health/ready");
    expect(expected).toContain("PATCH /todos/{id}");
    expect(expected).toContain("POST /api/auth/sign-in/email");
    expect(expected).toContain("PUT /cache/{key}");
    expect(expected).toContain("POST /files");
  });

  it("normalizes OpenAPI operations and reports an exact missing route", () => {
    const document = { paths: { "/health": { get: {} }, "/health/ready": { get: {} } } };

    expect(documentedApiRoutes(document)).toEqual(new Set(["GET /health", "GET /health/ready"]));
    expect(missingApiRoutes(document, "fullstack", ["redis"])).toEqual([
      "GET /cache/{key}",
      "PUT /cache/{key}",
    ]);
    expect(() => assertApiContract(document, "fullstack", ["redis"])).toThrow(
      "OpenAPI contract is missing routes",
    );
  });
});
