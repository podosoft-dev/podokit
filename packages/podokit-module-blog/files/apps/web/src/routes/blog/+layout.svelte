<script lang="ts">
  import { page } from "$app/state";
  import AccountMenu from "$lib/components/account-menu.svelte";

  let { children } = $props();
  const user = $derived(page.data.user ?? null);
</script>

<header class="mx-auto flex w-full max-w-5xl items-center justify-end px-6 pt-4">
  <AccountMenu {user} />
</header>

{@render children()}
