export type BlogPostStatus = "draft" | "published";

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverImage: string | null;
  authorId: string | null;
  author: string;
  authorImage: string | null;
  tags: string[];
  status: BlogPostStatus;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BlogComment {
  id: string;
  postId: string;
  authorId: string | null;
  author: string;
  authorImage: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverImage: string;
  tags: string[];
  status?: BlogPostStatus;
}

export interface BlogEditorLabels {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverImage: string;
  tags: string;
  status: string;
  published: string;
  draft: string;
  write: string;
  preview: string;
  save: string;
  cancel: string;
  addImage: string;
  uploadingImage: string;
  imageHelp: string;
  imageUploadFailed: string;
}

export interface BlogImageUpload {
  id: string;
  url: string;
}

export function emptyBlogDraft(): BlogDraft {
  return {
    title: "",
    slug: "",
    excerpt: "",
    body: "",
    coverImage: "",
    tags: [],
  };
}

export function draftFromPost(post: BlogPost): BlogDraft {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    coverImage: post.coverImage ?? "",
    tags: post.tags,
    status: post.status,
  };
}

export function formatBlogDate(value: string | null, locale = "en"): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}
