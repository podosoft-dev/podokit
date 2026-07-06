<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";

  let email = $state("");
  let sent = $state(false);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    error = null;
    const { error: authError } = await api.auth.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    loading = false;
    if (authError) {
      error = authError.message ?? "Request failed";
      return;
    }
    sent = true;
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Reset password</Card.Title>
    <Card.Description>We'll send a reset link to your email.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if sent}
      <Alert.Root><Alert.Description>If that email exists, a reset link is on its way.</Alert.Description></Alert.Root>
    {:else}
      <form class="flex flex-col gap-4" onsubmit={submit}>
        {#if error}
          <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>
        {/if}
        <div class="flex flex-col gap-2">
          <Label for="email">Email</Label>
          <Input id="email" type="email" bind:value={email} required autocomplete="email" />
        </div>
        <Button type="submit" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</Button>
      </form>
    {/if}
  </Card.Content>
  <Card.Footer class="justify-center">
    <a href="/login" class="text-muted-foreground text-sm hover:underline">Back to sign in</a>
  </Card.Footer>
</Card.Root>
