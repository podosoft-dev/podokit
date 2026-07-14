<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { blogClient, formatBlogDate, renderBlogMarkdown, type BlogComment } from "$lib/blog";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Textarea } from "$lib/components/ui/textarea";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  let commentBody = $state("");
  let savingComment = $state(false);
  let editingComment = $state<BlogComment | null>(null);
  let editBody = $state("");
  let deleteCommentTarget = $state<BlogComment | null>(null);
  let deletePostOpen = $state(false);

  const admin = $derived(data.user?.role === "admin");
  const ownsPost = $derived(Boolean(data.user && (admin || data.post.authorId === data.user.id)));

  function canManage(comment: BlogComment): boolean {
    return Boolean(data.user && (admin || comment.authorId === data.user.id));
  }

  async function addComment(): Promise<void> {
    if (!commentBody.trim()) return;
    savingComment = true;
    try {
      await blogClient.createComment(data.post.slug, commentBody.trim());
      commentBody = "";
      await invalidateAll();
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    } finally {
      savingComment = false;
    }
  }

  function beginEdit(comment: BlogComment): void {
    editingComment = comment;
    editBody = comment.body;
  }

  async function saveComment(): Promise<void> {
    if (!editingComment || !editBody.trim()) return;
    try {
      await blogClient.updateComment(editingComment.id, editBody.trim());
      editingComment = null;
      await invalidateAll();
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    }
  }

  async function removeComment(): Promise<void> {
    if (!deleteCommentTarget) return;
    try {
      await blogClient.deleteComment(deleteCommentTarget.id);
      deleteCommentTarget = null;
      await invalidateAll();
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    }
  }

  async function removePost(): Promise<void> {
    try {
      await blogClient.deletePost(data.post.id);
      toast.success(i18n.t.blog.deleted);
      await goto("/blog");
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    }
  }
</script>

<svelte:head><title>{data.post.title}</title><meta name="description" content={data.post.excerpt} /></svelte:head>

