function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

/** A deliberately small Markdown renderer. Input is escaped before formatting,
 * so preview and public rendering never trust author-supplied HTML. */
export function renderBlogMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inCode = false;
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      output.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      output.push(`${escapeHtml(line)}\n`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading?.[1] && heading[2]) {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item?.[1]) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
    if (line.trim()) output.push(`<p>${inline(line)}</p>`);
  }
  if (inList) output.push("</ul>");
  if (inCode) output.push("</code></pre>");
  return output.join("\n");
}
