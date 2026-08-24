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
  publishedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogComment {
  id: string;
  postId: string;
  authorId: string | null;
  author: string;
  authorImage: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogActor {
  id: string;
  name: string;
  image: string | null;
  admin: boolean;
}

export interface BlogPage {
  page: number;
  pageSize: number;
  tag?: string;
}

export interface CreateBlogPost {
  title: string;
  slug?: string;
  excerpt?: string;
  body: string;
  coverImage?: string | null;
  tags?: string[];
  status?: BlogPostStatus;
}

export type UpdateBlogPost = Partial<CreateBlogPost>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
