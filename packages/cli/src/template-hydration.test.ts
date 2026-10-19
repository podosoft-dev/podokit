import { describe, expect, it, vi } from "vitest";
import {
  hydrationFailure,
  NETWORK_CHANGED,
  networkChanged,
  networkChangeNote,
  PAGE_ERROR_GRACE_MS,
  verdict,
  type PageSnapshot,
  type PageTrouble,
} from "../../../templates/modules/admin-dashboard/files/tests/helpers/hydration";

// The helper runs inside Playwright, which this workspace does not install.
vi.mock("@playwright/test", () => ({ test: {} }));

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
    // Local runs record no trace unless asked, so the message says how to get one.
    expect(message).toContain("rerun the file with E2E_TRACE=retain-on-failure to record one");
    expect(message).toContain("Page errors:\n  TypeError: Failed to fetch dynamically imported module");
    expect(message).toContain("Console errors:\n  TypeError");
    expect(message).toContain("  GET http://localhost:5001/m7.js: net::ERR_FAILED\n  ... and 2 more");
    expect(message).not.toContain("m8.js");
  });

  it("says so when the page could not be read", () => {
    expect(hydrationFailure("page-error", null, quiet)).toContain("The page could not be read.");
  });

  it("reloads only a load whose requests the browser dropped for a network change", () => {
    const dropped = (errorText: string): PageTrouble => ({
      ...quiet,
      pageErrors: ["TypeError: Failed to fetch dynamically imported module"],
      failedRequests: [`GET http://localhost:5001/src/routes/+layout.svelte: ${errorText}`],
    });
    expect(NETWORK_CHANGED).toBe("net::ERR_NETWORK_CHANGED");
    expect(networkChanged(dropped("net::ERR_NETWORK_CHANGED"))).toBe(true);
    // A broken module, a stopped server, or an aborted request is the test's error.
    expect(networkChanged(dropped("net::ERR_FAILED"))).toBe(false);
    expect(networkChanged(dropped("net::ERR_CONNECTION_REFUSED"))).toBe(false);
    expect(networkChanged(dropped("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
    expect(networkChanged({ ...quiet, failedRequests: ["500 GET http://localhost:5001/src/app.ts"] })).toBe(false);
    expect(networkChanged(quiet)).toBe(false);
  });

  it("notes the reload with the dropped requests and the first failure", () => {
    const note = networkChangeNote(
      "http://localhost:5001/admin/users",
      {
        ...quiet,
        failedRequests: [
          "GET http://localhost:5001/src/a.ts: net::ERR_NETWORK_CHANGED",
          "GET http://localhost:5001/src/b.ts: net::ERR_NETWORK_CHANGED",
          "GET http://localhost:5001/src/c.ts: net::ERR_FAILED",
        ],
      },
      new Error("The page threw an uncaught error and had not hydrated 5 s later.\nmore"),
    );
    expect(note).toContain("http://localhost:5001/admin/users: the browser dropped 2 request(s) with net::ERR_NETWORK_CHANGED");
    expect(note).toContain("so the page was loaded once more");
    expect(note).toContain("The first load failed with: The page threw an uncaught error and had not hydrated 5 s later.");
    // Only the first line of the failure: the second load's error, if any, has the rest.
    expect(note.endsWith("had not hydrated 5 s later.")).toBe(true);
  });
});
