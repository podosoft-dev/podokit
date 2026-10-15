export const UPLOAD_KEY_PREFIX = "uploads/";

const OWNER_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NAME_LENGTH = 128;

export type UploadAccess = "allowed" | "forbidden" | "not-found";

export interface UploadRequester {
  userId: string | undefined;
  admin: boolean;
}

/**
 * Keys are `uploads/<userId>/<uuid>-<name>`. Without a signed-in user (an app
 * without the auth module) the key has no owner segment, which is also the
 * format every upload had before ownership existed.
 */
export function uploadKey(
  userId: string | undefined,
  fileName: string,
  id: string = crypto.randomUUID(),
): string {
  const safeName = fileName.replace(/[^\w.-]+/g, "_").slice(-MAX_NAME_LENGTH);
  const name = `${id}-${safeName}`;
  if (userId === undefined) return `${UPLOAD_KEY_PREFIX}${name}`;
  if (!OWNER_SEGMENT.test(userId)) {
    throw new Error("The user id cannot be used as an upload key segment");
  }
  return `${UPLOAD_KEY_PREFIX}${userId}/${name}`;
}

/**
 * Owners and administrators may read owned uploads. Unowned uploads are
 * readable by administrators, and by requests without a user only when no
 * identity provider is installed; with auth, such requests never reach the
 * route because the session guard rejects them first.
 */
export function uploadAccess(key: string, requester: UploadRequester): UploadAccess {
  if (!key.startsWith(UPLOAD_KEY_PREFIX)) return "not-found";
  const segments = key.slice(UPLOAD_KEY_PREFIX.length).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "not-found";
  }
  if (segments.length === 1) {
    return requester.admin || requester.userId === undefined ? "allowed" : "forbidden";
  }
  if (segments.length === 2) {
    return requester.admin || segments[0] === requester.userId ? "allowed" : "forbidden";
  }
  return "not-found";
}
