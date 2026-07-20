import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import type { Capabilities } from "@podosoft/podokit-api-client";
import { requireBackendAvailable } from "$lib/server/guards";

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
  requireBackendAvailable(locals);

  let capabilities: Capabilities = {
    twoFactor: false,
    providers: [],
    deleteAccount: false,
    auditLog: false,
    emailVerification: false,
    signupApprovalRequired: false,
    passwordBreachCheck: false,
    magicLink: false,
    emailOtp: false,
    username: false,
    multiSession: false,
    phoneNumber: false,
    apiKey: false,
    passkey: false,
    organization: false,
    oidcProvider: false,
    roles: ["admin", "user"],
  };
  try {
    const res = await fetch("/api/account/capabilities");
    if (res.ok) capabilities = (await res.json()) as Capabilities;
  } catch {
    /* keep defaults */
  }

  // Require-two-factor policy: a signed-in user who hasn't enrolled is sent to the
  // enrolment page until they do (the API's TwoFactorRequiredGuard is the real
  // boundary; this is the UX). /setup-2fa lives outside this layout, so no loop.
  const user = locals.user as (App.Locals["user"] & { twoFactorEnabled?: boolean }) | null;
  let mustEnrol = false;
  if (user && !user.twoFactorEnabled) {
    try {
      const res = await fetch("/api/account/require-2fa");
      mustEnrol = res.ok && ((await res.json()) as { require2fa?: boolean }).require2fa === true;
    } catch {
      /* don't block the app if the policy check fails */
    }
  }
  if (mustEnrol) redirect(302, "/setup-2fa");

  return { user: locals.user, impersonating: !!locals.session?.impersonatedBy, capabilities };
};
