import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The application's own `/api` proxy deadlines, read for deployment.
 *
 * The web server loads `APP_PROXY_TIMEOUTS` from an application-owned module, and
 * the idle timeouts a deployment renders have to outlast its longest entry. The
 * CLI must not run application code to learn them, so it reads the array literal
 * with a small tokenizer that accepts exactly the shape PodoKit generates and
 * documents: object literals with a string `pathPrefix` and a `timeoutMs` that is
 * `null` or a number, optionally a product such as `5 * 60_000`. Anything else is
 * reported, never guessed.
 */

export const APP_PROXY_TIMEOUTS_PATH = "apps/web/src/lib/server/proxy-timeouts.ts";

export interface AppProxyTimeout {
  pathPrefix: string;
  timeoutMs: number | null;
}

/** The entries, or why they could not be read without running the module. */
export type AppProxyTimeouts = { entries: AppProxyTimeout[] } | { error: string };

export const NO_APP_PROXY_TIMEOUTS: AppProxyTimeouts = { entries: [] };

interface Token {
  kind: "string" | "number" | "identifier" | "punctuation";
  value: string;
  line: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let index = 0;
  const fail = (message: string): never => {
    throw new Error(`${message} on line ${line}`);
  };
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\n") {
      line += 1;
      index += 1;
    } else if (/\s/.test(character)) {
      index += 1;
    } else if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) fail("an unterminated comment");
      line += source.slice(index, end).split("\n").length - 1;
      index = end + 2;
    } else if (character === '"' || character === "'" || character === "`") {
      let value = "";
      let cursor = index + 1;
      for (;;) {
        const next = source[cursor];
        if (next === undefined || next === "\n") fail("an unterminated string");
        if (next === character) break;
        if (next === "\\") {
          const escaped = source[cursor + 1];
          if (escaped === undefined || !"\\'\"`/".includes(escaped)) fail("an unsupported string escape");
          value += escaped;
          cursor += 2;
          continue;
        }
        if (character === "`" && next === "$" && source[cursor + 1] === "{") fail("a template literal with an expression");
        value += next;
        cursor += 1;
      }
      tokens.push({ kind: "string", value, line });
      index = cursor + 1;
    } else if (/[0-9]/.test(character)) {
      const match = /^[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index))!;
      tokens.push({ kind: "number", value: match[0], line });
      index += match[0].length;
    } else if (/[A-Za-z_$]/.test(character)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index))!;
      tokens.push({ kind: "identifier", value: match[0], line });
      index += match[0].length;
    } else if (source.startsWith("=>", index) || source.startsWith("...", index)) {
      const value = source.startsWith("=>", index) ? "=>" : "...";
      tokens.push({ kind: "punctuation", value, line });
      index += value.length;
    } else {
      tokens.push({ kind: "punctuation", value: character, line });
      index += 1;
    }
  }
  return tokens;
}

function numberValue(token: Token): number {
  const value = Number(token.value.replace(/_/g, ""));
  if (!Number.isFinite(value) || /_$|_\.|\._|__/.test(token.value)) {
    throw new Error(`an invalid number ${token.value} on line ${token.line}`);
  }
  return value;
}

/** Parses the `APP_PROXY_TIMEOUTS` array literal from the module's source text. */
export function parseAppProxyTimeouts(source: string): AppProxyTimeout[] {
  const tokens = tokenize(source);
  const declaration = tokens.findIndex(
    (token, index) =>
      token.kind === "identifier" &&
      token.value === "APP_PROXY_TIMEOUTS" &&
      tokens[index - 1]?.value === "const",
  );
  if (declaration === -1) throw new Error("no `const APP_PROXY_TIMEOUTS` declaration");
  let index = declaration + 1;
  while (index < tokens.length && tokens[index]!.value !== "=") index += 1;
  index += 1;
  /** Consumes the next token, which must satisfy `accepts`. */
  const take = (expected: string, accepts: (token: Token) => boolean): Token => {
    const token = tokens[index];
    if (!token) throw new Error(`${expected} expected at the end of the file`);
    if (!accepts(token)) {
      throw new Error(`${expected} expected, found ${JSON.stringify(token.value)} on line ${token.line}`);
    }
    index += 1;
    return token;
  };
  const punctuation = (...values: string[]) => (token: Token) =>
    token.kind === "punctuation" && values.includes(token.value);

  take("an array literal", punctuation("["));
  const entries: AppProxyTimeout[] = [];
  while (take("`{` or `]`", punctuation("{", "]")).value === "{") {
    const entry: Partial<AppProxyTimeout> = {};
    const property = (token: Token) =>
      punctuation("}")(token) || token.kind === "identifier" || token.kind === "string";
    let key = take("pathPrefix, timeoutMs, or `}`", property);
    while (key.kind !== "punctuation") {
      if ((key.value !== "pathPrefix" && key.value !== "timeoutMs") || key.value in entry) {
        throw new Error(`pathPrefix or timeoutMs expected, found ${JSON.stringify(key.value)} on line ${key.line}`);
      }
      take("`:`", punctuation(":"));
      if (key.value === "pathPrefix") {
        entry.pathPrefix = take("a string literal", (token) => token.kind === "string").value;
      } else {
        const value = take("null or a number", (token) => token.kind === "number" || (token.kind === "identifier" && token.value === "null"));
        let product: number | null = value.kind === "number" ? numberValue(value) : null;
        while (product !== null && tokens[index]?.value === "*") {
          index += 1;
          product *= numberValue(take("a number", (token) => token.kind === "number"));
        }
        entry.timeoutMs = product;
      }
      if (take("`,` or `}`", punctuation(",", "}")).value === "}") break;
      key = take("pathPrefix, timeoutMs, or `}`", property);
    }
    if (entry.pathPrefix === undefined || entry.timeoutMs === undefined) {
      throw new Error(`an entry without pathPrefix or timeoutMs before line ${tokens[index - 1]!.line}`);
    }
    if (entry.timeoutMs !== null && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1)) {
      throw new Error(
        `timeoutMs ${entry.timeoutMs} for ${entry.pathPrefix} is not a positive whole number of milliseconds`,
      );
    }
    entries.push({ pathPrefix: entry.pathPrefix, timeoutMs: entry.timeoutMs });
    if (take("`,` or `]`", punctuation(",", "]")).value === "]") break;
  }
  return entries;
}

/** Reads the application's deadlines; an app without the module has none. */
export function readAppProxyTimeouts(projectRoot: string): AppProxyTimeouts {
  const path = join(projectRoot, APP_PROXY_TIMEOUTS_PATH);
  if (!existsSync(path)) return NO_APP_PROXY_TIMEOUTS;
  try {
    return { entries: parseAppProxyTimeouts(readFileSync(path, "utf8")) };
  } catch (error) {
    return {
      error:
        `Cannot read APP_PROXY_TIMEOUTS from ${APP_PROXY_TIMEOUTS_PATH} without running it: ` +
        `${(error as Error).message}. Write each entry as { pathPrefix: "/api/...", timeoutMs: <milliseconds> | null } ` +
        "with literal values, or set CONNECTION_IDLE_TIMEOUT and API_IDLE_TIMEOUT in runtimeConfig yourself.",
    };
  }
}
