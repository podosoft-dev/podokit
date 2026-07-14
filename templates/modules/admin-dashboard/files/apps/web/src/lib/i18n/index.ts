import { getContext, setContext } from "svelte";
import { site } from "$lib/site.svelte";
import type { Locale, Messages } from "./messages";

const KEY = Symbol.for("podokit.i18n");

export type I18nContext = { readonly t: Messages; readonly locale: Locale };

export function setI18nContext(ctx: I18nContext): void {
  setContext(KEY, ctx);
}

export function getI18n(): I18nContext {
  return getContext(KEY) as I18nContext;
}

// Fill {name}-style placeholders in a message.
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

// Render a timestamp in the site's configured timezone when an admin has set one
// (Settings → General), otherwise in the viewer's own browser timezone. Used
// across all pages.
export function formatDateTime(value: string | Date): string {
  const date = new Date(value);
  const timeZone = site.value.timezone || undefined;
  if (timeZone) {
    // A misconfigured timezone would throw a RangeError — fall back to the
    // browser default rather than breaking the page.
    try {
      return date.toLocaleString(undefined, { timeZone });
    } catch {
      /* invalid timeZone — use the browser default below */
    }
  }
  return date.toLocaleString();
}
