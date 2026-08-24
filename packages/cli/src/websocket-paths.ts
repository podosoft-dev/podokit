const MAX_PATHS = 32;
const MAX_PATH_LENGTH = 2_048;
const SAFE_PATH = /^\/[A-Za-z0-9._~!$&'()+,;=:@/-]*$/;

export function parseExactWebSocketPaths(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Configuration field "${field}" must be an array of exact URL paths.`);
  }
  if (value.length > MAX_PATHS) {
    throw new Error(`Configuration field "${field}" must contain at most ${MAX_PATHS} paths.`);
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const path of value) {
    if (
      typeof path !== "string" ||
      path === "/" ||
      path.length > MAX_PATH_LENGTH ||
      !SAFE_PATH.test(path) ||
      path.includes("//") ||
      path.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(
        `Configuration field "${field}" must contain only static absolute paths such as "/events/ws". Root, patterns, queries, fragments, encoded separators, and traversal segments are not allowed.`,
      );
    }
    if (seen.has(path)) {
      throw new Error(`Configuration field "${field}" contains duplicate path "${path}".`);
    }
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
