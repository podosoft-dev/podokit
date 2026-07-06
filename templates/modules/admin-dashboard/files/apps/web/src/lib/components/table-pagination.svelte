<script lang="ts">
  import * as Pagination from "$lib/components/ui/pagination";

  // Shared table footer: a count label plus shadcn-svelte pagination that appears
  // only when the list spans more than one page. Bind `page` (1-based). For
  // server-side lists pass `onPageChange` to refetch; client-side lists just bind.
  type Props = {
    count: number;
    perPage?: number;
    page?: number;
    label?: string;
    onPageChange?: (page: number) => void;
  };
  let { count, perPage = 5, page = $bindable(1), label, onPageChange }: Props = $props();
</script>

<div class="flex items-center justify-between gap-2">
  {#if label}
    <span class="text-muted-foreground shrink-0 text-sm whitespace-nowrap">{label}</span>
  {/if}
  {#if count > perPage}
    <Pagination.Root {count} {perPage} bind:page {onPageChange}>
      {#snippet children({ pages, currentPage })}
        <Pagination.Content>
          <Pagination.Item><Pagination.PrevButton /></Pagination.Item>
          {#each pages as p (p.key)}
            {#if p.type === "ellipsis"}
              <Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
            {:else}
              <Pagination.Item>
                <Pagination.Link page={p} isActive={currentPage === p.value}>{p.value}</Pagination.Link>
              </Pagination.Item>
            {/if}
          {/each}
          <Pagination.Item><Pagination.NextButton /></Pagination.Item>
        </Pagination.Content>
      {/snippet}
    </Pagination.Root>
  {/if}
</div>
