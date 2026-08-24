import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type {
  AnalyticsProvider,
  AnalyticsProviderConfig,
  AnalyticsRange,
  AnalyticsRealtime,
  AnalyticsReport,
} from "./analytics.types";

type Value = { value?: string | null };
type Row = {
  dimensionValues?: Value[] | null;
  metricValues?: Value[] | null;
};
type ReportRows = { rows?: Row[] | null };

function text(values: Value[] | null | undefined, index: number): string {
  return values?.[index]?.value ?? "";
}

function number(values: Value[] | null | undefined, index: number): number {
  const parsed = Number(text(values, index));
  return Number.isFinite(parsed) ? parsed : 0;
}

function client(config: AnalyticsProviderConfig): BetaAnalyticsDataClient {
  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: config.credentials.clientEmail,
      private_key: config.credentials.privateKey,
    },
    projectId: config.credentials.projectId,
  });
}

function property(config: AnalyticsProviderConfig): string {
  return `properties/${config.propertyId}`;
}

export class Ga4AnalyticsProvider implements AnalyticsProvider {
  async verify(config: AnalyticsProviderConfig): Promise<void> {
    const analytics = client(config);
    try {
      await analytics.runReport({
        property: property(config),
        dateRanges: [{ startDate: "today", endDate: "today" }],
        metrics: [{ name: "activeUsers" }],
        limit: 1,
      });
    } finally {
      await analytics.close();
    }
  }

  async report(
    config: AnalyticsProviderConfig,
    range: AnalyticsRange
  ): Promise<AnalyticsReport> {
    const analytics = client(config);
    const dateRanges = [{ startDate: range.from, endDate: range.to }];
    try {
      const [batch] = await analytics.batchRunReports({
        property: property(config),
        requests: [
          {
            dateRanges,
            metrics: [
              { name: "activeUsers" },
              { name: "newUsers" },
              { name: "sessions" },
              { name: "screenPageViews" },
              { name: "engagementRate" },
              { name: "averageSessionDuration" },
              { name: "keyEvents" },
            ],
          },
          {
            dateRanges,
            dimensions: [{ name: "date" }],
            metrics: [
              { name: "activeUsers" },
              { name: "sessions" },
              { name: "screenPageViews" },
              { name: "keyEvents" },
            ],
            orderBys: [{ dimension: { dimensionName: "date" } }],
          },
          {
            dateRanges,
            dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
            metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
            orderBys: [
              { metric: { metricName: "screenPageViews" }, desc: true },
            ],
            limit: 25,
          },
          {
            dateRanges,
            dimensions: [{ name: "sessionDefaultChannelGroup" }],
            metrics: [
              { name: "sessions" },
              { name: "activeUsers" },
              { name: "keyEvents" },
            ],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            limit: 25,
          },
          {
            dateRanges,
            dimensions: [{ name: "deviceCategory" }],
            metrics: [{ name: "activeUsers" }, { name: "sessions" }],
            orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          },
        ],
      });

      const reports = batch.reports ?? [];
      const summary = (reports[0] ?? {}) as ReportRows;
      const summaryValues = summary.rows?.[0]?.metricValues;
      const trend = (reports[1] ?? {}) as ReportRows;
      const pages = (reports[2] ?? {}) as ReportRows;
      const channels = (reports[3] ?? {}) as ReportRows;
      const devices = (reports[4] ?? {}) as ReportRows;

      return {
        range,
        totals: {
          activeUsers: number(summaryValues, 0),
          newUsers: number(summaryValues, 1),
          sessions: number(summaryValues, 2),
          views: number(summaryValues, 3),
          engagementRate: number(summaryValues, 4),
          averageSessionDuration: number(summaryValues, 5),
          keyEvents: number(summaryValues, 6),
        },
        trend: (trend.rows ?? []).map((row) => ({
          date: text(row.dimensionValues, 0),
          activeUsers: number(row.metricValues, 0),
          sessions: number(row.metricValues, 1),
          views: number(row.metricValues, 2),
          keyEvents: number(row.metricValues, 3),
        })),
        topPages: (pages.rows ?? []).map((row) => ({
          path: text(row.dimensionValues, 0),
          title: text(row.dimensionValues, 1),
          views: number(row.metricValues, 0),
          activeUsers: number(row.metricValues, 1),
        })),
        channels: (channels.rows ?? []).map((row) => ({
          channel: text(row.dimensionValues, 0),
          sessions: number(row.metricValues, 0),
          activeUsers: number(row.metricValues, 1),
          keyEvents: number(row.metricValues, 2),
        })),
        devices: (devices.rows ?? []).map((row) => ({
          device: text(row.dimensionValues, 0),
          activeUsers: number(row.metricValues, 0),
          sessions: number(row.metricValues, 1),
        })),
        generatedAt: new Date().toISOString(),
      };
    } finally {
      await analytics.close();
    }
  }

  async realtime(config: AnalyticsProviderConfig): Promise<AnalyticsRealtime> {
    const analytics = client(config);
    try {
      const [totalResult, pageResult] = await Promise.all([
        analytics.runRealtimeReport({
          property: property(config),
          metrics: [{ name: "activeUsers" }],
        }),
        analytics.runRealtimeReport({
          property: property(config),
          dimensions: [{ name: "unifiedPagePathScreen" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: 10,
        }),
      ]);
      const total = (totalResult[0] ?? {}) as ReportRows;
      const pages = (pageResult[0] ?? {}) as ReportRows;
      return {
        activeUsers: number(total.rows?.[0]?.metricValues, 0),
        topPages: (pages.rows ?? []).map((row) => ({
          path: text(row.dimensionValues, 0),
          activeUsers: number(row.metricValues, 0),
        })),
        generatedAt: new Date().toISOString(),
      };
    } finally {
      await analytics.close();
    }
  }
}
