<script lang="ts">
  import { renderMarkdown } from "./render";

  // Renders untrusted Markdown as sanitized HTML. Style the output via the
  // `class` prop (e.g. Tailwind typography utilities) — the module stays
  // unopinionated so consuming pages own the look.
  let { source, class: className = "" }: { source: string; class?: string } = $props();
  const html = $derived(renderMarkdown(source));
</script>

<div class={`markdown ${className}`}>
  <!-- html is sanitized by renderMarkdown (scripts/handlers stripped) -->
  {@html html}
</div>
