<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";

  let password = $state("");
  let error = $state<string | null>(null);
  let loading = $state(false);
  const token = $derived(page.url.searchParams.get("token") ?? "");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    error = null;
    const { error: authError } = await api.auth.resetPassword({ newPassword: password, token });
    loading = false;
    if (authError) {
      error = authError.message ?? "Reset failed";
      return;
    }
    await goto("/login", { invalidateAll: true });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Set a new password</Card.Title>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4" onsubmit={submit}>
      {#if error}
        <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>
      {/if}
      {#if !token}
        <Alert.Root variant="destructive"><Alert.Description>Missing or invalid reset token.</Alert.Description></Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="password">New password</Label>
        <Input id="password" type="password" bind:value={password} required autocomplete="new-password" />
      </div>
      <Button type="submit" disabled={loading || !token}>{loading ? "Updating…" : "Update password"}</Button>
    </form>
  </Card.Content>
</Card.Root>
