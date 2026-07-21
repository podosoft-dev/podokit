# @podosoft/podokit-module-blog

Authenticated publishing, Markdown image uploads, flat comments, pagination,
and admin management for a PodoKit application. Backend and reusable web logic remain PodoKit-managed;
route wrappers are app-owned so each site can supply its own visual design and
SEO policy.

## Install

```bash
npm install --save-dev @podosoft/podokit-module-blog
podo add blog
npm install
npm run migration:run -w <app>-api
```

When adopting an existing blog whose backend paths are currently app-owned, use
`podo add blog --adopt`. Review `podo diff` before applying later module updates.

## Update

```bash
npm update @podosoft/podokit-module-blog
podo update
podo update --apply
```

Route wrappers remain application-owned and are not overwritten by `podo
update`. When upgrading from 0.3.x to 0.4.x, update each owned `BlogEditor`
wrapper to pass `showPost`, `showPostHelp`, `uploadCover`, and `removeCover` in
its `BlogEditorLabels`. Remove the former `admin` prop from the admin wrapper.
The corresponding strings arrive in the managed blog catalog. The current seed
also adds `routes/blog/+layout.svelte`, which renders the shared `AccountMenu` in
the top-right corner. Existing customized blog layouts should place the same
managed component in their site header instead of duplicating its menu logic.

Posts start as drafts for every authenticated author. The **Show post** switch
includes a post in public lists and detail pages; turning it off hides the post
without changing its first publication time or list position. Authors can find
both drafts and published posts under `/blog/mine`, edit or delete their own
posts and comments, and admins can manage all content. Deleting a user keeps
their content with its author snapshot, while deleting a post also deletes its
comments.

`BlogEditor` and `BlogProse` share the same safe GFM renderer, so blockquotes,
ordered lists, tables, and other supported Markdown have the same markup and
presentation before and after publishing. Application-owned article routes should
render the body with `BlogProse`, passing both `markdown` and the post `title`.

Signed-in authors can select **Add image** in `BlogEditor`. PNG, JPEG, GIF, WebP,
and AVIF files up to 5 MB are stored in object storage and inserted at the current
cursor as Markdown. Blog images use the stable public path `/api/blog/images/:id`;
they do not use expiring presigned URLs. SVG uploads are intentionally unsupported.
The same upload flow supports a cover image, with an immediate editor preview.
