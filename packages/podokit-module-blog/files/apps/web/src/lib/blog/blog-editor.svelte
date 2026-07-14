<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Textarea } from "$lib/components/ui/textarea";
  import BlogProse from "./blog-prose.svelte";
  import type { BlogDraft, BlogEditorLabels } from "./types";

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

  function updateTags(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    value.tags = input.value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await onsubmit(value);
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
        <Textarea id="blog-body" bind:value={value.body} required maxlength={200000} class="min-h-96 font-mono" />
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
