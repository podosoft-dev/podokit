<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";

  const i18n = getI18n();
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
      error = authError.message ?? i18n.t.auth.signUpFailed;
      return;
    }
    await goto("/admin", { invalidateAll: true });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{i18n.t.auth.createTitle}</Card.Title>
    <Card.Description>{i18n.t.auth.createDesc}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4" onsubmit={submit}>
      {#if error}
        <Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="name">{i18n.t.auth.name}</Label>
        <Input id="name" bind:value={name} required autocomplete="name" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="email">{i18n.t.auth.email}</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="password">{i18n.t.auth.password}</Label>
        <Input id="password" type="password" bind:value={password} required autocomplete="new-password" />
      </div>
      <Button type="submit" disabled={loading}>{loading ? i18n.t.auth.creating : i18n.t.auth.create}</Button>
    </form>
  </Card.Content>
  <Card.Footer class="justify-center">
    <p class="text-muted-foreground text-sm">{i18n.t.auth.haveAccount} <a href="/login" class="text-foreground hover:underline">{i18n.t.auth.signIn}</a></p>
  </Card.Footer>
</Card.Root>
