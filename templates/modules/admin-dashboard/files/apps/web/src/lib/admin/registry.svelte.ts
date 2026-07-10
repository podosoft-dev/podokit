import type { Component } from "svelte";
import type { Messages } from "$lib/i18n/messages";

// Module-driven admin menu registry. Modules append their sidebar nav entries and
// settings tabs at the markers below via `podo add` injection, so the admin menu
// grows and shrinks with the installed module set — no edits to app-sidebar or
// the settings page. Empty until a module registers.

/** A sidebar nav entry contributed by a module. `key` is an i18n key under `nav`
 *  (the module adds it to every locale). */
export type AdminNavEntry = {
  href: string;
  key: keyof Messages["nav"];
  icon: Component;
  adminOnly?: boolean;
};

/** A settings tab contributed by a module: a tab value, a label resolved from the
 *  current locale, and the panel component. */
export type AdminSettingsSection = {
  value: string;
  label: (t: Messages) => string;
  component: Component;
};

export const moduleNavEntries: AdminNavEntry[] = [
  // podokit:begin:admin-nav
  // podokit:end:admin-nav
];

export const moduleSettingsSections: AdminSettingsSection[] = [
  // podokit:begin:admin-settings
  // podokit:end:admin-settings
];
