// One item of a config-driven content collection. `metadata` holds
// project-specific fields (extend without a migration); managed components
// ignore unknown keys and owned pages read `item.metadata.*`.
export type CollectionItem = {
  id: string;
  collection: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  bodyFormat: "text" | "markdown" | "html";
  icon: string | null;
  image: string | null;
  color: string | null;
  category: string | null;
  order: number;
  status: "draft" | "published";
  metadata: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
};
