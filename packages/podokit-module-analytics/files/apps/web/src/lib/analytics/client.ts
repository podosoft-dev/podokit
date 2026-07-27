import type {
  AnalyticsAdminConfig,
  AnalyticsConfigUpdate,
  AnalyticsRealtime,
  AnalyticsReport,
} from "./types";

type ErrorEnvelope = { error?: { code?: string; message?: string } };

export class AnalyticsApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "AnalyticsApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw new AnalyticsApiError(
      body.error?.code ?? "ANALYTICS_REQUEST_FAILED",
      body.error?.message ?? "Analytics request failed.",
      response.status
    );
  }
  return response.json() as Promise<T>;
}

export function loadAnalyticsConfig(): Promise<AnalyticsAdminConfig> {
  return request<AnalyticsAdminConfig>("/admin/analytics/config");
}

export function updateAnalyticsConfig(
  update: AnalyticsConfigUpdate
): Promise<AnalyticsAdminConfig> {
  return request<AnalyticsAdminConfig>("/admin/analytics/config", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export function deleteAnalyticsCredentials(): Promise<AnalyticsAdminConfig> {
  return request<AnalyticsAdminConfig>("/admin/analytics/config/credentials", {
    method: "DELETE",
  });
}

export function testAnalyticsConnection(): Promise<AnalyticsAdminConfig> {
  return request<AnalyticsAdminConfig>("/admin/analytics/config/test", {
    method: "POST",
  });
}

export function loadAnalyticsReport(
  from: string,
  to: string
): Promise<AnalyticsReport> {
  const query = new URLSearchParams({ from, to });
  return request<AnalyticsReport>(`/admin/analytics/report?${query}`);
}

export function loadAnalyticsRealtime(): Promise<AnalyticsRealtime> {
  return request<AnalyticsRealtime>("/admin/analytics/realtime");
}
