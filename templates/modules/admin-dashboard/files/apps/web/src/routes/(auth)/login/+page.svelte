<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";

  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    error = null;
    const { error: authError } = await api.auth.signIn.email({ email, password });
    loading = false;
    if (authError) {
      error = authError.message ?? "Sign in failed";
      return;
    }
    const redirect = page.url.searchParams.get("redirect") ?? "/dashboard";
    await goto(redirect, { invalidateAll: true });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Sign in</Card.Title>
    <Card.Description>Enter your credentials to continue.</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4" onsubmit={submit}>
      {#if error}
        <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="email">Email</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Label for="password">Password</Label>
          <a href="/forgot-password" class="text-muted-foreground text-xs hover:underline">Forgot?</a>
        </div>
        <Input id="password" type="password" bind:value={password} required autocomplete="current-password" />
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
    </form>
  </Card.Content>
  <Card.Footer class="justify-center">
    <p class="text-muted-foreground text-sm">No account? <a href="/signup" class="text-foreground hover:underline">Sign up</a></p>
  </Card.Footer>
</Card.Root>
