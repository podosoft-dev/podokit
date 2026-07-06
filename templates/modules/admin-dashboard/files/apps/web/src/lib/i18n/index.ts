import { getContext, setContext } from "svelte";
import type { Locale, Messages } from "./messages";

const KEY = Symbol("i18n");

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
