import { describe, expect, it } from "vitest";
import {
  hydrationFailure,
  PAGE_ERROR_GRACE_MS,
  verdict,
  type PageSnapshot,
  type PageTrouble,
} from "../../../templates/modules/admin-dashboard/files/tests/helpers/hydration";

const quiet: PageTrouble = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const errorPage = (status: number): PageSnapshot => ({
  url: "http://localhost:5001/admin/settings",
  status,
  title: `${status} Internal Error`,
  text: `${status} Internal Error`,
});

describe("generated hydration helper", () => {
  it("fails on the static error page the server sends", () => {
    expect(verdict(errorPage(500), quiet)).toBe("error-page");
    expect(verdict(errorPage(503), quiet)).toBe("error-page");
    expect(verdict(errorPage(404), quiet)).toBe("error-page");
  });

  it("fails on the static error page the client renders after a page error", () => {
    // The browser renders it into the document it hydrated, which answered 200.
    expect(verdict(errorPage(200), { ...quiet, pageErrors: ["Failed to fetch dynamically imported module"] })).toBe(
      "page-error",
    );
  });

  it("keeps waiting for a document that neither failed nor threw", () => {
    expect(verdict(errorPage(200), quiet)).toBe("wait");
    // Browsers that do not report the document status give 0.
    expect(verdict(errorPage(0), quiet)).toBe("wait");
  });

  it("names the page, its status, and what went wrong", () => {
    const message = hydrationFailure("error-page", errorPage(500), {
      pageErrors: [],
      consoleErrors: [],
      failedRequests: ["500 GET http://localhost:5001/admin/settings"],
    });
    expect(message).toContain("The server sent SvelteKit's static error page (src/error.html)");
    expect(message).toContain('http://localhost:5001/admin/settings (status 500) shows "500 Internal Error"');
    expect(message).toContain("Failed requests:\n  500 GET http://localhost:5001/admin/settings");
    expect(message).not.toContain("Page errors:");
  });

  it("explains a page that threw and stayed unhydrated, which the server never sees", () => {
    const failed = Array.from({ length: 10 }, (_, index) => `GET http://localhost:5001/m${index}.js: net::ERR_FAILED`);
    const message = hydrationFailure("page-error", errorPage(200), {
      pageErrors: ["TypeError: Failed to fetch dynamically imported module: http://localhost:5001/m0.js"],
      consoleErrors: ["TypeError: Failed to fetch dynamically imported module"],
      failedRequests: failed,
    });
    expect(message).toContain(`had not hydrated ${PAGE_ERROR_GRACE_MS / 1000} s later`);
    expect(message).toContain("SvelteKit renders src/error.html in the browser, and the server");
    expect(message).toContain("Page errors:\n  TypeError: Failed to fetch dynamically imported module");
    expect(message).toContain("Console errors:\n  TypeError");
    expect(message).toContain("  GET http://localhost:5001/m7.js: net::ERR_FAILED\n  ... and 2 more");
    expect(message).not.toContain("m8.js");
  });

  it("says so when the page could not be read", () => {
    expect(hydrationFailure("page-error", null, quiet)).toContain("The page could not be read.");
  });
});
