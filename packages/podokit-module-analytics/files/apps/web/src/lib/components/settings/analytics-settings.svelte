<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { Switch } from "#lib/components/ui/switch/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";
  import {
    deleteAnalyticsCredentials,
    loadAnalyticsConfig,
    testAnalyticsConnection,
    updateAnalyticsConfig,
  } from "#lib/analytics/client.js";
  import type { AnalyticsAdminConfig } from "#lib/analytics/types.js";
  import { formatDateTime, getI18n } from "#lib/i18n/index.js";
  import { toast } from "svelte-sonner";

  const i18n = getI18n();
  let config = $state<AnalyticsAdminConfig | null>(null);
  let measurementId = $state("");
  let propertyId = $state("");
  let serviceAccountJson = $state("");
  let busy = $state(false);
  let credentialGuideOpen = $state(false);
  let credentialGuideContent = $state<HTMLElement | null>(null);

  function focusCredentialGuideStart(event: Event): void {
    event.preventDefault();
    credentialGuideContent?.focus({ preventScroll: true });
    credentialGuideContent?.scrollTo({ top: 0 });
  }

  async function refresh(): Promise<void> {
    try {
      const loaded = await loadAnalyticsConfig();
      config = loaded;
      measurementId = loaded.measurementId;
      propertyId = loaded.propertyId;
    } catch {
      toast.error(i18n.t.analytics.settings.loadFailed);
    }
  }

  async function save(enabled = config?.enabled ?? false): Promise<void> {
    busy = true;
    try {
      config = await updateAnalyticsConfig({
        enabled,
        provider: "ga4",
        measurementId: measurementId.trim(),
        propertyId: propertyId.trim(),
        ...(serviceAccountJson.trim()
          ? { serviceAccountJson: serviceAccountJson.trim() }
          : {}),
      });
      serviceAccountJson = "";
      toast.success(i18n.t.analytics.settings.saved);
    } catch {
      toast.error(i18n.t.analytics.settings.saveFailed);
    } finally {
      busy = false;
    }
  }

  async function verify(): Promise<void> {
    busy = true;
    try {
      config = await testAnalyticsConnection();
      toast.success(i18n.t.analytics.settings.connectionOk);
    } catch {
      toast.error(i18n.t.analytics.settings.connectionFailed);
    } finally {
      busy = false;
    }
  }

  async function removeCredentials(): Promise<void> {
    busy = true;
    try {
      config = await deleteAnalyticsCredentials();
      serviceAccountJson = "";
      toast.success(i18n.t.analytics.settings.credentialsRemoved);
    } catch {
      toast.error(i18n.t.analytics.settings.saveFailed);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void refresh();
  });
</script>

