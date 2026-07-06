<script lang="ts">
  import LanguageSwitch from "$lib/components/language-switch.svelte";
  let { children } = $props();
</script>

<div class="bg-muted/30 relative flex min-h-svh items-center justify-center p-6">
  <div class="absolute right-4 top-4">
    <LanguageSwitch />
  </div>
  <div class="w-full max-w-sm">
    {@render children()}
  </div>
</div>
