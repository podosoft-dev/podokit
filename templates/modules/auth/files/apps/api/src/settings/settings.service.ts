import { Injectable, type OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppSetting } from "./app-setting.entity";

/** Admin-editable feature flags. Stored in the DB so they can be toggled from the
 *  UI. The matching env var is only a first-run default (used until a value is
 *  saved). Keep secrets/infra (BETTER_AUTH_SECRET, POSTGRES_*, SMTP_*, OAuth
 *  client id/secret, ...) in the environment — those are not managed here. */
// Only features whose plugin can be mounted unconditionally and gated in the UI
// live via capabilities. Server-enforced flags (email verification, breach check,
// self-deletion) are read by the auth server at boot and stay in the environment.
export type FeatureFlag = "twoFactor" | "magicLink" | "emailOtp" | "username" | "multiSession";

const ENV_DEFAULT: Record<FeatureFlag, string> = {
  twoFactor: "AUTH_TWO_FACTOR",
  magicLink: "AUTH_MAGIC_LINK",
  emailOtp: "AUTH_EMAIL_OTP",
  username: "AUTH_USERNAME",
  multiSession: "AUTH_MULTI_SESSION",
};

export const FEATURE_FLAGS = Object.keys(ENV_DEFAULT) as FeatureFlag[];

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(@InjectRepository(AppSetting) private readonly repo: Repository<AppSetting>) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const rows = await this.repo.find();
      this.cache = new Map(rows.map((r) => [r.key, r.value]));
    } catch {
      // Table not migrated yet — fall back to env defaults until it exists.
      this.cache = new Map();
    }
  }

  /** DB value if an admin has set it, otherwise the env default (false if unset). */
  getBool(flag: FeatureFlag): boolean {
    const stored = this.cache.get(flag);
    if (stored !== undefined) return stored === "true";
    return process.env[ENV_DEFAULT[flag]] === "true";
  }

  flags(): Record<FeatureFlag, boolean> {
    return Object.fromEntries(FEATURE_FLAGS.map((f) => [f, this.getBool(f)])) as Record<FeatureFlag, boolean>;
  }

  async setMany(update: Partial<Record<FeatureFlag, boolean>>): Promise<Record<FeatureFlag, boolean>> {
    for (const flag of FEATURE_FLAGS) {
      const next = update[flag];
      if (typeof next === "boolean") {
        await this.repo.save({ key: flag, value: String(next) });
      }
    }
    await this.refresh();
    return this.flags();
  }
}
