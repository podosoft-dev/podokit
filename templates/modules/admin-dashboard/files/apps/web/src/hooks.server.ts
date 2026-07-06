import type { Handle } from "@sveltejs/kit";
import { serverApiClient } from "$lib/server/api";

export const handle: Handle = async ({ event, resolve }) => {
  try {
    const { data } = await serverApiClient(event).auth.getSession();
    event.locals.user = (data?.user as App.Locals["user"]) ?? null;
    event.locals.session = data?.session ? { id: data.session.id } : null;
  } catch {
    event.locals.user = null;
    event.locals.session = null;
  }
  return resolve(event);
};
