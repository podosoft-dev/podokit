import { page } from "$app/state";
import { site } from "$lib/site.svelte";
import { messages, resolveLocale, type Locale, type Messages } from "./messages";

export type I18nContext = { readonly t: Messages; readonly locale: Locale };

function currentLocale(): Locale {
  return resolveLocale((page.data as { locale?: string }).locale);
}

export function getI18n(): I18nContext {
  return {
    get t() {
      return messages[currentLocale()];
    },
    get locale() {
      return currentLocale();
    },
  };
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
