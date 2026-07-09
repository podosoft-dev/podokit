import type { LayoutServerLoad } from "./$types";
import type { Capabilities } from "@podosoft/podokit-api-client";

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
  let capabilities: Capabilities = {
    twoFactor: false,
    providers: [],
    deleteAccount: false,
    auditLog: false,
    emailVerification: false,
    passwordBreachCheck: false,
    magicLink: false,
    emailOtp: false,
    username: false,
    multiSession: false,
    phoneNumber: false,
    apiKey: false,
    passkey: false,
    organization: false,
    roles: ["admin", "user"],
  };
  try {
    const res = await fetch("/api/account/capabilities");
    if (res.ok) capabilities = (await res.json()) as Capabilities;
  } catch {
    /* keep defaults */
  }
  return { user: locals.user, impersonating: !!locals.session?.impersonatedBy, capabilities };
};