<div class="flex flex-col gap-4">
  <div>
    <h2 class="text-lg font-semibold">{i18n.t.analytics.settings.title}</h2>
    <p class="text-muted-foreground text-sm">
      {i18n.t.analytics.settings.description}
    </p>
  </div>

  <Card.Root>
    <Card.Header>
      <div class="flex items-start justify-between gap-4">
        <div>
          <Card.Title>{i18n.t.analytics.settings.ga4Title}</Card.Title>
          <Card.Description>
            {i18n.t.analytics.settings.ga4Description}
          </Card.Description>
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="mt-3"
            onclick={() => (credentialGuideOpen = true)}
          >
            {i18n.t.analytics.settings.credentialGuide.trigger}
          </Button>
        </div>
        <Switch
          aria-label={i18n.t.analytics.settings.enabled}
          checked={config?.enabled ?? false}
          disabled={busy || !config}
          onCheckedChange={(value) => save(value === true)}
        />
      </div>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <Label for="analytics-measurement-id">
            {i18n.t.analytics.settings.measurementId}
          </Label>
          <Input
            id="analytics-measurement-id"
            placeholder="G-XXXXXXXXXX"
            autocomplete="off"
            bind:value={measurementId}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="analytics-property-id">
            {i18n.t.analytics.settings.propertyId}
          </Label>
          <Input
            id="analytics-property-id"
            inputmode="numeric"
            autocomplete="off"
            bind:value={propertyId}
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="analytics-service-account">
          {i18n.t.analytics.settings.serviceAccount}
        </Label>
        <Textarea
          id="analytics-service-account"
          class="min-h-36 font-mono text-xs"
          autocomplete="off"
          placeholder={config?.hasCredentials
            ? i18n.t.analytics.settings.credentialsSet
            : i18n.t.analytics.settings.serviceAccountPlaceholder}
          bind:value={serviceAccountJson}
        />
        <p class="text-muted-foreground text-xs">
          {i18n.t.analytics.settings.secretHelp}
        </p>
      </div>

      <div class="rounded-md border p-3 text-sm">
        <div class="font-medium">
          {config?.hasCredentials
            ? i18n.t.analytics.settings.credentialsSet
            : i18n.t.analytics.settings.credentialsMissing}
        </div>
        <div class="text-muted-foreground mt-1">
          {config?.lastVerifiedAt
            ? `${i18n.t.analytics.settings.lastVerified}: ${formatDateTime(config.lastVerifiedAt)}`
            : i18n.t.analytics.settings.notVerified}
        </div>
      </div>

      <p class="text-muted-foreground text-sm">
        {i18n.t.analytics.settings.productionOnly}
      </p>
    </Card.Content>
    <Card.Footer class="flex flex-wrap justify-end gap-2">
      {#if config?.hasCredentials}
        <Button
          variant="ghost"
          disabled={busy}
          onclick={removeCredentials}
        >
          {i18n.t.analytics.settings.removeCredentials}
        </Button>
      {/if}
      <Button
        variant="outline"
        disabled={busy || !config?.hasCredentials || !propertyId}
        onclick={verify}
      >
        {i18n.t.analytics.settings.testConnection}
      </Button>
      <Button disabled={busy || !config} onclick={() => save()}>
        {i18n.t.analytics.settings.save}
      </Button>
    </Card.Footer>
  </Card.Root>
</div>

<Dialog.Root bind:open={credentialGuideOpen}>
  <Dialog.Content
    bind:ref={credentialGuideContent}
    class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
    onOpenAutoFocus={focusCredentialGuideStart}
  >
    <Dialog.Header>
      <Dialog.Title>
        {i18n.t.analytics.settings.credentialGuide.title}
      </Dialog.Title>
      <Dialog.Description>
        {i18n.t.analytics.settings.credentialGuide.description}
      </Dialog.Description>
    </Dialog.Header>

    <ol class="ml-5 list-decimal space-y-4 text-sm">
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.propertyTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.propertyDescription}
        </p>
      </li>
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.apiTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.apiDescription}
        </p>
      </li>
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.accountTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.accountDescription}
        </p>
      </li>
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.accessTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.accessDescription}
        </p>
      </li>
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.keyTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.keyDescription}
        </p>
      </li>
      <li>
        <p class="font-medium">
          {i18n.t.analytics.settings.credentialGuide.connectTitle}
        </p>
        <p class="text-muted-foreground mt-1">
          {i18n.t.analytics.settings.credentialGuide.connectDescription}
        </p>
      </li>
    </ol>

    <div class="bg-muted rounded-md border p-3 text-sm">
      <p class="font-medium">
        {i18n.t.analytics.settings.credentialGuide.securityTitle}
      </p>
      <p class="text-muted-foreground mt-1">
        {i18n.t.analytics.settings.credentialGuide.securityDescription}
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        href="https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart"
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        variant="outline"
      >
        {i18n.t.analytics.settings.credentialGuide.dataApiLink}
      </Button>
      <Button
        href="https://cloud.google.com/iam/docs/keys-create-delete"
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        variant="outline"
      >
        {i18n.t.analytics.settings.credentialGuide.serviceAccountLink}
      </Button>
      <Button
        href="https://support.google.com/analytics/answer/9305587"
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        variant="outline"
      >
        {i18n.t.analytics.settings.credentialGuide.accessLink}
      </Button>
    </div>

    <Dialog.Footer>
      <Button
        type="button"
        onclick={() => (credentialGuideOpen = false)}
      >
        {i18n.t.analytics.settings.credentialGuide.close}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
