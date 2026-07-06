<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    error = null;
    const { error: authError } = await api.auth.signUp.email({ name, email, password });
    loading = false;
    if (authError) {
      error = authError.message ?? "Sign up failed";
      return;
    }
    await goto("/dashboard", { invalidateAll: true });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Create account</Card.Title>
    <Card.Description>Sign up to get started.</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4" onsubmit={submit}>
      {#if error}
        <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="name">Name</Label>
        <Input id="name" bind:value={name} required autocomplete="name" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="email">Email</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="password">Password</Label>
        <Input id="password" type="password" bind:value={password} required autocomplete="new-password" />
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Creating…" : "Create account"}</Button>
    </form>
  </Card.Content>
  <Card.Footer class="justify-center">
    <p class="text-muted-foreground text-sm">Have an account? <a href="/login" class="text-foreground hover:underline">Sign in</a></p>
  </Card.Footer>
</Card.Root>
