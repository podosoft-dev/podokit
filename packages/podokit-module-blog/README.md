# @podosoft/podokit-module-blog

Authenticated publishing, flat comments, pagination, and admin management for a
PodoKit application. Backend and reusable web logic remain PodoKit-managed;
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

Posts created by regular users are published immediately. Authors can edit and
delete their own posts and comments; admins can manage all content. Deleting a
user keeps their content with its author snapshot, while deleting a post also
deletes its comments.

`BlogEditor` and `BlogProse` share the same safe GFM renderer, so blockquotes,
ordered lists, tables, and other supported Markdown have the same markup and
presentation before and after publishing. Application-owned article routes should
render the body with `BlogProse`, passing both `markdown` and the post `title`.
