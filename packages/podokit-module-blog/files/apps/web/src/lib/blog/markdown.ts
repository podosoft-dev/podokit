import { Marked } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const markdown = new Marked({
  async: false,
  breaks: true,
  gfm: true,
  renderer: {
    // Author HTML is displayed as text. Markdown-generated elements remain
    // available without allowing scripts or arbitrary attributes through.
    html({ text }): string {
      return escapeHtml(text);
    },
  },
});

/** Remove a leading Markdown H1 only when it repeats the post title. Public
 * article headers own the title, and the editor preview follows the same rule. */
export function blogBodyMarkdown(value: string, title = ""): string {
  const source = value.replace(/\r\n/g, "\n");
  const leadingHeading = source.match(/^#\s+(.+?)[ \t]*\n+/);
  if (!leadingHeading || leadingHeading[1]?.trim() !== title.trim()) return source;
  return source.slice(leadingHeading[0].length);
}

/** Render untrusted blog Markdown as safe GFM HTML in both SSR and the browser. */
export function renderBlogMarkdown(value: string, title = ""): string {
  const rendered = markdown.parse(blogBodyMarkdown(value, title)) as string;
  return rendered.replace(/<a href=/g, '<a rel="noopener noreferrer" href=');
}