<main class="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
  <article>
    <header class="border-b pb-8">
      <div class="text-muted-foreground mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span>{formatBlogDate(data.post.publishedAt, i18n.locale)}</span><span>{data.post.author}</span>
      </div>
      <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">{data.post.title}</h1>
      {#if data.post.excerpt}<p class="text-muted-foreground mt-5 text-lg leading-8">{data.post.excerpt}</p>{/if}
      {#if data.post.tags.length}
        <div class="mt-5 flex flex-wrap gap-2">{#each data.post.tags as tag (tag)}<Badge variant="secondary">{tag}</Badge>{/each}</div>
      {/if}
      {#if ownsPost}
        <div class="mt-6 flex gap-2">
          <Button variant="outline" href="/blog/{data.post.slug}/edit">{i18n.t.blog.edit}</Button>
          <Button variant="destructive" onclick={() => (deletePostOpen = true)}>{i18n.t.blog.delete}</Button>
        </div>
      {/if}
    </header>
    <div class="blog-prose py-10">{@html renderBlogMarkdown(data.post.body)}</div>
  </article>

  <section class="border-t pt-10" aria-labelledby="comments-heading">
    <h2 id="comments-heading" class="text-2xl font-semibold">{i18n.t.blog.comments}</h2>
    {#if data.user}
      <div class="mt-6 space-y-3">
        <Textarea bind:value={commentBody} maxlength={2000} placeholder={i18n.t.blog.commentPlaceholder} />
        <div class="flex justify-end"><Button onclick={addComment} disabled={savingComment || !commentBody.trim()}>{i18n.t.blog.save}</Button></div>
      </div>
    {:else}
      <div class="bg-muted mt-6 flex items-center justify-between gap-4 rounded-lg p-4">
        <p class="text-muted-foreground text-sm">{i18n.t.blog.signInToWrite}</p>
        <Button href={`/login?redirect=/blog/${data.post.slug}`} variant="outline">{i18n.t.auth.signIn}</Button>
      </div>
    {/if}

    {#if data.comments.items.length === 0}
      <p class="text-muted-foreground py-10">{i18n.t.blog.noComments}</p>
    {:else}
      <ul class="mt-8 divide-y">
        {#each data.comments.items as comment (comment.id)}
          <li class="flex gap-4 py-6">
            <Avatar.Root class="size-9 shrink-0">
              {#if comment.authorImage}<Avatar.Image src={comment.authorImage} alt="" />{/if}
              <Avatar.Fallback>{comment.author.slice(0, 1).toUpperCase()}</Avatar.Fallback>
            </Avatar.Root>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div><span class="font-medium">{comment.author}</span><span class="text-muted-foreground ml-2 text-xs">{formatBlogDate(comment.createdAt, i18n.locale)}</span></div>
                {#if canManage(comment)}
                  <div class="flex gap-1">
                    <Button size="sm" variant="ghost" onclick={() => beginEdit(comment)}>{i18n.t.blog.edit}</Button>
                    <Button size="sm" variant="ghost" class="text-destructive" onclick={() => (deleteCommentTarget = comment)}>{i18n.t.blog.delete}</Button>
                  </div>
                {/if}
              </div>
              {#if editingComment?.id === comment.id}
                <div class="mt-3 space-y-2">
                  <Textarea bind:value={editBody} maxlength={2000} />
                  <div class="flex justify-end gap-2"><Button size="sm" variant="outline" onclick={() => (editingComment = null)}>{i18n.t.blog.cancel}</Button><Button size="sm" onclick={saveComment}>{i18n.t.blog.save}</Button></div>
                </div>
              {:else}
                <p class="mt-2 whitespace-pre-wrap leading-7">{comment.body}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if data.comments.totalPages > 1}
      <nav class="mt-6 flex items-center justify-between border-t pt-5" aria-label={i18n.t.blog.comments}>
        <Button variant="outline" href={`?commentPage=${data.comments.page - 1}`} disabled={data.comments.page <= 1}>{i18n.t.blog.previous}</Button>
        <span class="text-muted-foreground text-sm">{data.comments.page} / {data.comments.totalPages}</span>
        <Button variant="outline" href={`?commentPage=${data.comments.page + 1}`} disabled={data.comments.page >= data.comments.totalPages}>{i18n.t.blog.next}</Button>
      </nav>
    {/if}
  </section>
</main>

<Dialog.Root bind:open={deletePostOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header><Dialog.Title>{i18n.t.blog.deletePostTitle}</Dialog.Title><Dialog.Description>{i18n.t.blog.deleteDescription}</Dialog.Description></Dialog.Header>
    <Dialog.Footer><Button variant="outline" onclick={() => (deletePostOpen = false)}>{i18n.t.blog.cancel}</Button><Button variant="destructive" onclick={removePost}>{i18n.t.blog.delete}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={deleteCommentTarget !== null} onOpenChange={(open) => { if (!open) deleteCommentTarget = null; }}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header><Dialog.Title>{i18n.t.blog.deleteCommentTitle}</Dialog.Title><Dialog.Description>{i18n.t.blog.deleteDescription}</Dialog.Description></Dialog.Header>
    <Dialog.Footer><Button variant="outline" onclick={() => (deleteCommentTarget = null)}>{i18n.t.blog.cancel}</Button><Button variant="destructive" onclick={removeComment}>{i18n.t.blog.delete}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .blog-prose :global(h1), .blog-prose :global(h2), .blog-prose :global(h3) { margin-top: 2rem; margin-bottom: 0.75rem; font-weight: 600; letter-spacing: -0.02em; }
  .blog-prose :global(h1) { font-size: 1.875rem; }
  .blog-prose :global(h2) { font-size: 1.5rem; }
  .blog-prose :global(h3) { font-size: 1.25rem; }
  .blog-prose :global(p), .blog-prose :global(li) { line-height: 1.8; }
  .blog-prose :global(p) { margin: 1rem 0; }
  .blog-prose :global(ul) { margin: 1rem 0; list-style: disc; padding-left: 1.5rem; }
  .blog-prose :global(pre) { overflow-x: auto; border-radius: 0.5rem; background: var(--muted); padding: 1rem; }
  .blog-prose :global(code) { font-family: ui-monospace, monospace; }
  .blog-prose :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
</style>
