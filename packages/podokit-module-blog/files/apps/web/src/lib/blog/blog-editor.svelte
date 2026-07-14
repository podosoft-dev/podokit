<script lang="ts">
  import ImagePlus from "@lucide/svelte/icons/image-plus";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Textarea } from "$lib/components/ui/textarea";
  import BlogProse from "./blog-prose.svelte";
  import * as blogClient from "./blog-client";
  import type { BlogDraft, BlogEditorLabels } from "./types";
  import { tick } from "svelte";

  interface Props {
    value: BlogDraft;
    labels: BlogEditorLabels;
    admin?: boolean;
    submitting?: boolean;
    onsubmit: (draft: BlogDraft) => void | Promise<void>;
    oncancel?: () => void;
  }

  let {
    value = $bindable(),
    labels,
    admin = false,
    submitting = false,
    onsubmit,
    oncancel,
  }: Props = $props();
  let editorTab = $state("write");
  let bodyRef = $state<HTMLTextAreaElement | null>(null);
  let imageInputRef = $state<HTMLInputElement | null>(null);
  let uploadingImage = $state(false);
  let imageError = $state("");

  function updateTags(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    value.tags = input.value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await onsubmit(value);
  }

  function imageAlt(file: File): string {
    return file.name
      .replace(/\.[^.]+$/, "")
      .replaceAll("\\", " ")
      .replaceAll("[", " ")
      .replaceAll("]", " ")
      .replace(/\s+/g, " ")
      .trim() || "Image";
  }

  async function insertImage(file: File, url: string): Promise<void> {
    const start = bodyRef?.selectionStart ?? value.body.length;
    const end = bodyRef?.selectionEnd ?? start;
    const before = value.body.slice(0, start);
    const after = value.body.slice(end);
    const leading = before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n") ? "\n" : "\n\n";
    const trailing = after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n") ? "\n" : "\n\n";
    const markdown = `![${imageAlt(file)}](${url})`;
    value.body = `${before}${leading}${markdown}${trailing}${after}`;
    const cursor = before.length + leading.length + markdown.length;
    await tick();
    bodyRef?.focus();
    bodyRef?.setSelectionRange(cursor, cursor);
  }

  async function uploadImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadingImage = true;
    imageError = "";
    try {
      const uploaded = await blogClient.uploadImage(file);
      await insertImage(file, uploaded.url);
    } catch {
      imageError = labels.imageUploadFailed;
    } finally {
      uploadingImage = false;
      input.value = "";
    }
  }
</script>

<form class="space-y-6" onsubmit={submit}>
  <div class="grid gap-5 sm:grid-cols-2">
    <div class="space-y-2 sm:col-span-2">
      <Label for="blog-title">{labels.title}</Label>
      <Input id="blog-title" bind:value={value.title} required maxlength={300} />
    </div>
    <div class="space-y-2">
      <Label for="blog-slug">{labels.slug}</Label>
      <Input id="blog-slug" bind:value={value.slug} maxlength={300} />
    </div>
    <div class="space-y-2">
      <Label for="blog-tags">{labels.tags}</Label>
      <Input id="blog-tags" value={value.tags.join(", ")} oninput={updateTags} />
    </div>
    <div class="space-y-2 sm:col-span-2">
      <Label for="blog-excerpt">{labels.excerpt}</Label>
      <Textarea id="blog-excerpt" bind:value={value.excerpt} maxlength={1000} class="min-h-20" />
    </div>
    <div class="space-y-2 sm:col-span-2">
      <Label for="blog-cover">{labels.coverImage}</Label>
      <Input id="blog-cover" type="url" bind:value={value.coverImage} maxlength={1000} />
    </div>
    {#if admin}
      <div class="space-y-2">
        <Label for="blog-status">{labels.status}</Label>
        <Select.Root type="single" bind:value={value.status}>
          <Select.Trigger id="blog-status" class="w-full">
            {value.status === "published" ? labels.published : labels.draft}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="draft">{labels.draft}</Select.Item>
            <Select.Item value="published">{labels.published}</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
    {/if}
  </div>

  <div class="space-y-2">
    <Label for="blog-body">{labels.body}</Label>
    <Tabs.Root value={editorTab} onValueChange={(value) => (editorTab = value)}>
      <Tabs.List>
        <Tabs.Trigger value="write">{labels.write}</Tabs.Trigger>
        <Tabs.Trigger value="preview">{labels.preview}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="write" class="mt-3">
        <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Input
            id="blog-image"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            class="sr-only"
            bind:ref={imageInputRef}
            onchange={uploadImage}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploadingImage}
            onclick={() => imageInputRef?.click()}
          >
            <ImagePlus class="size-4" aria-hidden="true" />
            {uploadingImage ? labels.uploadingImage : labels.addImage}
          </Button>
          <p class="text-muted-foreground text-xs">{labels.imageHelp}</p>
        </div>
        {#if imageError}
          <p class="text-destructive mb-2 text-sm" role="alert">{imageError}</p>
        {/if}
        <Textarea
          id="blog-body"
          bind:ref={bodyRef}
          bind:value={value.body}
          required
          maxlength={200000}
          class="min-h-96 font-mono"
        />
      </Tabs.Content>
      <Tabs.Content value="preview" data-blog-preview class="mt-3 min-h-96 rounded-lg border p-5">
        <BlogProse markdown={value.body} title={value.title} />
      </Tabs.Content>
    </Tabs.Root>
  </div>

  <div class="flex justify-end gap-2">
    {#if oncancel}
      <Button type="button" variant="outline" onclick={oncancel}>{labels.cancel}</Button>
    {/if}
    <Button type="submit" disabled={submitting}>{labels.save}</Button>
  </div>
</form>
