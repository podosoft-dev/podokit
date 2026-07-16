<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { currentPath, withAuthRedirect } from "$lib/auth-redirect";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import UserIcon from "@lucide/svelte/icons/user";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";
  import type { SessionUser } from "../../app.d.ts";
  import UserAvatar from "./user-avatar.svelte";

  let { user }: { user: SessionUser | null } = $props();
  const i18n = getI18n();
  const loginHref = $derived(withAuthRedirect("/login", currentPath(page.url)));

  async function signOut(): Promise<void> {
    const returnTo = currentPath(page.url);
    await api.auth.signOut();
    await goto(returnTo, { invalidateAll: true });
  }
</script>

{#if user}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      data-testid="account-menu"
      class="hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-3"
      aria-label={i18n.t.nav.account}
    >
      <UserAvatar {user} class="size-8" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-56">
      <DropdownMenu.Label>
        <span class="block truncate font-medium">{user.name}</span>
        <span class="text-muted-foreground block truncate text-xs font-normal">{user.email}</span>
      </DropdownMenu.Label>
      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={() => goto("/account")}><UserIcon class="mr-2 size-4" /> {i18n.t.nav.account}</DropdownMenu.Item>
      {#if user.role === "admin"}
        <DropdownMenu.Item onSelect={() => goto("/admin")}><LayoutDashboardIcon class="mr-2 size-4" /> {i18n.t.common.appName}</DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
      <DropdownMenu.Item data-testid="sign-out" onSelect={signOut}><LogOutIcon class="mr-2 size-4" /> {i18n.t.nav.signOut}</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <Button data-testid="sign-in-link" href={loginHref} variant="ghost">{i18n.t.auth.signIn}</Button>
{/if}
