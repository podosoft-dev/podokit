import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_PROXY_TIMEOUTS_PATH,
  parseAppProxyTimeouts,
  readAppProxyTimeouts,
} from "./app-proxy-timeouts";

const TEMPLATE = resolve(process.cwd(), "..", "..", "templates", "fullstack", APP_PROXY_TIMEOUTS_PATH);
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function declare(entries: string): string {
  return (
    "// A comment that mentions APP_PROXY_TIMEOUTS = [nonsense]\n" +
    "export const APP_PROXY_TIMEOUTS: ReadonlyArray<{ pathPrefix: string; timeoutMs: number | null }> = [\n" +
    `${entries}\n];\n`
  );
}

describe("APP_PROXY_TIMEOUTS parsing", () => {
  it("reads the generated module as an empty list", () => {
    expect(parseAppProxyTimeouts(readFileSync(TEMPLATE, "utf8"))).toEqual([]);
  });

  it("reads literal entries, comments, separators, products, and trailing commas", () => {
    const source = declare(
      [
        "  /* a block comment, with { braces } */",
        '  { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null }, // no deadline',
        "  { timeoutMs: 120_000, pathPrefix: '/api/exports/' },",
        '  { "pathPrefix": `/api/reports/`, "timeoutMs": 5 * 60 * 1000, },',
      ].join("\n"),
    ).replace("];", "] as const;");
    expect(parseAppProxyTimeouts(source)).toEqual([
      { pathPrefix: "/api/hosts/:hostId/file-transfers", timeoutMs: null },
      { pathPrefix: "/api/exports/", timeoutMs: 120_000 },
      { pathPrefix: "/api/reports/", timeoutMs: 300_000 },
    ]);
  });

  it.each<[string, string]>([
    ["  ...SHARED_TIMEOUTS,", '`{` or `]` expected, found "..." on line 3'],
    ['  { pathPrefix: "/api/a/", timeoutMs: LONG },', 'null or a number expected, found "LONG" on line 3'],
    ['  { pathPrefix: "/api/a/", timeoutMs: minutes(5) },', 'null or a number expected, found "minutes"'],
    ['  { pathPrefix: `/api/${base}/`, timeoutMs: 1000 },', "a template literal with an expression on line 3"],
    ['  { pathPrefix: "/api/a/", timeoutMs: -1 },', 'null or a number expected, found "-"'],
    ['  { pathPrefix: "/api/a/", timeoutMs: 1.5 },', "not a positive whole number of milliseconds"],
    ['  { pathPrefix: "/api/a/" },', "an entry without pathPrefix or timeoutMs"],
    ['  { pathPrefix: "/api/a/", timeoutMs: 1000, methods: ["GET"] },', 'pathPrefix or timeoutMs expected, found "methods"'],
    ['  { pathPrefix: "/api/a/", timeoutMs: 1_000_ },', "an invalid number 1_000_"],
  ])("refuses what it cannot read without running it: %s", (entries, message) => {
    expect(() => parseAppProxyTimeouts(declare(entries))).toThrow(message);
  });

  it("refuses a module that builds the list some other way", () => {
    expect(() => parseAppProxyTimeouts("export const APP_PROXY_TIMEOUTS = load();\n")).toThrow(
      'an array literal expected, found "load" on line 1',
    );
    expect(() => parseAppProxyTimeouts("export { APP_PROXY_TIMEOUTS } from './shared';\n")).toThrow(
      "no `const APP_PROXY_TIMEOUTS` declaration",
    );
  });

  it("treats an app without the module as having no deadlines, and explains an unreadable one", () => {
    const root = mkdtempSync(join(tmpdir(), "podokit-proxy-timeouts-"));
    created.push(root);
    expect(readAppProxyTimeouts(root)).toEqual({ entries: [] });
    const path = join(root, APP_PROXY_TIMEOUTS_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, declare("  ...SHARED,"));
    const result = readAppProxyTimeouts(root);
    expect("error" in result && result.error).toContain(
      `Cannot read APP_PROXY_TIMEOUTS from ${APP_PROXY_TIMEOUTS_PATH} without running it: ` +
        '`{` or `]` expected, found "..." on line 3.',
    );
    expect("error" in result && result.error).toContain("set CONNECTION_IDLE_TIMEOUT and API_IDLE_TIMEOUT");
  });
});
