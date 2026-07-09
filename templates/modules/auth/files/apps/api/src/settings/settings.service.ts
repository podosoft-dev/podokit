import { Injectable, type OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppSetting } from "./app-setting.entity";

/** Admin-editable feature flags — the DB (app_setting) is the single source of
 *  truth. Defaults are seeded by the InitAppSettings migration and changed live
 *  from the admin Settings page. Only features whose plugin can be mounted
 *  unconditionally live here; their endpoints are blocked server-side when off
 *  (see auth/feature-gate.ts). Server-enforced flags (email verification, breach
 *  check, self-deletion) and secrets/infra stay in the environment. */
export type FeatureFlag = "twoFactor" | "magicLink" | "emailOtp" | "username" | "multiSession" | "phoneNumber";

/** Shipped defaults — must match the rows seeded by the InitAppSettings migration.
 *  Used only defensively before the migration has run. phoneNumber is off by
 *  default because real delivery needs an SMS provider. */
export const FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
  twoFactor: true,
  magicLink: true,
  emailOtp: true,
  username: true,
  multiSession: true,
  phoneNumber: false,
};

export const FEATURE_FLAGS = Object.keys(FLAG_DEFAULTS) as FeatureFlag[];

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
      // Table not migrated yet — fall back to the shipped defaults until it exists.
      this.cache = new Map();
    }
  }

  /** DB value (migration-seeded or admin-set); shipped default if the row is missing. */
  getBool(flag: FeatureFlag): boolean {
    const stored = this.cache.get(flag);
    if (stored !== undefined) return stored === "true";
    return FLAG_DEFAULTS[flag];
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
