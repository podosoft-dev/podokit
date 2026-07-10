import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import sanitizeHtml from "sanitize-html";

// Markdown → HTML with highlight.js syntax highlighting.
const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

// DB/user content is untrusted, so the rendered HTML is sanitized: only the tags
// and attributes Markdown legitimately produces (plus highlighted code spans and
// images) survive; scripts, event handlers, and unknown schemes are stripped.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "span"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    span: ["class"],
    code: ["class"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
};

/** Render untrusted Markdown to sanitized HTML — safe to inject with `{@html}`. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source ?? "", { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
