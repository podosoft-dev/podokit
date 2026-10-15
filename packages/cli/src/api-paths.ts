const MAX_PATHS = 32;
const MAX_PATH_LENGTH = 2_048;
const API_PATH = /^\/api(?:\/[A-Za-z0-9._~-]+)+\/?$/;

/** The prefix the gateway removes before a direct request reaches the API. */
export const API_PATH_PREFIX = "/api";

/** The path an entry names, without its optional trailing slash. */
export function apiPathBase(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Whether `base` covers `path`: the same path or any path below it. */
function covers(base: string, path: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Validate the direct API path allowlist. Each entry covers its own path and
 * every path below it, and must stay under /api/ outside the authentication
 * routes, because the gateway removes /api before the request reaches the API.
 */
export function parseApiPaths(
  value: unknown,
  field: string,
  webSocketPaths: readonly string[],
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Configuration field "${field}" must be an array of path prefixes under /api/.`);
  }
  if (value.length > MAX_PATHS) {
    throw new Error(`Configuration field "${field}" must contain at most ${MAX_PATHS} paths.`);
  }

  const paths: string[] = [];
  for (const path of value) {
    if (
      typeof path !== "string" ||
      path.length > MAX_PATH_LENGTH ||
      !API_PATH.test(path) ||
      path.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(
        `Configuration field "${field}" must contain only static path prefixes under /api/, such as "/api/files/uploads/". /api/ itself, patterns, queries, fragments, encoded characters, empty segments, and traversal segments are not allowed.`,
      );
    }
    const base = apiPathBase(path);
    if (covers("/api/auth", base)) {
      throw new Error(
        `Configuration field "${field}" cannot list "${path}": the API serves /api/auth/ with its prefix, so authentication routes always go through the web proxy.`,
      );
    }
    const overlap = paths.find((other) => {
      const otherBase = apiPathBase(other);
      return covers(otherBase, base) || covers(base, otherBase);
    });
    if (overlap !== undefined) {
      throw new Error(
        overlap === path
          ? `Configuration field "${field}" contains duplicate path "${path}".`
          : `Configuration field "${field}" contains overlapping paths "${overlap}" and "${path}".`,
      );
    }
    const socket = webSocketPaths.find((socketPath) => covers(base, socketPath));
    if (socket !== undefined) {
      throw new Error(
        `Configuration field "${field}" entry "${path}" covers WebSocket path "${socket}", which goes to the API without removing /api.`,
      );
    }
    paths.push(path);
  }
  return paths;
}

/** Plan text naming the paths that reach the API without the web proxy. */
export function directApiRoutes(apiPaths: readonly string[]): string {
  return apiPaths.length
    ? ` Route ${apiPaths.join(", ")} directly to the API without /api.`
    : "";
}
