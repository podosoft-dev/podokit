export type Post = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  coverImage: string | null;
  author: string | null;
  tags: string[];
  status: "draft" | "published";
  metadata: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
};
