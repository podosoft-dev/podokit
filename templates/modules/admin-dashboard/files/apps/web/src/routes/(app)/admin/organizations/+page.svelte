<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n, formatDateTime } from "$lib/i18n";

  const i18n = getI18n();

  type Org = { id: string; name: string; slug: string; createdAt: string | Date };
  let orgs = $state<Org[]>([]);
  let busy = $state(false);
  let createOpen = $state(false);
  let form = $state({ name: "", slug: "" });

  async function load(): Promise<void> {
    const { data } = await api.auth.organization.list();
    orgs = (data ?? []) as Org[];
  }

  // Derive a slug from the name unless the user typed one.
  const slugify = (s: string): string =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  async function createOrg(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    const slug = form.slug.trim() || slugify(form.name);
    const { error } = await api.auth.organization.create({ name: form.name.trim(), slug });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.organizations.actionFailed);
    toast.success(i18n.t.organizations.createdMsg);
    createOpen = false;
    form = { name: "", slug: "" };
    await load();
  }

  async function deleteOrg(organizationId: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.organization.delete({ organizationId });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.organizations.actionFailed);
    toast.success(i18n.t.organizations.deletedMsg);
    await load();
  }

  // Members & invitations for one organization.
  type Member = { id: string; role: string; user: { email: string; name: string } };
  type Invitation = { id: string; email: string; role: string; status: string };
  let manageOpen = $state(false);
  let manageOrg = $state<Org | null>(null);
  let members = $state<Member[]>([]);
  let invitations = $state<Invitation[]>([]);
  let inviteEmail = $state("");

  async function openManage(org: Org): Promise<void> {
    manageOrg = org;
    manageOpen = true;
    members = [];
    invitations = [];
    await refreshMembers();
  }
  async function refreshMembers(): Promise<void> {
    if (!manageOrg) return;
    const { data } = await api.auth.organization.getFullOrganization({ query: { organizationId: manageOrg.id } });
    members = ((data as { members?: Member[] } | null)?.members ?? []) as Member[];
    invitations = (((data as { invitations?: Invitation[] } | null)?.invitations ?? []) as Invitation[]).filter((i) => i.status === "pending");
  }
  async function invite(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!manageOrg) return;
    busy = true;
    const { error } = await api.auth.organization.inviteMember({ email: inviteEmail.trim(), role: "member", organizationId: manageOrg.id });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.organizations.actionFailed);
    toast.success(i18n.t.organizations.invited);
    inviteEmail = "";
    await refreshMembers();
  }
  async function removeMember(memberIdOrEmail: string): Promise<void> {
    if (!manageOrg) return;
    busy = true;
    const { error } = await api.auth.organization.removeMember({ memberIdOrEmail, organizationId: manageOrg.id });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.organizations.actionFailed);
    await refreshMembers();
  }
  async function cancelInvite(invitationId: string): Promise<void> {
    busy = true;
    const { error } = await api.auth.organization.cancelInvitation({ invitationId });
    busy = false;
    if (error) return void toast.error(error.message ?? i18n.t.organizations.actionFailed);
    await refreshMembers();
  }

  $effect(() => {
    void load();
  });
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center justify-between gap-2">
    <div>
      <h1 class="text-2xl font-semibold">{i18n.t.organizations.title}</h1>
      <p class="text-muted-foreground text-sm">{i18n.t.organizations.subtitle}</p>
    </div>
    <Button onclick={() => (createOpen = true)}>{i18n.t.organizations.create}</Button>
  </div>

  <Card.Root>
    <Card.Content class="p-0">
      {#if orgs.length}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{i18n.t.organizations.name}</Table.Head>
              <Table.Head>{i18n.t.organizations.slug}</Table.Head>
              <Table.Head>{i18n.t.organizations.created}</Table.Head>
              <Table.Head class="w-10"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each orgs as org (org.id)}
              <Table.Row>
                <Table.Cell class="font-medium">{org.name}</Table.Cell>
                <Table.Cell class="text-muted-foreground font-mono text-xs">{org.slug}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{formatDateTime(org.createdAt)}</Table.Cell>
                <Table.Cell class="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onclick={() => openManage(org)}>{i18n.t.organizations.manage}</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onclick={() => deleteOrg(org.id)}>{i18n.t.organizations.delete}</Button>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {:else}
        <p class="text-muted-foreground p-6 text-sm">{i18n.t.organizations.empty}</p>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<Dialog.Root bind:open={manageOpen}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{manageOrg?.name}</Dialog.Title>
      <Dialog.Description>{i18n.t.organizations.membersDesc}</Dialog.Description>
    </Dialog.Header>
    <form class="flex items-end gap-2" onsubmit={invite}>
      <div class="flex flex-1 flex-col gap-1">
        <Label for="invite-email">{i18n.t.organizations.inviteEmail}</Label>
        <Input id="invite-email" type="email" bind:value={inviteEmail} placeholder="teammate@example.com" required />
      </div>
      <Button type="submit" disabled={busy || !inviteEmail.trim()}>{i18n.t.organizations.invite}</Button>
    </form>
    <div class="flex flex-col gap-2">
      <p class="text-sm font-medium">{i18n.t.organizations.members}</p>
      {#each members as m (m.id)}
        <div class="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <div><span class="font-medium">{m.user.name || m.user.email}</span> <span class="text-muted-foreground">· {m.role}</span></div>
          {#if m.role !== "owner"}
            <Button variant="ghost" size="sm" disabled={busy} onclick={() => removeMember(m.id)}>{i18n.t.organizations.remove}</Button>
          {/if}
        </div>
      {/each}
      {#if invitations.length}
        <p class="text-sm font-medium">{i18n.t.organizations.pending}</p>
        {#each invitations as inv (inv.id)}
          <div class="flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm">
            <span class="text-muted-foreground">{inv.email} · {inv.role}</span>
            <Button variant="ghost" size="sm" disabled={busy} onclick={() => cancelInvite(inv.id)}>{i18n.t.organizations.cancelInvite}</Button>
          </div>
        {/each}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{i18n.t.organizations.createTitle}</Dialog.Title>
    </Dialog.Header>
    <form class="flex flex-col gap-3" onsubmit={createOrg}>
      <div class="flex flex-col gap-1">
        <Label for="o-name">{i18n.t.organizations.name}</Label>
        <Input id="o-name" bind:value={form.name} required />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="o-slug">{i18n.t.organizations.slug}</Label>
        <Input id="o-slug" bind:value={form.slug} placeholder={form.name ? slugify(form.name) : "acme"} />
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (createOpen = false)}>{i18n.t.organizations.cancel}</Button>
        <Button type="submit" disabled={busy || !form.name.trim()}>{i18n.t.organizations.submit}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
