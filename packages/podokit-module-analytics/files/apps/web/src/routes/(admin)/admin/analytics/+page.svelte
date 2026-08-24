<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import DataTable, {
    DEFAULT_PAGE_SIZE,
    type DataTableColumn,
  } from "#lib/components/data-table.svelte";
  import {
    loadAnalyticsRealtime,
    loadAnalyticsReport,
  } from "#lib/analytics/client.js";
  import type {
    AnalyticsChannelRow,
    AnalyticsDeviceRow,
    AnalyticsPageRow,
    AnalyticsRealtime,
    AnalyticsReport,
    AnalyticsTrendRow,
  } from "#lib/analytics/types.js";
  import { getI18n } from "#lib/i18n/index.js";

  const i18n = getI18n();
  const number = new Intl.NumberFormat();
  const percent = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  function iso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  function daysAgo(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (days - 1));
    return iso(date);
  }

  let from = $state(daysAgo(28));
  let to = $state(iso(new Date()));
  let report = $state<AnalyticsReport | null>(null);
  let realtime = $state<AnalyticsRealtime | null>(null);
  let loading = $state(true);
  let error = $state(false);

  const trendColumns = $derived<DataTableColumn<AnalyticsTrendRow>[]>([
    { key: "date", label: i18n.t.analytics.dashboard.date, sortable: true },
    {
      key: "activeUsers",
      label: i18n.t.analytics.dashboard.activeUsers,
      sortable: true,
    },
    {
      key: "sessions",
      label: i18n.t.analytics.dashboard.sessions,
      sortable: true,
    },
    {
      key: "views",
      label: i18n.t.analytics.dashboard.views,
      sortable: true,
    },
    {
      key: "keyEvents",
      label: i18n.t.analytics.dashboard.keyEvents,
      sortable: true,
    },
  ]);
  const pageColumns = $derived<DataTableColumn<AnalyticsPageRow>[]>([
    {
      key: "path",
      label: i18n.t.analytics.dashboard.page,
      sortable: true,
    },
    {
      key: "title",
      label: i18n.t.analytics.dashboard.pageTitle,
      sortable: true,
      hideBelow: "md",
    },
    {
      key: "views",
      label: i18n.t.analytics.dashboard.views,
      sortable: true,
    },
    {
      key: "activeUsers",
      label: i18n.t.analytics.dashboard.activeUsers,
      sortable: true,
    },
  ]);
  const channelColumns = $derived<DataTableColumn<AnalyticsChannelRow>[]>([
    {
      key: "channel",
      label: i18n.t.analytics.dashboard.channel,
      sortable: true,
    },
    {
      key: "sessions",
      label: i18n.t.analytics.dashboard.sessions,
      sortable: true,
    },
    {
      key: "activeUsers",
      label: i18n.t.analytics.dashboard.activeUsers,
      sortable: true,
    },
    {
      key: "keyEvents",
      label: i18n.t.analytics.dashboard.keyEvents,
      sortable: true,
    },
  ]);
  const deviceColumns = $derived<DataTableColumn<AnalyticsDeviceRow>[]>([
    {
      key: "device",
      label: i18n.t.analytics.dashboard.device,
      sortable: true,
    },
    {
      key: "activeUsers",
      label: i18n.t.analytics.dashboard.activeUsers,
      sortable: true,
    },
    {
      key: "sessions",
      label: i18n.t.analytics.dashboard.sessions,
      sortable: true,
    },
  ]);

  async function load(): Promise<void> {
    loading = true;
    error = false;
    try {
      [report, realtime] = await Promise.all([
        loadAnalyticsReport(from, to),
        loadAnalyticsRealtime(),
      ]);
    } catch {
      report = null;
      realtime = null;
      error = true;
    } finally {
      loading = false;
    }
  }

  function preset(days: number): void {
    from = daysAgo(days);
    to = iso(new Date());
    void load();
  }

  onMount(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
    <div>
      <h1 class="text-2xl font-semibold">{i18n.t.analytics.dashboard.title}</h1>
      <p class="text-muted-foreground text-sm">
        {i18n.t.analytics.dashboard.description}
      </p>
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <Button variant="outline" size="sm" onclick={() => preset(7)}>7</Button>
      <Button variant="outline" size="sm" onclick={() => preset(28)}>28</Button>
      <Button variant="outline" size="sm" onclick={() => preset(90)}>90</Button>
      <Input aria-label={i18n.t.analytics.dashboard.from} type="date" bind:value={from} class="w-auto" />
      <Input aria-label={i18n.t.analytics.dashboard.to} type="date" bind:value={to} class="w-auto" />
      <Button size="sm" disabled={loading} onclick={load}>
        {i18n.t.analytics.dashboard.apply}
      </Button>
    </div>
  </div>

  {#if error}
    <Card.Root>
      <Card.Header>
        <Card.Title>{i18n.t.analytics.dashboard.unavailable}</Card.Title>
        <Card.Description>
          {i18n.t.analytics.dashboard.unavailableHelp}
        </Card.Description>
      </Card.Header>
      <Card.Footer>
        <Button variant="outline" onclick={() => goto("/admin/settings")}>
          {i18n.t.analytics.dashboard.openSettings}
        </Button>
      </Card.Footer>
    </Card.Root>
  {:else if loading || !report}
    <p class="text-muted-foreground">{i18n.t.analytics.dashboard.loading}</p>
  {:else}
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.realtime}</Card.Description>
          <Card.Title class="text-3xl">{number.format(realtime?.activeUsers ?? 0)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.activeUsers}</Card.Description>
          <Card.Title class="text-3xl">{number.format(report.totals.activeUsers)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.sessions}</Card.Description>
          <Card.Title class="text-3xl">{number.format(report.totals.sessions)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.views}</Card.Description>
          <Card.Title class="text-3xl">{number.format(report.totals.views)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.newUsers}</Card.Description>
          <Card.Title class="text-3xl">{number.format(report.totals.newUsers)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.engagementRate}</Card.Description>
          <Card.Title class="text-3xl">{percent.format(report.totals.engagementRate)}</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.averageSession}</Card.Description>
          <Card.Title class="text-3xl">{number.format(Math.round(report.totals.averageSessionDuration))}s</Card.Title>
        </Card.Header>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Description>{i18n.t.analytics.dashboard.keyEvents}</Card.Description>
          <Card.Title class="text-3xl">{number.format(report.totals.keyEvents)}</Card.Title>
        </Card.Header>
      </Card.Root>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold">{i18n.t.analytics.dashboard.trend}</h2>
      <DataTable
        columns={trendColumns}
        rows={report.trend}
        getKey={(row) => row.date}
        empty={i18n.t.analytics.dashboard.empty}
        perPage={DEFAULT_PAGE_SIZE}
      >
        {#snippet row(item)}
          <Table.Cell>{item.date}</Table.Cell>
          <Table.Cell>{number.format(item.activeUsers)}</Table.Cell>
          <Table.Cell>{number.format(item.sessions)}</Table.Cell>
          <Table.Cell>{number.format(item.views)}</Table.Cell>
          <Table.Cell>{number.format(item.keyEvents)}</Table.Cell>
        {/snippet}
      </DataTable>
    </section>

    <section class="grid gap-6 xl:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-3">
        <h2 class="text-lg font-semibold">{i18n.t.analytics.dashboard.topPages}</h2>
        <DataTable columns={pageColumns} rows={report.topPages} getKey={(row) => `${row.path}:${row.title}`} empty={i18n.t.analytics.dashboard.empty}>
          {#snippet row(item, { cellClass })}
            <Table.Cell class={cellClass("path")}>{item.path}</Table.Cell>
            <Table.Cell class={cellClass("title")}>{item.title || "—"}</Table.Cell>
            <Table.Cell>{number.format(item.views)}</Table.Cell>
            <Table.Cell>{number.format(item.activeUsers)}</Table.Cell>
          {/snippet}
        </DataTable>
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        <h2 class="text-lg font-semibold">{i18n.t.analytics.dashboard.channels}</h2>
        <DataTable columns={channelColumns} rows={report.channels} getKey={(row) => row.channel} empty={i18n.t.analytics.dashboard.empty}>
          {#snippet row(item)}
            <Table.Cell>{item.channel}</Table.Cell>
            <Table.Cell>{number.format(item.sessions)}</Table.Cell>
            <Table.Cell>{number.format(item.activeUsers)}</Table.Cell>
            <Table.Cell>{number.format(item.keyEvents)}</Table.Cell>
          {/snippet}
        </DataTable>
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        <h2 class="text-lg font-semibold">{i18n.t.analytics.dashboard.devices}</h2>
        <DataTable columns={deviceColumns} rows={report.devices} getKey={(row) => row.device} empty={i18n.t.analytics.dashboard.empty}>
          {#snippet row(item)}
            <Table.Cell>{item.device}</Table.Cell>
            <Table.Cell>{number.format(item.activeUsers)}</Table.Cell>
            <Table.Cell>{number.format(item.sessions)}</Table.Cell>
          {/snippet}
        </DataTable>
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        <h2 class="text-lg font-semibold">{i18n.t.analytics.dashboard.realtimePages}</h2>
        <DataTable
          columns={[
            { key: "path", label: i18n.t.analytics.dashboard.page, sortable: true },
            { key: "activeUsers", label: i18n.t.analytics.dashboard.activeUsers, sortable: true },
          ]}
          rows={realtime?.topPages ?? []}
          getKey={(row) => row.path}
          empty={i18n.t.analytics.dashboard.empty}
        >
          {#snippet row(item)}
            <Table.Cell>{item.path}</Table.Cell>
            <Table.Cell>{number.format(item.activeUsers)}</Table.Cell>
          {/snippet}
        </DataTable>
      </div>
    </section>
  {/if}
</div>
