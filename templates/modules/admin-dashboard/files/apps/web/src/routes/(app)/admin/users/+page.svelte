<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import TablePagination from "$lib/components/table-pagination.svelte";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, fmt } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();

  type Row = { id: string; name: string; email: string; role?: string | null; banned?: boolean | null };

  const PAGE_SIZE = 5;
  let users = $state<Row[]>([]);
  let total = $state(0);
  let page = $state(1);
  let search = $state("");
  let busy = $state(false);

  async function load(): Promise<void> {
    const { data: res, error } = await api.auth.admin.listUsers({
      query: {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        ...(search ? { searchField: "email", searchOperator: "contains", searchValue: search } : {}),
      },
    });
    if (error) return void toast.error(error.message ?? i18n.t.users.loadFailed);
    users = (res?.users ?? []) as Row[];
    total = res?.total ?? users.length;
  }

  // Impersonate — become the user, then a banner offers "stop impersonating".
  async function impersonate(u: Row): Promise<void> {
    const { error } = await api.auth.admin.impersonateUser({ userId: u.id });
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    await goto("/admin", { invalidateAll: true });
  }

  // Create user
  let createOpen = $state(false);
  let form = $state({ name: "", email: "", password: "", confirm: "", admin: false });
  let createError = $state("");
  async function createUser(event: Event): Promise<void> {
    event.preventDefault();
    if (form.password !== form.confirm) {
      createError = i18n.t.users.passwordMismatch;
      return;
    }
    createError = "";
    busy = true;
    const { error } = await api.auth.admin.createUser({
      name: form.name,
      email: form.email,
      password: form.password,
      role: form.admin ? "admin" : "user",
    });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    toast.success(i18n.t.users.userCreated);
    createOpen = false;
    form = { name: "", email: "", password: "", confirm: "", admin: false };
    page = 1;
    await load();
  }

  // Manage user — a two-pane modal mirroring the account settings, admin-scoped.
  type ManageSection = "profile" | "security" | "sessions" | "danger";
  type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string | Date };
  let manageOpen = $state(false);
  let mUser = $state<Row | null>(null);
  let mSection = $state<ManageSection>("profile");
  const sections: ManageSection[] = ["profile", "security", "sessions", "danger"];
  // profile
  let mName = $state("");
  let mEmail = $state("");
  let mAdmin = $state(false);
  // security
  let mNewPassword = $state("");
  let mConfirmPassword = $state("");
  let mPwError = $state("");
  let mBanReason = $state("");
  let mBanDays = $state("");
  // sessions
  let mSessions = $state<Session[]>([]);
  // danger
  let mDeleteArmed = $state(false);

  async function openManage(u: Row): Promise<void> {
    mUser = u;
    mSection = "profile";
    mName = u.name;
    mEmail = u.email;
    mAdmin = u.role === "admin";
    mNewPassword = "";
    mConfirmPassword = "";
    mPwError = "";
    mBanReason = "";
    mBanDays = "";
    mDeleteArmed = false;
    mSessions = [];
    manageOpen = true;
    await loadManagedSessions();
  }

  async function loadManagedSessions(): Promise<void> {
    if (!mUser) return;
    const { data: res } = await api.auth.admin.listUserSessions({ userId: mUser.id });
    mSessions = (res?.sessions ?? []) as Session[];
  }

  async function saveProfile(event: Event): Promise<void> {
    event.preventDefault();
    if (!mUser) return;
    busy = true;
    const { error } = await api.auth.admin.updateUser({
      userId: mUser.id,
      data: { name: mName, email: mEmail, role: mAdmin ? "admin" : "user" },
    });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    mUser = { ...mUser, name: mName, email: mEmail, role: mAdmin ? "admin" : "user" };
    toast.success(i18n.t.users.userUpdated);
    await load();
  }

  async function setPassword(event: Event): Promise<void> {
    event.preventDefault();
    if (!mUser) return;
    if (mNewPassword !== mConfirmPassword) {
      mPwError = i18n.t.users.passwordMismatch;
      return;
    }
    mPwError = "";
    busy = true;
    const { error } = await api.auth.admin.setUserPassword({ userId: mUser.id, newPassword: mNewPassword });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    mNewPassword = "";
    mConfirmPassword = "";
    toast.success(i18n.t.users.passwordSet);
  }

  async function ban(event: Event): Promise<void> {
    event.preventDefault();
    if (!mUser) return;
    const days = Number(mBanDays);
    busy = true;
    const { error } = await api.auth.admin.banUser({
      userId: mUser.id,
      ...(mBanReason ? { banReason: mBanReason } : {}),
      ...(days > 0 ? { banExpiresIn: days * 24 * 60 * 60 } : {}),
    });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    mUser = { ...mUser, banned: true };
    toast.success(i18n.t.users.userBanned);
    await load();
  }

  async function unban(): Promise<void> {
    if (!mUser) return;
    busy = true;
    const { error } = await api.auth.admin.unbanUser({ userId: mUser.id });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    mUser = { ...mUser, banned: false };
    toast.success(i18n.t.users.userUnbanned);
    await load();
  }

  async function revokeSession(token: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.admin.revokeUserSession({ sessionToken: token });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.adminSessions.loadFailed);
    toast.success(i18n.t.adminSessions.revoked);
    await loadManagedSessions();
  }

  async function revokeAllSessions(): Promise<void> {
    if (!mUser) return;
    busy = true;
    const { error } = await api.auth.admin.revokeUserSessions({ userId: mUser.id });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.adminSessions.loadFailed);
    toast.success(i18n.t.adminSessions.allRevoked);
    await loadManagedSessions();
  }

  async function deleteUser(): Promise<void> {
    if (!mUser) return;
    busy = true;
    const { error } = await api.auth.admin.removeUser({ userId: mUser.id });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    toast.success(i18n.t.users.userDeleted);
    manageOpen = false;
    await load();
  }

  function searchInput(event: Event): void {
    search = (event.target as HTMLInputElement).value;
    page = 1;
    void load();
  }

  $effect(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between gap-2">
    <h1 class="text-2xl font-semibold">{i18n.t.users.title}</h1>
    <Button onclick={() => { createError = ""; createOpen = true; }}><PlusIcon class="size-4" />{i18n.t.users.addUser}</Button>
  </div>
  <Input placeholder={i18n.t.users.search} value={search} oninput={searchInput} class="max-w-xs" />

  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{i18n.t.users.name}</Table.Head>
          <Table.Head>{i18n.t.users.email}</Table.Head>
          <Table.Head>{i18n.t.users.role}</Table.Head>
          <Table.Head>{i18n.t.users.status}</Table.Head>
          <Table.Head class="w-10"></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each users as user (user.id)}
          <Table.Row>
            <Table.Cell class="font-medium">{user.name}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{user.email}</Table.Cell>
            <Table.Cell><Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role ?? "user"}</Badge></Table.Cell>
            <Table.Cell>
              {#if user.banned}<Badge variant="destructive">{i18n.t.users.banned}</Badge>{:else}<Badge variant="outline">{i18n.t.users.active}</Badge>{/if}
            </Table.Cell>
            <Table.Cell>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon"><EllipsisIcon class="size-4" /></Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onSelect={() => openManage(user)}>{i18n.t.users.manage}</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={user.id === data.currentUserId} onSelect={() => impersonate(user)}>
                    {i18n.t.users.impersonate}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={5} class="text-muted-foreground py-8 text-center">{i18n.t.users.empty}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <TablePagination
    count={total}
    perPage={PAGE_SIZE}
    bind:page
    label={fmt(i18n.t.users.total, { count: total })}
    onPageChange={() => void load()}
  />
</div>

<!-- Create user -->
<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.users.createTitle}</Dialog.Title></Dialog.Header>
    <form onsubmit={createUser} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1"><Label for="c-name">{i18n.t.users.name}</Label><Input id="c-name" bind:value={form.name} required /></div>
      <div class="flex flex-col gap-1"><Label for="c-email">{i18n.t.users.email}</Label><Input id="c-email" type="email" bind:value={form.email} required /></div>
      <div class="flex flex-col gap-1"><Label for="c-password">{i18n.t.users.password}</Label><Input id="c-password" type="password" bind:value={form.password} required /></div>
      <div class="flex flex-col gap-1"><Label for="c-confirm">{i18n.t.users.confirmPassword}</Label><Input id="c-confirm" type="password" bind:value={form.confirm} required /></div>
      {#if createError}<p class="text-destructive text-sm">{createError}</p>{/if}
      <Label class="flex items-center gap-2"><Checkbox bind:checked={form.admin} />{i18n.t.users.makeAdmin}</Label>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (createOpen = false)}>{i18n.t.users.cancel}</Button>
        <Button type="submit" disabled={busy}>{i18n.t.users.create}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Manage user (two-pane) -->
