import { decryptSecret, encryptSecret } from "@podosoft/podokit-auth";
import type { SQL } from "bun";
import { AppException } from "../common/app-exception";
import {
  resolveAnalyticsProvider,
  type AnalyticsProviderConfig,
  type AnalyticsRange,
  type AnalyticsRealtime,
  type AnalyticsReport,
  type AnalyticsServiceAccount,
} from "./analytics.types";
import { Ga4AnalyticsProvider } from "./ga4-analytics.provider";

const CONFIG_ID = "default";
const REPORT_CACHE_MS = 5 * 60 * 1000;
const REALTIME_CACHE_MS = 60 * 1000;

type CacheEntry<T> = { expiresAt: number; value: T };

interface AnalyticsConfigRow {
  id: string;
  enabled: boolean;
  provider: "ga4";
  measurementId: string | null;
  propertyId: string | null;
  encryptedCredentials: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UpdateAnalyticsConfig {
  enabled?: boolean;
  provider?: "ga4";
  measurementId?: string;
  propertyId?: string;
  serviceAccountJson?: string;
}

export interface AnalyticsAdminConfig {
  enabled: boolean;
  provider: "ga4";
  measurementId: string;
  propertyId: string;
  hasCredentials: boolean;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
}

export interface AnalyticsPublicConfig {
  enabled: boolean;
  provider: "ga4";
  measurementId: string | null;
  consentMode: "advanced";
}

export function parseServiceAccount(input: string): AnalyticsServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "Service-account credentials must be valid JSON.",
      400,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "Service-account credentials must be a JSON object.",
      400,
    );
  }
  const object = value as Record<string, unknown>;
  const clientEmail = object.client_email;
  const privateKey = object.private_key;
  const projectId = object.project_id;
  if (
    object.type !== "service_account" ||
    typeof clientEmail !== "string" ||
    !clientEmail.includes("@") ||
    typeof privateKey !== "string" ||
    !privateKey.includes("PRIVATE KEY")
  ) {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "A Google service-account client_email and private_key are required.",
      400,
    );
  }
  return {
    type: "service_account",
    clientEmail,
    privateKey,
    ...(typeof projectId === "string" && projectId ? { projectId } : {}),
  };
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function defaultRange(now: Date): AnalyticsRange {
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 27);
  return { from: day(from), to: day(to) };
}

function dateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || day(parsed) !== value ? null : parsed;
}

