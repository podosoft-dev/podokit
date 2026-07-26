export type AnalyticsProviderName = "ga4";

export type AnalyticsServiceAccount = {
  type: "service_account";
  projectId?: string;
  clientEmail: string;
  privateKey: string;
};

export type AnalyticsProviderConfig = {
  propertyId: string;
  credentials: AnalyticsServiceAccount;
};

export type AnalyticsRange = {
  from: string;
  to: string;
};

export type AnalyticsTotals = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  views: number;
  engagementRate: number;
  averageSessionDuration: number;
  keyEvents: number;
};

export type AnalyticsTrendRow = {
  date: string;
  activeUsers: number;
  sessions: number;
  views: number;
  keyEvents: number;
};

export type AnalyticsPageRow = {
  path: string;
  title: string;
  views: number;
  activeUsers: number;
};

export type AnalyticsChannelRow = {
  channel: string;
  sessions: number;
  activeUsers: number;
  keyEvents: number;
};

export type AnalyticsDeviceRow = {
  device: string;
  activeUsers: number;
  sessions: number;
};

export type AnalyticsReport = {
  range: AnalyticsRange;
  totals: AnalyticsTotals;
  trend: AnalyticsTrendRow[];
  topPages: AnalyticsPageRow[];
  channels: AnalyticsChannelRow[];
  devices: AnalyticsDeviceRow[];
  generatedAt: string;
};

export type AnalyticsRealtimePage = {
  path: string;
  activeUsers: number;
};

export type AnalyticsRealtime = {
  activeUsers: number;
  topPages: AnalyticsRealtimePage[];
  generatedAt: string;
};

export interface AnalyticsProvider {
  verify(config: AnalyticsProviderConfig): Promise<void>;
  report(
    config: AnalyticsProviderConfig,
    range: AnalyticsRange
  ): Promise<AnalyticsReport>;
  realtime(config: AnalyticsProviderConfig): Promise<AnalyticsRealtime>;
}

let overrideProvider: AnalyticsProvider | null = null;

/** Replace the reporting backend from the application-owned app.extensions.ts. */
export function setAnalyticsProvider(provider: AnalyticsProvider | null): void {
  overrideProvider = provider;
}

export function resolveAnalyticsProvider(
  fallback: AnalyticsProvider
): AnalyticsProvider {
  return overrideProvider ?? fallback;
}
