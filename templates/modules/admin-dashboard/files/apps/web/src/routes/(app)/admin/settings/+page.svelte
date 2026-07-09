<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import * as Card from "$lib/components/ui/card";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import type { Capabilities } from "@podosoft/podokit-api-client";

  let { data }: { data: { capabilities: Capabilities } } = $props();
  const i18n = getI18n();
  const caps = $derived(data.capabilities);

  type EditableFlag = "twoFactor" | "magicLink" | "emailOtp" | "username" | "multiSession" | "phoneNumber" | "apiKey";
  type Feature = { name: string; desc: string; enabled: boolean; flag?: EditableFlag; env?: string; detail?: string; manageHref?: string };

  // Admin-editable, stored in the DB, applied live (a disabled feature's
  // endpoints are also blocked server-side by the auth feature gate).
  const authFeatures = $derived<Feature[]>([
    { name: i18n.t.settings.magicLink, desc: i18n.t.settings.magicLinkDesc, enabled: caps.magicLink, flag: "magicLink" },
    { name: i18n.t.settings.emailOtp, desc: i18n.t.settings.emailOtpDesc, enabled: caps.emailOtp, flag: "emailOtp" },
    { name: i18n.t.settings.username, desc: i18n.t.settings.usernameDesc, enabled: caps.username, flag: "username" },
    { name: i18n.t.settings.multiSession, desc: i18n.t.settings.multiSessionDesc, enabled: caps.multiSession, flag: "multiSession" },
    { name: i18n.t.settings.phoneNumber, desc: i18n.t.settings.phoneNumberDesc, enabled: caps.phoneNumber, flag: "phoneNumber" },
    { name: i18n.t.settings.twoFactor, desc: i18n.t.settings.twoFactorDesc, enabled: caps.twoFactor, flag: "twoFactor", manageHref: "/admin/account" },
    { name: i18n.t.settings.apiKey, desc: i18n.t.settings.apiKeyDesc, enabled: caps.apiKey, flag: "apiKey", manageHref: "/admin/account" },
  ]);

  // Server-enforced, configured via environment (read-only here). emailPassword
  // is the always-on baseline sign-in method.
  const serverConfig = $derived<Feature[]>([
    { name: i18n.t.settings.emailPassword, desc: i18n.t.settings.emailPasswordDesc, enabled: true },
    { name: i18n.t.settings.emailVerification, desc: i18n.t.settings.emailVerificationDesc, enabled: caps.emailVerification, env: "AUTH_EMAIL_VERIFICATION" },
    { name: i18n.t.settings.socialProviders, desc: i18n.t.settings.socialProvidersDesc, enabled: caps.providers.length > 0, env: "GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID", detail: caps.providers.join(", ") },
    { name: i18n.t.settings.breachCheck, desc: i18n.t.settings.breachCheckDesc, enabled: caps.passwordBreachCheck, env: "AUTH_HIBP" },
    { name: i18n.t.settings.accountDeletion, desc: i18n.t.settings.accountDeletionDesc, enabled: caps.deleteAccount, env: "AUTH_ALLOW_DELETE" },
    { name: i18n.t.settings.auditLog, desc: i18n.t.settings.auditLogDesc, enabled: caps.auditLog, env: "AUDIT_LOG_ENABLED" },
  ]);

  let saving = $state(false);
  async function toggle(flag: EditableFlag, next: boolean): Promise<void> {
    saving = true;
    try {
      await api.put("/account/settings", { [flag]: next });
      await invalidateAll(); // re-fetch capabilities so the whole app reflects it live
      toast.success(i18n.t.settings.saved);
    } catch {
      toast.error(i18n.t.settings.saveFailed);
    }
    saving = false;
  }
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="text-2xl font-semibold">{i18n.t.settings.title}</h1>
    <p class="text-muted-foreground text-sm">{i18n.t.settings.subtitle}</p>
  </div>
  <Card.Root>
    <Card.Header>
      <Card.Title>{i18n.t.settings.authFeaturesTitle}</Card.Title>
      <Card.Description>{i18n.t.settings.authFeaturesSubtitle}</Card.Description>
    </Card.Header>
    <Card.Content class="divide-y p-0">
      {#each authFeatures as f (f.name)}
        <div class="flex items-center justify-between gap-4 p-4">
          <div class="flex flex-col gap-0.5">
            <label for={`flag-${f.flag}`} class="font-medium">{f.name}</label>
            <p class="text-muted-foreground text-sm">{f.desc}</p>
            {#if f.manageHref}
              <a href={f.manageHref} class="text-primary mt-1 text-sm font-medium hover:underline">{i18n.t.settings.manage}</a>
            {/if}
          </div>
          <Switch
            id={`flag-${f.flag}`}
            aria-label={f.name}
            checked={f.enabled}
            disabled={saving}
            onCheckedChange={(v) => toggle(f.flag!, v === true)}
          />
        </div>
      {/each}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{i18n.t.settings.serverConfigTitle}</Card.Title>
      <Card.Description>{i18n.t.settings.serverConfigSubtitle}</Card.Description>
    </Card.Header>
    <Card.Content class="divide-y p-0">
      {#each serverConfig as f (f.name)}
        <div class="flex items-center justify-between gap-4 p-4">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium">{f.name}</span>
            <p class="text-muted-foreground text-sm">{f.desc}</p>
            {#if f.enabled && f.detail}<p class="text-muted-foreground text-xs">{f.detail}</p>{/if}
            {#if f.env}<p class="text-muted-foreground text-xs">{fmt(i18n.t.settings.configuredVia, { env: f.env })}</p>{/if}
          </div>
          <Badge variant={f.enabled ? "secondary" : "outline"} class="shrink-0 gap-1.5">
            <span class={`size-1.5 rounded-full ${f.enabled ? "bg-green-500" : "bg-muted-foreground/40"}`}></span>
            {f.enabled ? i18n.t.settings.enabled : i18n.t.settings.disabled}
          </Badge>
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
</div>