export function analyticsRange(from?: string, to?: string, now = new Date()): AnalyticsRange {
  const fallback = defaultRange(now);
  const resolved = { from: from ?? fallback.from, to: to ?? fallback.to };
  const start = dateOnly(resolved.from);
  const end = dateOnly(resolved.to);
  const today = dateOnly(day(now));
  const days = start && end
    ? Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    : 0;
  if (!start || !end || !today || start > end || end > today || days < 1 || days > 366) {
    throw new AppException(
      "ANALYTICS_RANGE_INVALID",
      "Report dates must be a valid range of at most 366 days ending today or earlier.",
      400,
    );
  }
  return resolved;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export class AnalyticsService {
  private readonly reportCache = new Map<string, CacheEntry<AnalyticsReport>>();
  private readonly realtimeCache = new Map<string, CacheEntry<AnalyticsRealtime>>();

  constructor(
    private readonly sql: SQL,
    private readonly ga4 = new Ga4AnalyticsProvider(),
  ) {}

  async publicConfig(): Promise<AnalyticsPublicConfig> {
    const row = await this.getRow();
    const complete = Boolean(
      row.enabled && row.measurementId && row.propertyId && row.encryptedCredentials,
    );
    return {
      enabled: complete && process.env.NODE_ENV === "production",
      provider: "ga4",
      measurementId: complete ? row.measurementId : null,
      consentMode: "advanced",
    };
  }

  async adminConfig(): Promise<AnalyticsAdminConfig> {
    return this.toAdmin(await this.getRow());
  }

  async update(update: UpdateAnalyticsConfig): Promise<AnalyticsAdminConfig> {
    const row = await this.getRow();
    if (update.provider !== undefined) row.provider = update.provider;
    if (update.measurementId !== undefined) {
      row.measurementId = update.measurementId.trim();
      row.lastVerifiedAt = null;
    }
    if (update.propertyId !== undefined) {
      row.propertyId = update.propertyId.trim();
      row.lastVerifiedAt = null;
    }
    if (update.serviceAccountJson !== undefined) {
      row.encryptedCredentials = encryptSecret(JSON.stringify(
        parseServiceAccount(update.serviceAccountJson),
      ));
      row.lastVerifiedAt = null;
    }
    if (update.enabled !== undefined) {
      if (update.enabled && (!row.measurementId || !row.propertyId || !row.encryptedCredentials)) {
        throw new AppException(
          "ANALYTICS_NOT_CONFIGURED",
          "Measurement ID, property ID, and credentials are required before enabling analytics.",
          400,
        );
      }
      row.enabled = update.enabled;
    }
    const saved = await this.save(row);
    this.clearCache();
    return this.toAdmin(saved);
  }

  async deleteCredentials(): Promise<AnalyticsAdminConfig> {
    const row = await this.getRow();
    row.encryptedCredentials = null;
    row.lastVerifiedAt = null;
    row.enabled = false;
    const saved = await this.save(row);
    this.clearCache();
    return this.toAdmin(saved);
  }

  async verify(): Promise<AnalyticsAdminConfig> {
    const row = await this.getRow();
    try {
      await resolveAnalyticsProvider(this.ga4).verify(this.providerConfig(row));
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics could not verify this property and credential.",
        503,
      );
    }
    row.lastVerifiedAt = new Date();
    return this.toAdmin(await this.save(row));
  }

  async report(from?: string, to?: string): Promise<AnalyticsReport> {
    const row = await this.getRow();
    const range = analyticsRange(from, to);
    const cacheKey = `${row.propertyId ?? ""}:${range.from}:${range.to}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await resolveAnalyticsProvider(this.ga4).report(
        this.providerConfig(row),
        range,
      );
      this.reportCache.set(cacheKey, { expiresAt: Date.now() + REPORT_CACHE_MS, value });
      return value;
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics report data is temporarily unavailable.",
        503,
      );
    }
  }

  async realtime(): Promise<AnalyticsRealtime> {
    const row = await this.getRow();
    const cacheKey = row.propertyId ?? "";
    const cached = this.realtimeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await resolveAnalyticsProvider(this.ga4).realtime(this.providerConfig(row));
      this.realtimeCache.set(cacheKey, { expiresAt: Date.now() + REALTIME_CACHE_MS, value });
      return value;
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics realtime data is temporarily unavailable.",
        503,
      );
    }
  }

  private async getRow(): Promise<AnalyticsConfigRow> {
    const [row] = await this.sql<AnalyticsConfigRow[]>`
      SELECT * FROM "analytics_config" WHERE "id" = ${CONFIG_ID} LIMIT 1
    `;
    return row ?? {
      id: CONFIG_ID,
      enabled: false,
      provider: "ga4",
      measurementId: null,
      propertyId: null,
      encryptedCredentials: null,
      lastVerifiedAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  private async save(row: AnalyticsConfigRow): Promise<AnalyticsConfigRow> {
    const [saved] = await this.sql<AnalyticsConfigRow[]>`
      INSERT INTO "analytics_config" (
        "id", "enabled", "provider", "measurementId", "propertyId",
        "encryptedCredentials", "lastVerifiedAt"
      ) VALUES (
        ${row.id}, ${row.enabled}, ${row.provider}, ${row.measurementId}, ${row.propertyId},
        ${row.encryptedCredentials}, ${row.lastVerifiedAt}
      )
      ON CONFLICT ("id") DO UPDATE SET
        "enabled" = EXCLUDED."enabled",
        "provider" = EXCLUDED."provider",
        "measurementId" = EXCLUDED."measurementId",
        "propertyId" = EXCLUDED."propertyId",
        "encryptedCredentials" = EXCLUDED."encryptedCredentials",
        "lastVerifiedAt" = EXCLUDED."lastVerifiedAt",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING *
    `;
    if (!saved) throw new Error("Analytics configuration write returned no row");
    return saved;
  }

  private providerConfig(row: AnalyticsConfigRow): AnalyticsProviderConfig {
    if (!row.propertyId || !row.encryptedCredentials) {
      throw new AppException(
        "ANALYTICS_NOT_CONFIGURED",
        "Google Analytics property and credentials are not configured.",
        400,
      );
    }
    let credentials: AnalyticsServiceAccount;
    try {
      credentials = parseServiceAccount(decryptSecret(row.encryptedCredentials));
    } catch {
      throw new AppException(
        "ANALYTICS_CREDENTIALS_INVALID",
        "Stored Google Analytics credentials cannot be read.",
        400,
      );
    }
    return { propertyId: row.propertyId, credentials };
  }

  private toAdmin(row: AnalyticsConfigRow): AnalyticsAdminConfig {
    return {
      enabled: row.enabled,
      provider: row.provider,
      measurementId: row.measurementId ?? "",
      propertyId: row.propertyId ?? "",
      hasCredentials: Boolean(row.encryptedCredentials),
      lastVerifiedAt: iso(row.lastVerifiedAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private clearCache(): void {
    this.reportCache.clear();
    this.realtimeCache.clear();
  }
}
