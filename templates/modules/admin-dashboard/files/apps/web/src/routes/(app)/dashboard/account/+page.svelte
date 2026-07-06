<script lang="ts">
  import { goto } from "$app/navigation";
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
  import { getI18n, fmt } from "$lib/i18n";
  import { untrack } from "svelte";
  import type { SessionUser } from "../../../../app.d.ts";

  let { data }: { data: { user: SessionUser; currentSessionId: string | null } } = $props();
  const i18n = getI18n();

  // Optional features, resolved from the API so we only show enabled sections.
  let caps = $state<{ twoFactor: boolean; providers: string[]; deleteAccount: boolean }>({
    twoFactor: false,
    providers: [],
    deleteAccount: false,
  });

  type SectionKey = "profile" | "security" | "connected" | "sessions" | "danger";
  let section = $state<SectionKey>("profile");
  const navItems = $derived<SectionKey[]>([
    "profile",
    "security",
    ...(caps.providers.length ? (["connected"] as const) : []),
    "sessions",
    ...(caps.deleteAccount ? (["danger"] as const) : []),
  ]);

  // Profile — seed the editable field from the initial user value.
  let name = $state(untrack(() => data.user.name));
  let savingProfile = $state(false);
  const nameChanged = $derived(name.trim() !== "" && name !== data.user.name);
  async function saveProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    savingProfile = true;
    const { error } = await api.auth.updateUser({ name });
    savingProfile = false;
    if (error) toast.error(error.message ?? i18n.t.account.saveFailed);
    else toast.success(i18n.t.account.saved);
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

  // Connected accounts
  type Account = { id: string; providerId: string; accountId: string };
  let accounts = $state<Account[]>([]);
  async function loadAccounts(): Promise<void> {
    const { data: res } = await api.auth.listAccounts();
    accounts = (res ?? []) as Account[];
  }
  const linkedProviders = $derived(new Set(accounts.map((a) => a.providerId)));
  async function connect(provider: string): Promise<void> {
    const { data: res, error } = await api.auth.linkSocial({ provider, callbackURL: "/dashboard/account" });
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
    sessions = (res ?? []) as Session[];
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

  async function loadCapabilities(): Promise<void> {
    try {
      const res = await fetch("/api/account/capabilities");
      if (res.ok) caps = await res.json();
    } catch {
      /* keep defaults */
    }
  }

  $effect(() => {
    void loadCapabilities();
    void loadSessions();
    void loadAccounts();
  });
</script>

<div class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">{i18n.t.account.title}</h1>

  <div class="flex flex-col gap-6 lg:flex-row">
    <nav class="flex shrink-0 flex-wrap gap-1 lg:w-48 lg:flex-col">
      {#each navItems as key (key)}
        <button
          type="button"
          onclick={() => (section = key)}
          aria-current={section === key ? "page" : undefined}
          class="hover:bg-muted rounded-md px-3 py-2 text-left text-sm font-medium transition-colors {section === key ? 'bg-muted' : 'text-muted-foreground'}"
        >
          {i18n.t.account.nav[key]}
        </button>
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
              <div class="flex flex-col gap-2">
                <Label for="email">{i18n.t.account.email}</Label>
                <div class="flex items-center gap-2">
                  <Input id="email" value={data.user.email} readonly class="text-muted-foreground" />
                  <Badge variant={data.user.emailVerified ? "outline" : "secondary"}>
                    {data.user.emailVerified ? i18n.t.account.verified : i18n.t.account.unverified}
                  </Badge>
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Label>{i18n.t.account.role}</Label>
                <div class="text-muted-foreground text-sm capitalize">{data.user.role ?? "user"}</div>
              </div>
              <Button type="submit" class="w-fit" disabled={savingProfile || !nameChanged}>{i18n.t.account.save}</Button>
            </form>
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
                      <Table.Cell class="text-muted-foreground">{new Date(s.createdAt).toLocaleString(i18n.locale)}</Table.Cell>
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
