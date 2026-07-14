<script lang="ts">
  import { cn } from "$lib/utils";
  import type { HTMLAttributes } from "svelte/elements";
  import { renderBlogMarkdown } from "./markdown";

  interface Props extends HTMLAttributes<HTMLDivElement> {
    markdown: string;
    title?: string;
  }

  let { markdown, title = "", class: className, ...rest }: Props = $props();
  const html = $derived(renderBlogMarkdown(markdown, title));
</script>

<!-- The renderer escapes author HTML before this trusted output is inserted. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div data-blog-prose class={cn("blog-prose", className)} {...rest}>{@html html}</div>

<style>
  .blog-prose { min-width: 0; color: var(--foreground); }
  .blog-prose :global(h1),
  .blog-prose :global(h2),
  .blog-prose :global(h3),
  .blog-prose :global(h4),
  .blog-prose :global(h5),
  .blog-prose :global(h6) { font-weight: 600; letter-spacing: -0.02em; }
  .blog-prose :global(h1) { margin: 1.75rem 0 0.75rem; font-size: 1.5rem; }
  .blog-prose :global(h2) { margin: 1.5rem 0 0.5rem; font-size: 1.25rem; }
  .blog-prose :global(h3) { margin: 1.25rem 0 0.5rem; font-size: 1.1rem; }
  .blog-prose :global(h4),
  .blog-prose :global(h5),
  .blog-prose :global(h6) { margin: 1rem 0 0.5rem; }
  .blog-prose :global(h1:first-child),
  .blog-prose :global(h2:first-child),
  .blog-prose :global(h3:first-child) { margin-top: 0; }
  .blog-prose :global(p) { margin: 0.75rem 0; line-height: 1.75; }
  .blog-prose :global(ul),
  .blog-prose :global(ol) { margin: 0.75rem 0; padding-left: 1.5rem; }
  .blog-prose :global(ul) { list-style: disc; }
  .blog-prose :global(ol) { list-style: decimal; }
  .blog-prose :global(li) { margin: 0.25rem 0; line-height: 1.7; }
  .blog-prose :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
  .blog-prose :global(strong) { font-weight: 600; }
  .blog-prose :global(blockquote) { margin: 1rem 0; border-left: 3px solid var(--border); padding-left: 1rem; color: var(--muted-foreground); }
  .blog-prose :global(pre) { margin: 1rem 0; overflow-x: auto; border-radius: calc(var(--radius) - 2px); background: var(--muted); padding: 1rem; }
  .blog-prose :global(code) { font-family: ui-monospace, monospace; font-size: 0.9em; }
  .blog-prose :global(:not(pre) > code) { border-radius: 0.25rem; background: var(--muted); padding: 0.125rem 0.3rem; }
  .blog-prose :global(table) { margin: 1rem 0; width: 100%; border-collapse: collapse; }
  .blog-prose :global(th),
  .blog-prose :global(td) { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
  .blog-prose :global(th) { background: var(--muted); font-weight: 600; }
  .blog-prose :global(hr) { margin: 1.5rem 0; border-color: var(--border); }
  .blog-prose :global(img) { margin: 1rem 0; height: auto; max-width: 100%; border-radius: calc(var(--radius) - 2px); }
  .blog-prose :global(input[type="checkbox"]) { margin-right: 0.4rem; }
</style>
