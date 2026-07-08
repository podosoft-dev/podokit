<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Card from "$lib/components/ui/card";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import type { Capabilities } from "@podosoft/podokit-api-client";

  let { data }: { data: { capabilities: Capabilities } } = $props();
  const i18n = getI18n();
  const caps = $derived(data.capabilities);

  // twoFactor and magicLink are admin-editable (stored in the DB, applied live).
  // The rest are server-enforced and configured via environment (read-only here).
  type EditableFlag = "twoFactor" | "magicLink" | "emailOtp" | "username";
  type Feature = { name: string; desc: string; enabled: boolean; flag?: EditableFlag; env?: string; detail?: string; manageHref?: string };
  const features = $derived<Feature[]>([
    { name: i18n.t.settings.emailPassword, desc: i18n.t.settings.emailPasswordDesc, enabled: true },
    { name: i18n.t.settings.magicLink, desc: i18n.t.settings.magicLinkDesc, enabled: caps.magicLink, flag: "magicLink" },
    { name: i18n.t.settings.emailOtp, desc: i18n.t.settings.emailOtpDesc, enabled: caps.emailOtp, flag: "emailOtp" },
    { name: i18n.t.settings.username, desc: i18n.t.settings.usernameDesc, enabled: caps.username, flag: "username" },
    { name: i18n.t.settings.twoFactor, desc: i18n.t.settings.twoFactorDesc, enabled: caps.twoFactor, flag: "twoFactor", manageHref: "/admin/account" },
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
    <Card.Content class="divide-y p-0">
      {#each features as f (f.name)}
        <div class="flex items-start justify-between gap-4 p-4">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{f.name}</span>
              <Badge variant={f.enabled ? "default" : "secondary"}>
                {f.enabled ? i18n.t.settings.enabled : i18n.t.settings.disabled}
              </Badge>
            </div>
            <p class="text-muted-foreground text-sm">{f.desc}</p>
            {#if f.enabled && f.detail}<p class="text-muted-foreground text-xs">{f.detail}</p>{/if}
            {#if f.env}<p class="text-muted-foreground text-xs">{fmt(i18n.t.settings.configuredVia, { env: f.env })}</p>{/if}
          </div>
          <div class="flex shrink-0 items-center gap-3">
            {#if f.manageHref && f.enabled}
              <Button variant="outline" size="sm" onclick={() => goto(f.manageHref!)}>{i18n.t.settings.manage}</Button>
            {/if}
            {#if f.flag}
              <Checkbox
                aria-label={f.name}
                checked={f.enabled}
                disabled={saving}
                onCheckedChange={(v) => toggle(f.flag!, v === true)}
              />
            {/if}
          </div>
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
</div>
