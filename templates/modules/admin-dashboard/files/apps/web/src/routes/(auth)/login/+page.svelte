<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";

  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let unverified = $state(false);
  let loading = $state(false);

  // Passwordless sign-in, shown only when the server enabled the magic-link plugin.
  const magicLinkEnabled = $derived(data.capabilities?.magicLink ?? false);
  let magicLoading = $state(false);
  let magicSent = $state(false);
  async function sendMagicLink(): Promise<void> {
    if (!email) {
      error = i18n.t.auth.magicLinkNeedsEmail;
      return;
    }
    magicLoading = true;
    error = null;
    const { error: authError } = await api.auth.signIn.magicLink({
      email,
      callbackURL: page.url.searchParams.get("redirect") ?? "/admin",
    });
    magicLoading = false;
    if (authError) {
      error = authError.message ?? i18n.t.auth.signInFailed;
      return;
    }
    magicSent = true;
  }

  // Passwordless sign-in with an emailed one-time code (two steps: send, verify).
  const usernameEnabled = $derived(data.capabilities?.username ?? false);
  const emailOtpEnabled = $derived(data.capabilities?.emailOtp ?? false);
  let otpSent = $state(false);
  let otpCode = $state("");
  let otpLoading = $state(false);
  async function sendOtp(): Promise<void> {
    if (!email) {
      error = i18n.t.auth.magicLinkNeedsEmail;
      return;
    }
    otpLoading = true;
    error = null;
    const { error: authError } = await api.auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    otpLoading = false;
    if (authError) {
      error = authError.message ?? i18n.t.auth.signInFailed;
      return;
    }
    otpSent = true;
  }
  async function verifyOtp(): Promise<void> {
    otpLoading = true;
    error = null;
    const { error: authError } = await api.auth.signIn.emailOtp({ email, otp: otpCode });
    otpLoading = false;
    if (authError) {
      error = authError.message ?? i18n.t.auth.signInFailed;
      return;
    }
    await goto(page.url.searchParams.get("redirect") ?? "/admin", { invalidateAll: true });
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    error = null;
    unverified = false;
    // With the username plugin on, an identifier without "@" is treated as a username.
    const asUsername = usernameEnabled && !email.includes("@");
    const { error: authError } = asUsername
      ? await api.auth.signIn.username({ username: email, password })
      : await api.auth.signIn.email({ email, password });
    loading = false;
    if (authError) {
      // Surface an unverified address with a path to a fresh verification link.
      unverified = authError.code === "EMAIL_NOT_VERIFIED";
      error = unverified ? i18n.t.auth.emailNotVerified : (authError.message ?? i18n.t.auth.signInFailed);
      return;
    }
    await goto(page.url.searchParams.get("redirect") ?? "/admin", { invalidateAll: true });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{i18n.t.auth.signInTitle}</Card.Title>
    <Card.Description>{i18n.t.auth.signInDesc}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4" onsubmit={submit}>
      {#if error}
        <Alert.Root variant="destructive">
          <Alert.Description>
            {error}
            {#if unverified}
              <a href="/verify-email?email={encodeURIComponent(email)}" class="font-medium underline">{i18n.t.auth.resendVerification}</a>
            {/if}
          </Alert.Description>
        </Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="email">{usernameEnabled ? i18n.t.auth.emailOrUsername : i18n.t.auth.email}</Label>
        <Input id="email" type={usernameEnabled ? "text" : "email"} bind:value={email} required autocomplete="username" />
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Label for="password">{i18n.t.auth.password}</Label>
          <a href="/forgot-password" class="text-muted-foreground text-xs hover:underline">{i18n.t.auth.forgot}</a>
        </div>
        <Input id="password" type="password" bind:value={password} required autocomplete="current-password" />
      </div>
      <Button type="submit" disabled={loading}>{loading ? i18n.t.auth.signingIn : i18n.t.auth.signIn}</Button>
    </form>
    {#if magicLinkEnabled || emailOtpEnabled}
      <div class="mt-4 flex flex-col gap-3 border-t pt-4">
        {#if magicLinkEnabled}
          {#if magicSent}
            <p class="text-muted-foreground text-sm" data-testid="magic-link-sent">{i18n.t.auth.magicLinkSent}</p>
          {:else}
            <Button type="button" variant="outline" class="w-full" disabled={magicLoading} onclick={sendMagicLink}>
              {magicLoading ? i18n.t.auth.sending : i18n.t.auth.magicLinkButton}
            </Button>
          {/if}
        {/if}
        {#if emailOtpEnabled}
          {#if otpSent}
            <div class="flex flex-col gap-2">
              <Label for="otp">{i18n.t.auth.otpCode}</Label>
              <Input id="otp" bind:value={otpCode} inputmode="numeric" autocomplete="one-time-code" />
              <Button type="button" class="w-full" disabled={otpLoading || !otpCode} onclick={verifyOtp}>
                {otpLoading ? i18n.t.auth.signingIn : i18n.t.auth.otpVerify}
              </Button>
            </div>
          {:else}
            <Button type="button" variant="outline" class="w-full" disabled={otpLoading} onclick={sendOtp}>
              {otpLoading ? i18n.t.auth.sending : i18n.t.auth.otpButton}
            </Button>
          {/if}
        {/if}
      </div>
    {/if}
  </Card.Content>
  <Card.Footer class="justify-center">
    <p class="text-muted-foreground text-sm">{i18n.t.auth.noAccount} <a href="/signup" class="text-foreground hover:underline">{i18n.t.auth.signUp}</a></p>
  </Card.Footer>
</Card.Root>
