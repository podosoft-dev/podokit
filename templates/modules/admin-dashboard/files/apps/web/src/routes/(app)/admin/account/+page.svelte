<script lang="ts">
  import { goto } from "$app/navigation";
  import QRCode from "qrcode";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt, formatDateTime } from "$lib/i18n";
  import { untrack } from "svelte";
  import type { SessionUser } from "../../../../app.d.ts";
  import type { Capabilities } from "@podosoft/podokit-api-client";

  let { data }: { data: { user: SessionUser; currentSessionId: string | null; capabilities: Capabilities } } = $props();
  const i18n = getI18n();

  // Optional features (resolved by the layout) so we only show enabled sections.
  const caps = $derived(data.capabilities);

  type SectionKey = "profile" | "security" | "connected" | "sessions" | "apiKeys" | "danger";
  let section = $state<SectionKey>("profile");
  const navItems = $derived<SectionKey[]>([
    "profile",
    "security",
    ...(caps.providers.length ? (["connected"] as const) : []),
    "sessions",
    ...(caps.apiKey ? (["apiKeys"] as const) : []),
    ...(caps.deleteAccount ? (["danger"] as const) : []),
  ]);

  // Profile — seed the editable fields from the initial user value.
  let name = $state(untrack(() => data.user.name));
  let username = $state(untrack(() => data.user.username ?? ""));
  let savingProfile = $state(false);
  const nameChanged = $derived(
    (name.trim() !== "" && name !== data.user.name) || (caps.username && username !== (data.user.username ?? "")),
  );
  async function saveProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    savingProfile = true;
    // Only send username when it's set and actually changed — updateUser rejects
    // an empty username, which would block name-only edits for users without one.
    const usernameChanged = caps.username && username.trim() !== "" && username !== (data.user.username ?? "");
    const { error } = await api.auth.updateUser({ name, ...(usernameChanged ? { username: username.trim() } : {}) });
    savingProfile = false;
    if (error) toast.error(error.message ?? i18n.t.account.saveFailed);
    else toast.success(i18n.t.account.saved);
  }

  // Phone number — register + verify with an SMS code (dev delivery is a stub).
  let phone = $state(untrack(() => data.user.phoneNumber ?? ""));
  let phoneCode = $state("");
  let phoneOtpSent = $state(false);
  let phoneBusy = $state(false);
  async function sendPhoneOtp(): Promise<void> {
    phoneBusy = true;
    const { error } = await api.auth.phoneNumber.sendOtp({ phoneNumber: phone });
    phoneBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    phoneOtpSent = true;
    toast.success(i18n.t.account.phoneCodeSent);
  }
  async function verifyPhone(): Promise<void> {
    phoneBusy = true;
    const { error } = await api.auth.phoneNumber.verify({ phoneNumber: phone, code: phoneCode });
    phoneBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    phoneOtpSent = false;
    phoneCode = "";
    toast.success(i18n.t.account.phoneVerified);
    await goto("/admin/account", { invalidateAll: true });
  }

  // Email change — when verification is on, better-auth emails an approval link
  // to the current address; otherwise the address switches immediately.
  let newEmail = $state(untrack(() => data.user.email));
  let changingEmail = $state(false);
  const emailChanged = $derived(newEmail.trim() !== "" && newEmail !== data.user.email);
  async function changeEmail(): Promise<void> {
    changingEmail = true;
    const { error } = await api.auth.changeEmail({ newEmail, callbackURL: `${location.origin}/admin` });
    changingEmail = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    toast.success(caps.emailVerification ? i18n.t.account.emailChangePending : i18n.t.account.emailChanged);
  }

  // Email verification — resend the confirmation link to the current address.
  let verifying = $state(false);
  async function resendVerification(): Promise<void> {
    verifying = true;
    const { error } = await api.auth.sendVerificationEmail({ email: data.user.email, callbackURL: `${location.origin}/admin` });
    verifying = false;
    if (error) toast.error(error.message ?? i18n.t.auth.requestFailed);
    else toast.success(i18n.t.auth.verifySent);
  }

  // Security — change password
  let currentPassword = $state("");
  let newPassword = $state("");
  let changing = $state(false);
  async function changePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    changing = true;
    const { error } = await api.auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    changing = false;
    if (error) toast.error(error.message ?? i18n.t.account.changeFailed);
    else {
      toast.success(i18n.t.account.changed);
      currentPassword = "";
      newPassword = "";
      await loadSessions();
    }
  }

  // Security — two-factor
  let twoFaOn = $state<boolean>(untrack(() => data.user.twoFactorEnabled ?? false));
  let twoFaPassword = $state("");
  let twoFaCode = $state("");
  let twoFaBusy = $state(false);
  let setup = $state<{ totpURI: string; backupCodes: string[] } | null>(null);
  // Render the otpauth URI as a scannable QR image (data URL) during setup.
  let qrDataUrl = $state("");
  $effect(() => {
    const uri = setup?.totpURI;
    if (!uri) {
      qrDataUrl = "";
      return;
    }
    QRCode.toDataURL(uri, { margin: 1, width: 176 })
      .then((url) => (qrDataUrl = url))
      .catch(() => (qrDataUrl = ""));
  });
  async function enable2fa(): Promise<void> {
    twoFaBusy = true;
    const { data: res, error } = await api.auth.twoFactor.enable({ password: twoFaPassword });
    twoFaBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.changeFailed);
    setup = { totpURI: res?.totpURI ?? "", backupCodes: (res?.backupCodes ?? []) as string[] };
  }
  async function verify2fa(): Promise<void> {
    twoFaBusy = true;
    const { error } = await api.auth.twoFactor.verifyTotp({ code: twoFaCode });
    twoFaBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.changeFailed);
    twoFaOn = true;
    setup = null;
    twoFaPassword = "";
    twoFaCode = "";
    toast.success(i18n.t.account.twoFactorEnabled);
  }
  async function disable2fa(): Promise<void> {
    twoFaBusy = true;
    const { error } = await api.auth.twoFactor.disable({ password: twoFaPassword });
    twoFaBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.changeFailed);
    twoFaOn = false;
    twoFaPassword = "";
    toast.success(i18n.t.account.twoFactorDisabled);
  }

  // Passkeys (WebAuthn) — passwordless credentials bound to this device/browser.
  type Passkey = { id: string; name: string | null; createdAt: string | Date };
  let passkeys = $state<Passkey[]>([]);
  let newPasskeyName = $state("");
  let passkeyBusy = $state(false);
  async function loadPasskeys(): Promise<void> {
    if (!caps.passkey) return;
    const { data: res } = await api.auth.passkey.listUserPasskeys();
    passkeys = (res ?? []) as Passkey[];
  }
  async function registerPasskey(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    passkeyBusy = true;
    // Triggers the browser WebAuthn ceremony (navigator.credentials.create).
    const { error } = await api.auth.passkey.addPasskey({ name: newPasskeyName.trim() || undefined });
    passkeyBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.passkeys.addFailed);
    newPasskeyName = "";
    toast.success(i18n.t.passkeys.added);
    await loadPasskeys();
  }
  async function deletePasskey(id: string): Promise<void> {
    passkeyBusy = true;
    const { error } = await api.auth.passkey.deletePasskey({ id });
    passkeyBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.passkeys.removeFailed);
    toast.success(i18n.t.passkeys.removed);
    await loadPasskeys();
  }

  // Connected accounts
  type Account = { id: string; providerId: string; accountId: string };
  let accounts = $state<Account[]>([]);
  async function loadAccounts(): Promise<void> {
    const { data: res } = await api.auth.listAccounts();
    accounts = (res ?? []) as Account[];
  }
  const linkedProviders = $derived(new Set(accounts.map((a) => a.providerId)));
  async function connect(provider: string): Promise<void> {
    const { data: res, error } = await api.auth.linkSocial({ provider, callbackURL: "/admin/account" });
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    if (res?.url) window.location.href = res.url;
  }
  async function disconnect(provider: string): Promise<void> {
    const account = accounts.find((a) => a.providerId === provider);
    if (!account) return;
    const { error } = await api.auth.unlinkAccount({ providerId: provider, accountId: account.accountId });
    if (error) toast.error(error.message ?? i18n.t.account.saveFailed);
    else {
      toast.success(i18n.t.account.disconnected);
      await loadAccounts();
    }
  }

  // Danger — delete account
  let deleteOpen = $state(false);
  let deletePassword = $state("");
  let deleteBusy = $state(false);
  async function deleteAccount(): Promise<void> {
    deleteBusy = true;
    const { error } = await api.auth.deleteUser({ password: deletePassword });
    deleteBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    toast.success(i18n.t.account.accountDeleted);
    await goto("/login", { invalidateAll: true });
  }

  // Sessions — this user's own devices
  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  const PAGE_SIZE = 5;
  let sessions = $state<Session[]>([]);
  let sessionsPage = $state(1);
  let busy = $state(false);
  const pagedSessions = $derived(sessions.slice((sessionsPage - 1) * PAGE_SIZE, sessionsPage * PAGE_SIZE));
  async function loadSessions(): Promise<void> {
    const { data: res, error } = await api.auth.listSessions();
    if (error) return void toast.error(error.message ?? i18n.t.sessions.loadFailed);
    // Current session first (users expect it on top; also keeps it on page 1),
    // then newest to oldest.
    sessions = ((res ?? []) as Session[]).sort((a, b) => {
      if (a.id === data.currentSessionId) return -1;
      if (b.id === data.currentSessionId) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
  async function revoke(token: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.revokeSession({ token });
    busy = false;
    if (error) toast.error(error.message ?? i18n.t.sessions.revokeFailed);
    else {
      toast.success(i18n.t.sessions.revoked);
      await loadSessions();
    }
  }
  async function signOutOthers(): Promise<void> {
    busy = true;
    const { error } = await api.auth.revokeOtherSessions();
    busy = false;
    if (error) toast.error(error.message ?? i18n.t.sessions.revokeFailed);
    else {
      toast.success(i18n.t.sessions.othersRevoked);
      await loadSessions();
    }
  }

  // Multi-account: other accounts signed in on this browser (multiSession plugin).
  type DeviceSession = { session: { token: string }; user: { id: string; email: string; name: string } };
  let deviceSessions = $state<DeviceSession[]>([]);
  async function loadDeviceSessions(): Promise<void> {
    if (!caps.multiSession) return;
    const { data: res } = await api.auth.multiSession.listDeviceSessions();
    deviceSessions = (res ?? []) as DeviceSession[];
  }
  async function switchAccount(token: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.multiSession.setActive({ sessionToken: token });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.sessions.switchFailed);
    await goto("/admin", { invalidateAll: true });
  }

  // Personal API keys (apiKey plugin). The full key is shown once on creation.
  type ApiKey = { id: string; name: string | null; start: string | null; createdAt: string | Date; expiresAt: string | Date | null };
  let apiKeys = $state<ApiKey[]>([]);
  let newKeyName = $state("");
  let createdKey = $state<string | null>(null);
  let keyBusy = $state(false);
  async function loadApiKeys(): Promise<void> {
    if (!caps.apiKey) return;
    const { data: res } = await api.auth.apiKey.list();
    // the endpoint returns { apiKeys: [...] }; tolerate a bare array too
    apiKeys = (Array.isArray(res) ? res : ((res as { apiKeys?: ApiKey[] } | null)?.apiKeys ?? [])) as ApiKey[];
  }
  async function createApiKey(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    keyBusy = true;
    const { data: res, error } = await api.auth.apiKey.create({ name: newKeyName.trim() || undefined });
    keyBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.account.saveFailed);
    createdKey = res?.key ?? null;
    newKeyName = "";
    await loadApiKeys();
  }
  async function deleteApiKey(keyId: string): Promise<void> {
    keyBusy = true;
    const { error } = await api.auth.apiKey.delete({ keyId });
    keyBusy = false;
    if (error) return void toast.error(error.message ?? i18n.t.apiKeys.revokeFailed);
    toast.success(i18n.t.apiKeys.revoked);
    await loadApiKeys();
  }
  async function copyKey(): Promise<void> {
    if (createdKey) await navigator.clipboard.writeText(createdKey).catch(() => undefined);
    toast.success(i18n.t.apiKeys.copied);
  }

  $effect(() => {
    void loadSessions();
    void loadAccounts();
    void loadDeviceSessions();
    void loadApiKeys();
    void loadPasskeys();
  });
</script>

<div class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">{i18n.t.account.title}</h1>

  <div class="flex flex-col gap-6 lg:flex-row">
    <nav class="flex shrink-0 flex-wrap gap-1 lg:w-48 lg:flex-col">
      {#each navItems as key (key)}
        <Button
          variant="ghost"
          onclick={() => (section = key)}
          aria-current={section === key ? "page" : undefined}
          class="h-auto justify-start px-3 py-2 text-sm font-medium {section === key ? 'bg-muted' : 'text-muted-foreground'}"
        >
          {i18n.t.account.nav[key]}
        </Button>
      {/each}
    </nav>

    <div class="min-w-0 flex-1">
      {#if section === "profile"}
        <Card.Root>
          <Card.Header><Card.Title>{i18n.t.account.profile}</Card.Title></Card.Header>
          <Card.Content>
            <form class="flex max-w-md flex-col gap-4" onsubmit={saveProfile}>
              <div class="flex flex-col gap-2">
                <Label for="name">{i18n.t.account.name}</Label>
                <Input id="name" bind:value={name} required />
              </div>
              {#if caps.username}
                <div class="flex flex-col gap-2">
                  <Label for="username">{i18n.t.account.username}</Label>
                  <Input id="username" bind:value={username} autocomplete="username" />
                </div>
              {/if}
              <div class="flex flex-col gap-2">
                <Label for="email">{i18n.t.account.email}</Label>
                <div class="flex items-center gap-2">
                  <Input id="email" type="email" bind:value={newEmail} required />
                  {#if caps.emailVerification}
                    <Badge variant={data.user.emailVerified ? "outline" : "secondary"} class={data.user.emailVerified ? "text-green-600 dark:text-green-400" : ""}>
                      {data.user.emailVerified ? i18n.t.account.verified : i18n.t.account.unverified}
                    </Badge>
                  {/if}
                </div>
                <div class="flex flex-wrap gap-2">
                  {#if emailChanged}
                    <Button type="button" variant="outline" size="sm" class="w-fit" disabled={changingEmail} onclick={changeEmail}>
                      {changingEmail ? i18n.t.account.saving : i18n.t.account.changeEmail}
                    </Button>
                  {/if}
                  {#if caps.emailVerification && !data.user.emailVerified}
                    <Button type="button" variant="outline" size="sm" class="w-fit" disabled={verifying} onclick={resendVerification}>
                      {verifying ? i18n.t.auth.sending : i18n.t.auth.resendVerification}
                    </Button>
                  {/if}
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Label>{i18n.t.account.role}</Label>
                <div class="text-muted-foreground text-sm capitalize">{data.user.role ?? "user"}</div>
              </div>
              <Button type="submit" class="w-fit" disabled={savingProfile || !nameChanged}>{i18n.t.account.save}</Button>
            </form>
            {#if caps.phoneNumber}
              <div class="mt-6 flex max-w-md flex-col gap-2 border-t pt-6">
                <div class="flex items-center gap-2">
                  <Label for="phone">{i18n.t.account.phone}</Label>
                  {#if data.user.phoneNumberVerified}
                    <Badge variant="outline" class="text-green-600 dark:text-green-400">{i18n.t.account.verified}</Badge>
                  {/if}
                </div>
                <Input id="phone" type="tel" bind:value={phone} autocomplete="tel" />
                {#if phoneOtpSent}
                  <Input placeholder={i18n.t.account.phoneCode} bind:value={phoneCode} inputmode="numeric" autocomplete="one-time-code" />
                  <Button type="button" size="sm" class="w-fit" disabled={phoneBusy || !phoneCode} onclick={verifyPhone}>{i18n.t.account.phoneVerify}</Button>
                {:else}
                  <Button type="button" variant="outline" size="sm" class="w-fit" disabled={phoneBusy || !phone} onclick={sendPhoneOtp}>
                    {phoneBusy ? i18n.t.auth.sending : i18n.t.account.phoneSendCode}
                  </Button>
                {/if}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      {:else if section === "security"}
        <div class="flex flex-col gap-6">
          <Card.Root>
            <Card.Header><Card.Title>{i18n.t.account.changePassword}</Card.Title></Card.Header>
            <Card.Content>
              <form class="flex max-w-md flex-col gap-4" onsubmit={changePassword}>
                <div class="flex flex-col gap-2">
                  <Label for="current">{i18n.t.account.currentPassword}</Label>
                  <Input id="current" type="password" bind:value={currentPassword} required autocomplete="current-password" />
                </div>
                <div class="flex flex-col gap-2">
                  <Label for="new">{i18n.t.account.newPassword}</Label>
                  <Input id="new" type="password" bind:value={newPassword} required autocomplete="new-password" />
                </div>
                <Button type="submit" class="w-fit" disabled={changing}>{changing ? i18n.t.account.updating : i18n.t.account.update}</Button>
              </form>
            </Card.Content>
          </Card.Root>

          {#if caps.twoFactor}
            <Card.Root>
              <Card.Header class="flex flex-row items-center justify-between gap-2">
                <div>
                  <Card.Title>{i18n.t.account.twoFactorTitle}</Card.Title>
                  <p class="text-muted-foreground mt-1 text-sm">{i18n.t.account.twoFactorDesc}</p>
                </div>
                <Badge variant={twoFaOn ? "default" : "secondary"}>{twoFaOn ? i18n.t.account.twoFactorOn : i18n.t.account.twoFactorOff}</Badge>
              </Card.Header>
              <Card.Content class="flex max-w-md flex-col gap-4">
                {#if twoFaOn}
                  <div class="flex flex-col gap-2">
                    <Label for="tf-off-pw">{i18n.t.account.password}</Label>
                    <Input id="tf-off-pw" type="password" bind:value={twoFaPassword} autocomplete="current-password" />
                  </div>
                  <Button variant="destructive" class="w-fit" disabled={twoFaBusy || !twoFaPassword} onclick={disable2fa}>{i18n.t.account.disable}</Button>
                {:else if setup}
                  <p class="text-muted-foreground text-sm">{i18n.t.account.scanHint}</p>
                  {#if qrDataUrl}
                    <img src={qrDataUrl} alt="TOTP QR code" width="176" height="176" class="rounded border bg-white p-2" />
                  {/if}
                  <div class="flex flex-col gap-1">
                    <Label>{i18n.t.account.setupKey}</Label>
                    <code class="bg-muted overflow-x-auto rounded px-2 py-1 text-xs">{setup.totpURI}</code>
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>{i18n.t.account.backupCodes}</Label>
                    <div class="bg-muted grid grid-cols-2 gap-1 rounded p-2 font-mono text-xs">
                      {#each setup.backupCodes as c (c)}<span>{c}</span>{/each}
                    </div>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="tf-code">{i18n.t.account.code}</Label>
                    <Input id="tf-code" bind:value={twoFaCode} inputmode="numeric" autocomplete="one-time-code" />
                  </div>
                  <Button class="w-fit" disabled={twoFaBusy || !twoFaCode} onclick={verify2fa}>{i18n.t.account.verify}</Button>
                {:else}
                  <div class="flex flex-col gap-2">
                    <Label for="tf-on-pw">{i18n.t.account.password}</Label>
                    <Input id="tf-on-pw" type="password" bind:value={twoFaPassword} autocomplete="current-password" />
                  </div>
                  <Button class="w-fit" disabled={twoFaBusy || !twoFaPassword} onclick={enable2fa}>{i18n.t.account.enable}</Button>
                {/if}
              </Card.Content>
            </Card.Root>
          {/if}
          {#if caps.passkey}
            <Card.Root>
              <Card.Header>
                <Card.Title>{i18n.t.passkeys.title}</Card.Title>
                <Card.Description>{i18n.t.passkeys.subtitle}</Card.Description>
              </Card.Header>
              <Card.Content class="flex flex-col gap-4">
                <form class="flex items-end gap-2" onsubmit={registerPasskey}>
                  <div class="flex flex-1 flex-col gap-2">
                    <Label for="passkey-name">{i18n.t.passkeys.name}</Label>
                    <Input id="passkey-name" bind:value={newPasskeyName} placeholder={i18n.t.passkeys.namePlaceholder} />
                  </div>
                  <Button type="submit" disabled={passkeyBusy}>{i18n.t.passkeys.add}</Button>
                </form>
                {#if passkeys.length}
                  <div class="rounded-md border">
                    <Table.Root>
                      <Table.Body>
                        {#each passkeys as pk (pk.id)}
                          <Table.Row>
                            <Table.Cell class="font-medium">{pk.name || i18n.t.passkeys.untitled}</Table.Cell>
                            <Table.Cell class="text-muted-foreground">{formatDateTime(pk.createdAt)}</Table.Cell>
                            <Table.Cell class="w-10">
                              <Button variant="ghost" size="sm" disabled={passkeyBusy} onclick={() => deletePasskey(pk.id)}>{i18n.t.passkeys.remove}</Button>
                            </Table.Cell>
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  </div>
                {:else}
                  <p class="text-muted-foreground text-sm">{i18n.t.passkeys.empty}</p>
                {/if}
              </Card.Content>
            </Card.Root>
          {/if}
        </div>
      {:else if section === "connected"}
        <Card.Root>
          <Card.Header>
            <Card.Title>{i18n.t.account.connectedTitle}</Card.Title>
            <p class="text-muted-foreground mt-1 text-sm">{i18n.t.account.connectedDesc}</p>
          </Card.Header>
          <Card.Content class="flex flex-col gap-3">
            {#each caps.providers as provider (provider)}
              {@const isLinked = linkedProviders.has(provider)}
              <div class="flex items-center justify-between gap-4 rounded-md border p-3">
                <div class="flex items-center gap-2">
                  <span class="font-medium capitalize">{provider}</span>
                  <Badge variant={isLinked ? "outline" : "secondary"}>{isLinked ? i18n.t.account.connected : i18n.t.account.notConnected}</Badge>
                </div>
                {#if isLinked}
                  <Button variant="outline" size="sm" onclick={() => disconnect(provider)}>{i18n.t.account.disconnect}</Button>
                {:else}
                  <Button size="sm" onclick={() => connect(provider)}>{i18n.t.account.connect}</Button>
                {/if}
              </div>
            {/each}
          </Card.Content>
        </Card.Root>
      {:else if section === "sessions"}
        {#if caps.multiSession && deviceSessions.filter((d) => d.user.id !== data.user.id).length}
          <Card.Root>
            <Card.Header><Card.Title>{i18n.t.sessions.accountsTitle}</Card.Title></Card.Header>
            <Card.Content class="flex flex-col gap-2">
              {#each deviceSessions.filter((d) => d.user.id !== data.user.id) as d (d.session.token)}
                <div class="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <div class="font-medium">{d.user.name}</div>
                    <div class="text-muted-foreground text-xs">{d.user.email}</div>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} onclick={() => switchAccount(d.session.token)}>{i18n.t.sessions.switchAccount}</Button>
                </div>
              {/each}
            </Card.Content>
          </Card.Root>
        {/if}
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between gap-2">
            <Card.Title>{i18n.t.sessions.title}</Card.Title>
            <Button variant="outline" size="sm" disabled={busy || sessions.length <= 1} onclick={signOutOthers}>{i18n.t.sessions.signOutOthers}</Button>
          </Card.Header>
          <Card.Content>
            <div class="rounded-md border">
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>{i18n.t.sessions.device}</Table.Head>
                    <Table.Head>{i18n.t.sessions.ip}</Table.Head>
                    <Table.Head>{i18n.t.sessions.since}</Table.Head>
                    <Table.Head>{i18n.t.sessions.status}</Table.Head>
                    <Table.Head class="w-10"></Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each pagedSessions as s (s.id)}
                    {@const isCurrent = s.id === data.currentSessionId}
                    <Table.Row>
                      <Table.Cell class="max-w-xs truncate">{s.userAgent ?? i18n.t.sessions.unknown}</Table.Cell>
                      <Table.Cell class="text-muted-foreground">{s.ipAddress ?? "—"}</Table.Cell>
                      <Table.Cell class="text-muted-foreground">{formatDateTime(s.createdAt)}</Table.Cell>
                      <Table.Cell>{#if isCurrent}<Badge>{i18n.t.sessions.current}</Badge>{/if}</Table.Cell>
                      <Table.Cell>
                        <Button variant="ghost" size="sm" disabled={busy || isCurrent} onclick={() => revoke(s.token)}>{i18n.t.sessions.revoke}</Button>
                      </Table.Cell>
                    </Table.Row>
                  {:else}
                    <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{i18n.t.sessions.empty}</Table.Cell></Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
            <div class="mt-4">
              <TablePagination count={sessions.length} perPage={PAGE_SIZE} bind:page={sessionsPage} label={fmt(i18n.t.sessions.total, { count: sessions.length })} />
            </div>
          </Card.Content>
        </Card.Root>
      {:else if section === "apiKeys"}
        <Card.Root>
          <Card.Header>
            <Card.Title>{i18n.t.apiKeys.title}</Card.Title>
            <Card.Description>{i18n.t.apiKeys.subtitle}</Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <form class="flex items-end gap-2" onsubmit={createApiKey}>
              <div class="flex flex-1 flex-col gap-2">
                <Label for="key-name">{i18n.t.apiKeys.name}</Label>
                <Input id="key-name" bind:value={newKeyName} placeholder={i18n.t.apiKeys.namePlaceholder} />
              </div>
              <Button type="submit" disabled={keyBusy}>{i18n.t.apiKeys.create}</Button>
            </form>
            {#if apiKeys.length}
              <div class="rounded-md border">
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>{i18n.t.apiKeys.name}</Table.Head>
                      <Table.Head>{i18n.t.apiKeys.keyColumn}</Table.Head>
                      <Table.Head>{i18n.t.apiKeys.created}</Table.Head>
                      <Table.Head class="w-10"></Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {#each apiKeys as k (k.id)}
                      <Table.Row>
                        <Table.Cell class="font-medium">{k.name || i18n.t.apiKeys.untitled}</Table.Cell>
                        <Table.Cell class="text-muted-foreground font-mono text-xs">{k.start ? `${k.start}…` : "—"}</Table.Cell>
                        <Table.Cell class="text-muted-foreground">{formatDateTime(k.createdAt)}</Table.Cell>
                        <Table.Cell>
                          <Button variant="ghost" size="sm" disabled={keyBusy} onclick={() => deleteApiKey(k.id)}>{i18n.t.apiKeys.revoke}</Button>
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              </div>
            {:else}
              <p class="text-muted-foreground text-sm">{i18n.t.apiKeys.empty}</p>
            {/if}
          </Card.Content>
        </Card.Root>
        <Dialog.Root open={createdKey !== null} onOpenChange={(v) => { if (!v) createdKey = null; }}>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{i18n.t.apiKeys.createdTitle}</Dialog.Title>
              <Dialog.Description>{i18n.t.apiKeys.createdDesc}</Dialog.Description>
            </Dialog.Header>
            <div class="bg-muted rounded-md p-3 font-mono text-sm break-all">{createdKey}</div>
            <Dialog.Footer>
              <Button variant="outline" onclick={copyKey}>{i18n.t.apiKeys.copy}</Button>
              <Button onclick={() => (createdKey = null)}>{i18n.t.apiKeys.done}</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      {:else if section === "danger"}
        <Card.Root class="border-destructive/50">
          <Card.Header>
            <Card.Title class="text-destructive">{i18n.t.account.dangerTitle}</Card.Title>
            <p class="text-muted-foreground mt-1 text-sm">{i18n.t.account.dangerDesc}</p>
          </Card.Header>
          <Card.Content>
            <Button variant="destructive" onclick={() => { deletePassword = ""; deleteOpen = true; }}>{i18n.t.account.deleteAccount}</Button>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  </div>
</div>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.account.deleteAccount}</Dialog.Title></Dialog.Header>
    <p class="text-muted-foreground text-sm">{i18n.t.account.deleteAccountConfirm}</p>
    <div class="flex flex-col gap-2">
      <Label for="del-pw">{i18n.t.account.password}</Label>
      <Input id="del-pw" type="password" bind:value={deletePassword} autocomplete="current-password" />
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (deleteOpen = false)}>{i18n.t.users.cancel}</Button>
      <Button variant="destructive" disabled={deleteBusy || !deletePassword} onclick={deleteAccount}>{i18n.t.account.deleteAccount}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
