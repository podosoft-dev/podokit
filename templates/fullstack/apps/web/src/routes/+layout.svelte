<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import SiteRuntime from "#lib/components/site-runtime.svelte";

  let { children } = $props();

  onMount(() => {
    document.documentElement.dataset.hydrated = "true";
  });
</script>

<SiteRuntime />
{@render children()}
