<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import type { SessionUser } from "../../../../app.d.ts";

  let { data }: { data: { user: SessionUser } } = $props();
  let currentPassword = $state("");
  let newPassword = $state("");
  let loading = $state(false);

  async function changePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    const { error } = await api.auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    loading = false;
    if (error) toast.error(error.message ?? "Failed to change password");
    else { toast.success("Password changed"); currentPassword = ""; newPassword = ""; }
  }
</script>

<div class="flex max-w-2xl flex-col gap-6">
  <h1 class="text-2xl font-semibold">Account</h1>
  <Card.Root>
    <Card.Header><Card.Title>Profile</Card.Title></Card.Header>
    <Card.Content class="flex flex-col gap-2 text-sm">
      <div><span class="text-muted-foreground">Name:</span> {data.user.name}</div>
      <div><span class="text-muted-foreground">Email:</span> {data.user.email}</div>
      <div><span class="text-muted-foreground">Role:</span> <span class="capitalize">{data.user.role ?? "user"}</span></div>
    </Card.Content>
  </Card.Root>
  <Card.Root>
    <Card.Header><Card.Title>Change password</Card.Title></Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-4" onsubmit={changePassword}>
        <div class="flex flex-col gap-2">
          <Label for="current">Current password</Label>
          <Input id="current" type="password" bind:value={currentPassword} required autocomplete="current-password" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="new">New password</Label>
          <Input id="new" type="password" bind:value={newPassword} required autocomplete="new-password" />
        </div>
        <Button type="submit" class="w-fit" disabled={loading}>{loading ? "Updating…" : "Update password"}</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
