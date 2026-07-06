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
  let loading = $state(false);
  let busy = $state(false);

  async function load(): Promise<void> {
    loading = true;
    const { data: res, error } = await api.auth.admin.listUsers({
      query: {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        ...(search ? { searchField: "email", searchOperator: "contains", searchValue: search } : {}),
      },
    });
    loading = false;
    if (error) {
      toast.error(error.message ?? i18n.t.users.loadFailed);
      return;
    }
    users = (res?.users ?? []) as Row[];
    total = res?.total ?? users.length;
  }

  async function act(promise: Promise<{ error?: { message?: string } | null }>, ok: string): Promise<void> {
    const { error } = await promise;
    if (error) toast.error(error.message ?? i18n.t.users.actionFailed);
    else {
      toast.success(ok);
      await load();
    }
  }

  const setRole = (u: Row, role: "user" | "admin") =>
    act(api.auth.admin.setRole({ userId: u.id, role }), fmt(i18n.t.users.roleSet, { role }));
  const unban = (u: Row) => act(api.auth.admin.unbanUser({ userId: u.id }), i18n.t.users.userUnbanned);

  // Edit user
  let editOpen = $state(false);
  let editUser = $state<Row | null>(null);
  let editForm = $state({ name: "", email: "", admin: false });
  function openEdit(u: Row): void {
    editUser = u;
    editForm = { name: u.name, email: u.email, admin: u.role === "admin" };
    editOpen = true;
  }
  async function submitEdit(event: Event): Promise<void> {
    event.preventDefault();
    if (!editUser) return;
    busy = true;
    const { error } = await api.auth.admin.updateUser({
      userId: editUser.id,
      data: { name: editForm.name, email: editForm.email, role: editForm.admin ? "admin" : "user" },
    });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    toast.success(i18n.t.users.userUpdated);
    editOpen = false;
    await load();
  }

  // Ban user (with optional reason + expiry)
  let banOpen = $state(false);
  let banUser = $state<Row | null>(null);
  let banReason = $state("");
  let banDays = $state("");
  function openBan(u: Row): void {
    banUser = u;
    banReason = "";
    banDays = "";
    banOpen = true;
  }
  async function submitBan(event: Event): Promise<void> {
    event.preventDefault();
    if (!banUser) return;
    const days = Number(banDays);
    busy = true;
    const { error } = await api.auth.admin.banUser({
      userId: banUser.id,
      ...(banReason ? { banReason } : {}),
      ...(days > 0 ? { banExpiresIn: days * 24 * 60 * 60 } : {}),
    });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    toast.success(i18n.t.users.userBanned);
    banOpen = false;
    await load();
  }

  // Impersonate — become the user, then a banner offers "stop impersonating".
  async function impersonate(u: Row): Promise<void> {
    const { error } = await api.auth.admin.impersonateUser({ userId: u.id });
    if (error) return void toast.error(error.message ?? i18n.t.users.actionFailed);
    await goto("/dashboard", { invalidateAll: true });
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
    if (error) {
      toast.error(error.message ?? i18n.t.users.actionFailed);
      return;
    }
    toast.success(i18n.t.users.userCreated);
    createOpen = false;
    form = { name: "", email: "", password: "", confirm: "", admin: false };
    page = 1;
    await load();
  }

  // Set password
  let pwOpen = $state(false);
  let pwUser = $state<Row | null>(null);
  let newPassword = $state("");
  let confirmNewPassword = $state("");
  let pwError = $state("");
  function openPassword(u: Row): void {
    pwUser = u;
    newPassword = "";
    confirmNewPassword = "";
    pwError = "";
    pwOpen = true;
  }
  async function submitPassword(event: Event): Promise<void> {
    event.preventDefault();
    if (!pwUser) return;
    if (newPassword !== confirmNewPassword) {
      pwError = i18n.t.users.passwordMismatch;
      return;
    }
    pwError = "";
    busy = true;
    const { error } = await api.auth.admin.setUserPassword({ userId: pwUser.id, newPassword });
    busy = false;
    if (error) {
      toast.error(error.message ?? i18n.t.users.actionFailed);
      return;
    }
    toast.success(i18n.t.users.passwordSet);
    pwOpen = false;
  }

  // Delete user
  let deleteOpen = $state(false);
  let deleteUser = $state<Row | null>(null);
  function openDelete(u: Row): void {
    deleteUser = u;
    deleteOpen = true;
  }
  async function confirmDelete(): Promise<void> {
    if (!deleteUser) return;
    busy = true;
    const { error } = await api.auth.admin.removeUser({ userId: deleteUser.id });
    busy = false;
    if (error) {
      toast.error(error.message ?? i18n.t.users.actionFailed);
      return;
    }
    toast.success(i18n.t.users.userDeleted);
    deleteOpen = false;
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
                  <DropdownMenu.Item onSelect={() => openEdit(user)}>{i18n.t.users.edit}</DropdownMenu.Item>
                  {#if user.role === "admin"}
                    <DropdownMenu.Item onSelect={() => setRole(user, "user")}>{i18n.t.users.makeUser}</DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item onSelect={() => setRole(user, "admin")}>{i18n.t.users.makeAdmin}</DropdownMenu.Item>
                  {/if}
                  {#if user.banned}
                    <DropdownMenu.Item onSelect={() => unban(user)}>{i18n.t.users.unban}</DropdownMenu.Item>
                  {:else}
                    <DropdownMenu.Item onSelect={() => openBan(user)}>{i18n.t.users.ban}</DropdownMenu.Item>
                  {/if}
                  <DropdownMenu.Item onSelect={() => openPassword(user)}>{i18n.t.users.setPassword}</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={user.id === data.currentUserId} onSelect={() => impersonate(user)}>
                    {i18n.t.users.impersonate}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    variant="destructive"
                    disabled={user.id === data.currentUserId}
                    onSelect={() => openDelete(user)}
                  >
                    {i18n.t.users.delete}
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

<!-- Set password -->
<Dialog.Root bind:open={pwOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.users.setPassword}</Dialog.Title></Dialog.Header>
    <form onsubmit={submitPassword} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1"><Label for="p-password">{i18n.t.users.newPassword}</Label><Input id="p-password" type="password" bind:value={newPassword} required /></div>
      <div class="flex flex-col gap-1"><Label for="p-confirm">{i18n.t.users.confirmNewPassword}</Label><Input id="p-confirm" type="password" bind:value={confirmNewPassword} required /></div>
      {#if pwError}<p class="text-destructive text-sm">{pwError}</p>{/if}
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (pwOpen = false)}>{i18n.t.users.cancel}</Button>
        <Button type="submit" disabled={busy}>{i18n.t.users.save}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirmation -->
<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.users.deleteTitle}</Dialog.Title></Dialog.Header>
    <p class="text-muted-foreground text-sm">{fmt(i18n.t.users.deleteConfirm, { email: deleteUser?.email ?? "" })}</p>
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (deleteOpen = false)}>{i18n.t.users.cancel}</Button>
      <Button type="button" variant="destructive" disabled={busy} onclick={confirmDelete}>{i18n.t.users.delete}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Edit user -->
<Dialog.Root bind:open={editOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.users.editTitle}</Dialog.Title></Dialog.Header>
    <form onsubmit={submitEdit} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1"><Label for="e-name">{i18n.t.users.name}</Label><Input id="e-name" bind:value={editForm.name} required /></div>
      <div class="flex flex-col gap-1"><Label for="e-email">{i18n.t.users.email}</Label><Input id="e-email" type="email" bind:value={editForm.email} required /></div>
      <Label class="flex items-center gap-2"><Checkbox bind:checked={editForm.admin} />{i18n.t.users.makeAdmin}</Label>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (editOpen = false)}>{i18n.t.users.cancel}</Button>
        <Button type="submit" disabled={busy}>{i18n.t.users.save}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Ban user -->
<Dialog.Root bind:open={banOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{i18n.t.users.banTitle}</Dialog.Title></Dialog.Header>
    <form onsubmit={submitBan} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1"><Label for="b-reason">{i18n.t.users.banReason}</Label><Input id="b-reason" bind:value={banReason} /></div>
      <div class="flex flex-col gap-1"><Label for="b-days">{i18n.t.users.banExpiryDays}</Label><Input id="b-days" type="number" min="0" bind:value={banDays} /></div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (banOpen = false)}>{i18n.t.users.cancel}</Button>
        <Button type="submit" variant="destructive" disabled={busy}>{i18n.t.users.ban}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
