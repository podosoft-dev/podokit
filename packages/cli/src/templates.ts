export interface TemplateInfo {
  name: string;
  description: string;
}

// Order matters: the first entry is the default and prompts list them in order.
export const TEMPLATES: TemplateInfo[] = [
  {
    name: "fullstack-nest-svelte",
    description: "NestJS + SvelteKit starter — TypeORM wired, Swagger, no domain code (clean)",
  },
  {
    name: "todo",
    description: "Fullstack starter plus a Todo CRUD example (DB entity, migration, UI)",
  },
  {
    name: "base",
    description: "Minimal npm workspace to build up from scratch",
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
