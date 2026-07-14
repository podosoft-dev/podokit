# Blog preview does not match the published article

## Summary
The blog editor preview and the public article use different Markdown markup and
styles. Common Markdown such as blockquotes, ordered lists, and tables appears as
plain paragraphs in preview, then changes structure after publishing.

## Environment
- PodoKit / CLI version: `@podosoft/podokit` 0.9.0, local source build
- Template: `fullstack-nest-svelte`
- Modules added: `auth`, `admin-dashboard`, `blog`
- Run mode: containerized `compose.dev.yaml` with a local Traefik port override
- OS / Node / package manager: macOS 26.5.1 / Node 25.8.1 / npm 11.17.0

## Steps to reproduce
1. Create a `fullstack-nest-svelte` application and add `auth`, `admin-dashboard`, and the external `blog` module.
2. Sign in and open `/blog/write`.
3. Enter a title and a body containing a matching leading H1, blockquote, ordered list, and GFM table.
4. Open the **Preview** tab and then publish the post.
5. Compare the preview body with the public article body.

## Expected
The preview and published article should use the same safe Markdown renderer and
the same prose presentation. A leading H1 that duplicates the post title should
be handled consistently.

## Actual
The preview renders only headings, paragraphs, unordered lists, fenced code, and
a few inline constructs. Blockquotes, ordered lists, and table source are shown as
plain paragraphs. The application-owned public route can use a full GFM renderer,
so the published output changes structure. The default module route also applies a
different prose stylesheet from the editor preview.

## Evidence
With a body containing a blockquote, ordered list, and table, the browser
accessibility snapshot showed the preview as seven ordinary paragraphs. After
publishing the same body, the snapshot showed one `blockquote`, one ordered
`list`, and one `table`. The duplicated leading H1 was visible in preview but
removed by the public application route.

## Suspected root cause / suggested fix (optional)
`packages/podokit-module-blog/files/apps/web/src/lib/blog/blog-editor.svelte`
uses its own `prose` wrapper and the deliberately small renderer in
`markdown.ts`, while the public route owns separate markup and styles. Provide a
managed reusable prose component backed by one safe GFM renderer, use it in the
editor and default public route, and let application-owned routes consume the
same component.
