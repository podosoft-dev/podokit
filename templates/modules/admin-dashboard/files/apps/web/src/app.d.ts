import type { Locale } from "$lib/i18n/messages";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      session: { id: string } | null;
      locale: Locale;
    }
  }
}

export {};
