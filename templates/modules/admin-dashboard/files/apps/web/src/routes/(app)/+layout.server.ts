import type { LayoutServerLoad } from "./$types";

type Capabilities = { twoFactor: boolean; providers: string[]; deleteAccount: boolean; auditLog: boolean };

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
  let capabilities: Capabilities = { twoFactor: false, providers: [], deleteAccount: false, auditLog: false };
  try {
    const res = await fetch("/api/account/capabilities");
    if (res.ok) capabilities = (await res.json()) as Capabilities;
  } catch {
    /* keep defaults */
  }
  return { user: locals.user, impersonating: !!locals.session?.impersonatedBy, capabilities };
};
