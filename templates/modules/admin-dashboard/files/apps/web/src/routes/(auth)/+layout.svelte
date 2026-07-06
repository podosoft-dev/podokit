<script lang="ts">
  let { children } = $props();
</script>

<div class="bg-muted/30 flex min-h-svh items-center justify-center p-6">
  <div class="w-full max-w-sm">
    {@render children()}
  </div>
</div>
