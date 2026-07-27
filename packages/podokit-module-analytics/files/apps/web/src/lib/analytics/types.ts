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
  range: { from: string; to: string };
  totals: AnalyticsTotals;
  trend: AnalyticsTrendRow[];
  topPages: AnalyticsPageRow[];
  channels: AnalyticsChannelRow[];
  devices: AnalyticsDeviceRow[];
  generatedAt: string;
};

export type AnalyticsRealtime = {
  activeUsers: number;
  topPages: Array<{ path: string; activeUsers: number }>;
  generatedAt: string;
};

export type AnalyticsConfigUpdate = {
  enabled?: boolean;
  provider?: "ga4";
  measurementId?: string;
  propertyId?: string;
  serviceAccountJson?: string;
};
