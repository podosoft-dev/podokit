<script lang="ts">
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { BlogEditor, blogClient, draftFromPost, type BlogDraft, type BlogEditorLabels } from "$lib/blog";
  import { getI18n } from "$lib/i18n";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const i18n = getI18n();
  let draft = $state(draftFromPost(untrack(() => data.post)));
  let saving = $state(false);
  const labels: BlogEditorLabels = {
    title: i18n.t.blog.postTitle, slug: i18n.t.blog.slug, excerpt: i18n.t.blog.excerpt,
    body: i18n.t.blog.body, coverImage: i18n.t.blog.coverImage, tags: i18n.t.blog.tags,
    status: i18n.t.blog.status, published: i18n.t.blog.published, draft: i18n.t.blog.draft,
    write: i18n.t.blog.write, preview: i18n.t.blog.preview, save: i18n.t.blog.save,
    cancel: i18n.t.blog.cancel, addImage: i18n.t.blog.addImage,
    uploadingImage: i18n.t.blog.uploadingImage, imageHelp: i18n.t.blog.imageHelp,
    imageUploadFailed: i18n.t.blog.imageUploadFailed,
  };

  async function save(value: BlogDraft): Promise<void> {
    saving = true;
    try {
      const post = await blogClient.updatePost(data.post.id, value);
      toast.success(i18n.t.blog.saved);
      await goto(`/blog/${post.slug}`);
    } catch {
      toast.error(i18n.t.blog.saveFailed);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{i18n.t.blog.editPost}</title><meta name="robots" content="noindex, nofollow" /></svelte:head>

<main class="mx-auto w-full max-w-4xl px-6 py-12">
  <h1 class="mb-8 text-3xl font-semibold tracking-tight">{i18n.t.blog.editPost}</h1>
  <BlogEditor bind:value={draft} {labels} submitting={saving} onsubmit={save} oncancel={() => goto(`/blog/${data.post.slug}`)} />
</main>
