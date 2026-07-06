import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user?.role !== "admin") {
    error(403, "Admins only");
  }
};
