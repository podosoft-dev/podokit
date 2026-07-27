import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { decryptSecret, encryptSecret } from "@podosoft/podokit-auth";
import { Repository } from "typeorm";
import { AppException } from "../common/app-exception";
import { AnalyticsConfig } from "./analytics-config.entity";
import {
  resolveAnalyticsProvider,
  type AnalyticsProviderConfig,
  type AnalyticsRange,
  type AnalyticsRealtime,
  type AnalyticsReport,
  type AnalyticsServiceAccount,
} from "./analytics.types";
import { Ga4AnalyticsProvider } from "./ga4-analytics.provider";
import type { UpdateAnalyticsConfigDto } from "./dto/update-analytics-config.dto";

const CONFIG_ID = "default";
const REPORT_CACHE_MS = 5 * 60 * 1000;
const REALTIME_CACHE_MS = 60 * 1000;

type CacheEntry<T> = { expiresAt: number; value: T };

export type AnalyticsAdminConfig = {
  enabled: boolean;
  provider: "ga4";
  measurementId: string;
  propertyId: string;
  hasCredentials: boolean;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
};

export type AnalyticsPublicConfig = {
  enabled: boolean;
  provider: "ga4";
  measurementId: string | null;
  consentMode: "advanced";
};

function parseServiceAccount(input: string): AnalyticsServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "Service-account credentials must be valid JSON.",
      400
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "Service-account credentials must be a JSON object.",
      400
    );
  }
  const object = value as Record<string, unknown>;
  const type = object.type;
  const clientEmail = object.client_email;
  const privateKey = object.private_key;
  const projectId = object.project_id;
  if (
    type !== "service_account" ||
    typeof clientEmail !== "string" ||
    !clientEmail.includes("@") ||
    typeof privateKey !== "string" ||
    !privateKey.includes("PRIVATE KEY")
  ) {
    throw new AppException(
      "ANALYTICS_CREDENTIALS_INVALID",
      "A Google service-account client_email and private_key are required.",
      400
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

function defaultRange(): AnalyticsRange {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 27);
  return { from: day(from), to: day(to) };
}

function dateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || day(parsed) !== value
    ? null
    : parsed;
}

@Injectable()
export class AnalyticsService {
  private readonly reportCache = new Map<string, CacheEntry<AnalyticsReport>>();
  private readonly realtimeCache = new Map<
    string,
    CacheEntry<AnalyticsRealtime>
  >();

  constructor(
    @InjectRepository(AnalyticsConfig)
    private readonly repository: Repository<AnalyticsConfig>,
    private readonly ga4: Ga4AnalyticsProvider
  ) {}

  async publicConfig(): Promise<AnalyticsPublicConfig> {
    const row = await this.getRow();
    const complete = Boolean(
      row.enabled &&
        row.measurementId &&
        row.propertyId &&
        row.encryptedCredentials
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

  async update(
    update: UpdateAnalyticsConfigDto
  ): Promise<AnalyticsAdminConfig> {
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
      const credentials = parseServiceAccount(update.serviceAccountJson);
      row.encryptedCredentials = encryptSecret(JSON.stringify(credentials));
      row.lastVerifiedAt = null;
    }
    if (update.enabled !== undefined) {
      if (
        update.enabled &&
        (!row.measurementId || !row.propertyId || !row.encryptedCredentials)
      ) {
        throw new AppException(
          "ANALYTICS_NOT_CONFIGURED",
          "Measurement ID, property ID, and credentials are required before enabling analytics.",
          400
        );
      }
      row.enabled = update.enabled;
    }
    const saved = await this.repository.save(row);
    this.clearCache();
    return this.toAdmin(saved);
  }

  async deleteCredentials(): Promise<AnalyticsAdminConfig> {
    const row = await this.getRow();
    row.encryptedCredentials = null;
    row.lastVerifiedAt = null;
    row.enabled = false;
    const saved = await this.repository.save(row);
    this.clearCache();
    return this.toAdmin(saved);
  }

  async verify(): Promise<AnalyticsAdminConfig> {
    const row = await this.getRow();
    const config = this.providerConfig(row);
    try {
      await resolveAnalyticsProvider(this.ga4).verify(config);
    } catch {
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics could not verify this property and credential.",
        503
      );
    }
    row.lastVerifiedAt = new Date();
    return this.toAdmin(await this.repository.save(row));
  }

  async report(from?: string, to?: string): Promise<AnalyticsReport> {
    const row = await this.getRow();
    const range = this.range(from, to);
    const cacheKey = `${row.propertyId ?? ""}:${range.from}:${range.to}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await resolveAnalyticsProvider(this.ga4).report(
        this.providerConfig(row),
        range
      );
      this.reportCache.set(cacheKey, {
        expiresAt: Date.now() + REPORT_CACHE_MS,
        value,
      });
      return value;
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics report data is temporarily unavailable.",
        503
      );
    }
  }

  async realtime(): Promise<AnalyticsRealtime> {
    const row = await this.getRow();
    const cacheKey = row.propertyId ?? "";
    const cached = this.realtimeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await resolveAnalyticsProvider(this.ga4).realtime(
        this.providerConfig(row)
      );
      this.realtimeCache.set(cacheKey, {
        expiresAt: Date.now() + REALTIME_CACHE_MS,
        value,
      });
      return value;
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        "ANALYTICS_PROVIDER_UNAVAILABLE",
        "Google Analytics realtime data is temporarily unavailable.",
        503
      );
    }
  }

  private async getRow(): Promise<AnalyticsConfig> {
    const existing = await this.repository.findOne({
      where: { id: CONFIG_ID },
    });
    return (
      existing ??
      this.repository.create({
        id: CONFIG_ID,
        enabled: false,
        provider: "ga4",
        measurementId: null,
        propertyId: null,
        encryptedCredentials: null,
        lastVerifiedAt: null,
      })
    );
  }

  private providerConfig(row: AnalyticsConfig): AnalyticsProviderConfig {
    if (!row.propertyId || !row.encryptedCredentials) {
      throw new AppException(
        "ANALYTICS_NOT_CONFIGURED",
        "Google Analytics property and credentials are not configured.",
        400
      );
    }
    let credentials: AnalyticsServiceAccount;
    try {
      credentials = parseServiceAccount(
        decryptSecret(row.encryptedCredentials)
      );
    } catch {
      throw new AppException(
        "ANALYTICS_CREDENTIALS_INVALID",
        "Stored Google Analytics credentials cannot be read.",
        400
      );
    }
    return { propertyId: row.propertyId, credentials };
  }

  private range(from?: string, to?: string): AnalyticsRange {
    const fallback = defaultRange();
    const resolved = { from: from ?? fallback.from, to: to ?? fallback.to };
    const start = dateOnly(resolved.from);
    const end = dateOnly(resolved.to);
    const today = dateOnly(day(new Date()));
    const days =
      start && end
        ? Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
        : 0;
    if (
      !start ||
      !end ||
      !today ||
      start > end ||
      end > today ||
      days < 1 ||
      days > 366
    ) {
      throw new AppException(
        "ANALYTICS_RANGE_INVALID",
        "Report dates must be a valid range of at most 366 days ending today or earlier.",
        400
      );
    }
    return resolved;
  }

  private toAdmin(row: AnalyticsConfig): AnalyticsAdminConfig {
    return {
      enabled: row.enabled,
      provider: row.provider,
      measurementId: row.measurementId ?? "",
      propertyId: row.propertyId ?? "",
      hasCredentials: Boolean(row.encryptedCredentials),
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }

  private clearCache(): void {
    this.reportCache.clear();
    this.realtimeCache.clear();
  }
}
