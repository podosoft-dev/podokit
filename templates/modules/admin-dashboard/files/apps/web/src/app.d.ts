import type { Locale } from "$lib/i18n/messages";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean | null;
  username?: string | null;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
};

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      session: { id: string; impersonatedBy?: string | null } | null;
      locale: Locale;
    }
  }
}

export {};
