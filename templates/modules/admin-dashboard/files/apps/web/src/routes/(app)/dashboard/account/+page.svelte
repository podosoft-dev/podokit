<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import { untrack } from "svelte";
  import type { SessionUser } from "../../../../app.d.ts";

  let { data }: { data: { user: SessionUser; currentSessionId: string | null } } = $props();
  const i18n = getI18n();

  type SectionKey = "profile" | "security" | "sessions";
  let section = $state<SectionKey>("profile");
  const navItems: SectionKey[] = ["profile", "security", "sessions"];

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

  // Sessions — this user's own devices
  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  const PAGE_SIZE = 5;
  let sessions = $state<Session[]>([]);
  let sessionsPage = $state(1);
  let busy = $state(false);
  const pagedSessions = $derived(sessions.slice((sessionsPage - 1) * PAGE_SIZE, sessionsPage * PAGE_SIZE));

  async function loadSessions(): Promise<void> {
    const { data: res, error } = await api.auth.listSessions();
    if (error) {
      toast.error(error.message ?? i18n.t.sessions.loadFailed);
      return;
    }
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

  $effect(() => {
    void loadSessions();
  });
</script>

<div class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">{i18n.t.account.title}</h1>

  <div class="flex flex-col gap-6 lg:flex-row">
    <nav class="flex shrink-0 gap-1 lg:w-48 lg:flex-col">
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
              <Button type="submit" class="w-fit" disabled={savingProfile || !nameChanged}>
                {i18n.t.account.save}
              </Button>
            </form>
          </Card.Content>
        </Card.Root>
      {:else if section === "security"}
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
              <Button type="submit" class="w-fit" disabled={changing}>
                {changing ? i18n.t.account.updating : i18n.t.account.update}
              </Button>
            </form>
          </Card.Content>
        </Card.Root>
      {:else if section === "sessions"}
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between gap-2">
            <Card.Title>{i18n.t.sessions.title}</Card.Title>
            <Button variant="outline" size="sm" disabled={busy || sessions.length <= 1} onclick={signOutOthers}>
              {i18n.t.sessions.signOutOthers}
            </Button>
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
                        <Button variant="ghost" size="sm" disabled={busy || isCurrent} onclick={() => revoke(s.token)}>
                          {i18n.t.sessions.revoke}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  {:else}
                    <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{i18n.t.sessions.empty}</Table.Cell></Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
            <div class="mt-4">
              <TablePagination
                count={sessions.length}
                perPage={PAGE_SIZE}
                bind:page={sessionsPage}
                label={fmt(i18n.t.sessions.total, { count: sessions.length })}
              />
            </div>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  </div>
</div>
