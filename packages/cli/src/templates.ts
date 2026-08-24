export interface TemplateInfo {
  name: string;
  description: string;
}

// Order matters: the first entry is the default and prompts list them in order.
export const TEMPLATES: TemplateInfo[] = [
  {
    name: "fullstack",
    description: "Bun + Elysia + SvelteKit starter — Bun.SQL, OpenAPI, no domain code",
  },
  {
    name: "todo",
    description: "Fullstack starter plus a Bun.SQL Todo CRUD example and UI",
  },
  {
    name: "base",
    description: "Minimal Bun workspace to build up from scratch",
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0]!.name;

export const TEMPLATE_NAMES: string[] = TEMPLATES.map((t) => t.name);

export function isKnownTemplate(name: string): boolean {
  return TEMPLATE_NAMES.includes(name);
}

/** Human-readable list of templates with descriptions, for prompts and help. */
export function templateListText(): string {
  const width = Math.max(...TEMPLATES.map((t) => t.name.length));
  return TEMPLATES.map((t) => {
    const suffix = t.name === DEFAULT_TEMPLATE ? " (default)" : "";
    return `  ${t.name.padEnd(width)}  ${t.description}${suffix}`;
  }).join("\n");
}