<Dialog.Root bind:open={manageOpen}>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header><Dialog.Title class="truncate">{mUser?.email}</Dialog.Title></Dialog.Header>
    <div class="flex flex-col gap-4 sm:flex-row">
      <nav class="flex shrink-0 flex-wrap gap-1 sm:w-40 sm:flex-col">
        {#each sections as key (key)}
          <button
            type="button"
            onclick={() => (mSection = key)}
            aria-current={mSection === key ? "page" : undefined}
            class="hover:bg-muted rounded-md px-3 py-2 text-left text-sm font-medium transition-colors {mSection === key ? 'bg-muted' : 'text-muted-foreground'}"
          >
            {i18n.t.account.nav[key]}
          </button>
        {/each}
      </nav>

      <div class="min-h-64 min-w-0 flex-1">
        {#if mSection === "profile"}
          <form class="flex flex-col gap-3" onsubmit={saveProfile}>
            <div class="flex flex-col gap-1"><Label for="m-name">{i18n.t.users.name}</Label><Input id="m-name" bind:value={mName} required /></div>
            <div class="flex flex-col gap-1"><Label for="m-email">{i18n.t.users.email}</Label><Input id="m-email" type="email" bind:value={mEmail} required /></div>
            <Label class="flex items-center gap-2"><Checkbox bind:checked={mAdmin} />{i18n.t.users.makeAdmin}</Label>
            {#if mUser?.banned}<Badge variant="destructive" class="w-fit">{i18n.t.users.banned}</Badge>{/if}
            <Button type="submit" class="w-fit" disabled={busy}>{i18n.t.users.save}</Button>
          </form>
        {:else if mSection === "security"}
          <div class="flex flex-col gap-6">
            <form class="flex flex-col gap-3" onsubmit={setPassword}>
              <div class="flex flex-col gap-1"><Label for="m-pw">{i18n.t.users.newPassword}</Label><Input id="m-pw" type="password" bind:value={mNewPassword} required /></div>
              <div class="flex flex-col gap-1"><Label for="m-pw2">{i18n.t.users.confirmNewPassword}</Label><Input id="m-pw2" type="password" bind:value={mConfirmPassword} required /></div>
              {#if mPwError}<p class="text-destructive text-sm">{mPwError}</p>{/if}
              <Button type="submit" class="w-fit" disabled={busy}>{i18n.t.users.setPassword}</Button>
            </form>
            <div class="border-t pt-4">
              {#if mUser?.banned}
                <Button variant="outline" disabled={busy} onclick={unban}>{i18n.t.users.unban}</Button>
              {:else}
                <form class="flex flex-col gap-3" onsubmit={ban}>
                  <div class="flex flex-col gap-1"><Label for="m-reason">{i18n.t.users.banReason}</Label><Input id="m-reason" bind:value={mBanReason} /></div>
                  <div class="flex flex-col gap-1"><Label for="m-days">{i18n.t.users.banExpiryDays}</Label><Input id="m-days" type="number" min="0" bind:value={mBanDays} /></div>
                  <Button type="submit" variant="destructive" class="w-fit" disabled={busy}>{i18n.t.users.ban}</Button>
                </form>
              {/if}
            </div>
          </div>
        {:else if mSection === "sessions"}
          <div class="flex flex-col gap-3">
            <div class="flex justify-end">
              <Button variant="outline" size="sm" disabled={busy || mSessions.length === 0} onclick={revokeAllSessions}>{i18n.t.adminSessions.revokeAll}</Button>
            </div>
            <div class="rounded-md border">
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>{i18n.t.adminSessions.device}</Table.Head>
                    <Table.Head>{i18n.t.adminSessions.ip}</Table.Head>
                    <Table.Head>{i18n.t.adminSessions.since}</Table.Head>
                    <Table.Head class="w-10"></Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each mSessions as s (s.id)}
                    <Table.Row>
                      <Table.Cell class="max-w-40 truncate">{s.userAgent ?? i18n.t.adminSessions.unknown}</Table.Cell>
                      <Table.Cell class="text-muted-foreground">{s.ipAddress ?? "—"}</Table.Cell>
                      <Table.Cell class="text-muted-foreground">{new Date(s.createdAt).toLocaleString(i18n.locale)}</Table.Cell>
                      <Table.Cell><Button variant="ghost" size="sm" disabled={busy} onclick={() => revokeSession(s.token)}>{i18n.t.users.revokeSession}</Button></Table.Cell>
                    </Table.Row>
                  {:else}
                    <Table.Row><Table.Cell colspan={4} class="text-muted-foreground py-8 text-center">{i18n.t.adminSessions.empty}</Table.Cell></Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          </div>
        {:else if mSection === "danger"}
          <div class="border-destructive/50 flex flex-col gap-3 rounded-md border p-4">
            <p class="text-muted-foreground text-sm">{fmt(i18n.t.users.deleteConfirm, { email: mUser?.email ?? "" })}</p>
            {#if mDeleteArmed}
              <div class="flex gap-2">
                <Button variant="outline" onclick={() => (mDeleteArmed = false)}>{i18n.t.users.cancel}</Button>
                <Button variant="destructive" disabled={busy} onclick={deleteUser}>{i18n.t.users.delete}</Button>
              </div>
            {:else}
              <Button
                variant="destructive"
                class="w-fit"
                disabled={mUser?.id === data.currentUserId}
                onclick={() => (mDeleteArmed = true)}
              >
                {i18n.t.users.delete}
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
