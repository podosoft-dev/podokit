<script lang="ts">
  import { renderContent, type ContentFormat } from "./render";

  // Renders body content of a chosen format (text / markdown / html). HTML and
  // Markdown are sanitized (safe for {@html}); text is escaped and keeps its
  // whitespace. Style via the `class` prop — unopinionated, so pages own the look.
  let {
    source,
    format = "markdown",
    class: className = "",
  }: { source: string; format?: ContentFormat; class?: string } = $props();
</script>

{#if format === "text"}
  <pre class={`whitespace-pre-wrap font-sans ${className}`}>{source}</pre>
{:else}
  <!-- sanitized by renderContent (scripts/handlers stripped) -->
  <div class={className}>{@html renderContent(source, format)}</div>
{/if}
