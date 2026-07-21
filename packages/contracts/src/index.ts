/**
 * Shared PodoKit contracts. Pure types and small classes with zero runtime
 * dependencies, imported by both the NestJS backend and the SvelteKit frontend
 * so a single source defines the capability flags and the error shape.
 */

/**
 * Feature flags the backend reports at `GET /account/capabilities`. The frontend
 * gates UI on these; the backend derives them from settings. Kept in one place
 * so both sides cannot drift.
 */
export interface Capabilities {
  twoFactor: boolean;
  providers: string[];
  deleteAccount: boolean;
  auditLog: boolean;
  emailVerification: boolean;
  /** Require administrator approval before a newly registered user can sign in. */
  signupApprovalRequired: boolean;
  /** Reject passwords found in known breaches (Have I Been Pwned) on sign-up/change. */
  passwordBreachCheck: boolean;
  /** Passwordless sign-in via an emailed magic link. */
  magicLink: boolean;
  /** Passwordless sign-in via an emailed one-time code. */
  emailOtp: boolean;
  /** Sign in with a username instead of an email. */
  username: boolean;
  /** Hold several signed-in accounts in one browser and switch between them. */
  multiSession: boolean;
  /** Register and verify a phone number (SMS OTP). */
  phoneNumber: boolean;
  /** Issue and manage personal API keys. */
  apiKey: boolean;
  /** Register passkeys (WebAuthn) for passwordless sign-in. */
  passkey: boolean;
  /** Organizations: multi-tenant teams with members and invitations. */
  organization: boolean;
  /** Act as an OIDC identity provider (issue tokens to registered clients). */
  oidcProvider: boolean;
  /** Assignable role names (access-control). */
  roles: string[];
  /** Automatic logout after this many inactive minutes; null/absent means disabled. */
  sessionIdleTimeoutMinutes?: number | null;
}

/** Stable better-auth error code returned when a user still needs approval. */
export const SIGNUP_APPROVAL_REQUIRED = "SIGNUP_APPROVAL_REQUIRED" as const;

/** Stable better-auth error code returned when public registration is closed. */
export const PUBLIC_SIGNUP_DISABLED = "PUBLIC_SIGNUP_DISABLED" as const;

/** Shared upload limits for a user's profile image. The API enforces these
 * values and the account UI displays them before a file is selected. */
export const PROFILE_IMAGE_POLICY = {
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 2048,
  maxHeight: 2048,
  mimeTypes: ["image/png", "image/jpeg", "image/webp"],
} as const;

export type ProfileImageMimeType = (typeof PROFILE_IMAGE_POLICY.mimeTypes)[number];

/** Stable profile-image error codes used by both the API and account UI. */
export const PROFILE_IMAGE_REQUIRED = "PROFILE_IMAGE_REQUIRED" as const;
export const PROFILE_IMAGE_TYPE_INVALID = "PROFILE_IMAGE_TYPE_INVALID" as const;
export const PROFILE_IMAGE_TOO_LARGE = "PROFILE_IMAGE_TOO_LARGE" as const;
export const PROFILE_IMAGE_DIMENSIONS_INVALID = "PROFILE_IMAGE_DIMENSIONS_INVALID" as const;
export const PROFILE_IMAGE_NOT_FOUND = "PROFILE_IMAGE_NOT_FOUND" as const;

/** Response returned after uploading or removing the current user's image. */
export interface ProfileImageResponse {
  image: string | null;
}

/** The body of the standard REST error envelope. */
export interface ErrorBody {
  /** Stable, language-independent code the frontend branches on. */
  code: string;
  /** Human-readable message (not for branching). */
  message: string;
  statusCode: number;
  path: string;
  timestamp: string;
  details?: unknown;
}

/** The standard non-2xx response shape returned by the backend. */
export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
}

/**
 * Backend exception carrying a stable `code`. The global exception filter
 * renders it into an {@link ErrorEnvelope}. Pure (extends Error), so it lives in
 * contracts and both layers can reference the code space.
 */
export class AppException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppException";
  }
}
