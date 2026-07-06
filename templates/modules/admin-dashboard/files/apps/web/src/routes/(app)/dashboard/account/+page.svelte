<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";
  import type { SessionUser } from "../../../../app.d.ts";

  let { data }: { data: { user: SessionUser } } = $props();
  const i18n = getI18n();
  let currentPassword = $state("");
  let newPassword = $state("");
  let loading = $state(false);

  async function changePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    const { error } = await api.auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    loading = false;
    if (error) toast.error(error.message ?? i18n.t.account.changeFailed);
    else { toast.success(i18n.t.account.changed); currentPassword = ""; newPassword = ""; }
  }
</script>

<div class="flex max-w-2xl flex-col gap-6">
  <h1 class="text-2xl font-semibold">{i18n.t.account.title}</h1>
  <Card.Root>
    <Card.Header><Card.Title>{i18n.t.account.profile}</Card.Title></Card.Header>
    <Card.Content class="flex flex-col gap-2 text-sm">
      <div><span class="text-muted-foreground">{i18n.t.account.name}:</span> {data.user.name}</div>
      <div><span class="text-muted-foreground">{i18n.t.account.email}:</span> {data.user.email}</div>
      <div><span class="text-muted-foreground">{i18n.t.account.role}:</span> <span class="capitalize">{data.user.role ?? "user"}</span></div>
    </Card.Content>
  </Card.Root>
  <Card.Root>
    <Card.Header><Card.Title>{i18n.t.account.changePassword}</Card.Title></Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-4" onsubmit={changePassword}>
        <div class="flex flex-col gap-2">
          <Label for="current">{i18n.t.account.currentPassword}</Label>
          <Input id="current" type="password" bind:value={currentPassword} required autocomplete="current-password" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="new">{i18n.t.account.newPassword}</Label>
          <Input id="new" type="password" bind:value={newPassword} required autocomplete="new-password" />
        </div>
        <Button type="submit" class="w-fit" disabled={loading}>{loading ? i18n.t.account.updating : i18n.t.account.update}</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
