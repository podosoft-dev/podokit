import type { SQL } from "bun";
import { AppException } from "../common/app-exception";
import type {
  BlogActor,
  BlogComment,
  BlogPage,
  BlogPost,
  BlogPostStatus,
  CreateBlogPost,
  Paginated,
  UpdateBlogPost,
} from "./blog.types";

interface CountRow {
  total: number;
}

export class BlogService {
  constructor(private readonly sql: SQL) {}

  async listPublished(query: BlogPage): Promise<Paginated<BlogPost>> {
    const offset = (query.page - 1) * query.pageSize;
    const tag = query.tag?.trim() || null;
    const items = await this.sql<BlogPost[]>`
      SELECT * FROM "blog_posts"
      WHERE "status" = 'published'
        AND (${tag}::text IS NULL OR "tags" ? ${tag})
      ORDER BY "publishedAt" DESC, "createdAt" DESC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;
    const [count] = await this.sql<CountRow[]>`
      SELECT COUNT(*)::int AS "total" FROM "blog_posts"
      WHERE "status" = 'published'
        AND (${tag}::text IS NULL OR "tags" ? ${tag})
    `;
    return this.page(items, query.page, query.pageSize, count?.total ?? 0);
  }

  async listAll(query: BlogPage): Promise<Paginated<BlogPost>> {
    return this.listPosts(query, null);
  }

  async listMine(query: BlogPage, actor: BlogActor): Promise<Paginated<BlogPost>> {
    return this.listPosts(query, actor.id);
  }

  async getPublishedBySlug(slug: string): Promise<BlogPost> {
    const [post] = await this.sql<BlogPost[]>`
      SELECT * FROM "blog_posts" WHERE "slug" = ${slug} AND "status" = 'published' LIMIT 1
    `;
    if (!post) throw new AppException("BLOG_POST_NOT_FOUND", "Blog post not found.", 404);
    return post;
  }

  async getById(id: string): Promise<BlogPost> {
    const [post] = await this.sql<BlogPost[]>`
      SELECT * FROM "blog_posts" WHERE "id" = ${id} LIMIT 1
    `;
    if (!post) throw new AppException("BLOG_POST_NOT_FOUND", "Blog post not found.", 404);
    return post;
  }

  async getManageableBySlug(slug: string, actor: BlogActor): Promise<BlogPost> {
    const [post] = await this.sql<BlogPost[]>`
      SELECT * FROM "blog_posts" WHERE "slug" = ${slug} LIMIT 1
    `;
    if (!post) throw new AppException("BLOG_POST_NOT_FOUND", "Blog post not found.", 404);
    this.assertOwner(post.authorId, actor, "BLOG_POST_FORBIDDEN");
    return post;
  }

  async create(dto: CreateBlogPost, actor: BlogActor): Promise<BlogPost> {
    const slug = await this.availableSlug(dto.slug || dto.title);
    const status = dto.status ?? "draft";
    const excerpt = dto.excerpt?.trim() ?? "";
    const tags = JSON.stringify(this.cleanTags(dto.tags ?? []));
    const [post] = await this.sql<BlogPost[]>`
      INSERT INTO "blog_posts" (
        "title", "slug", "excerpt", "body", "coverImage", "authorId",
        "author", "authorImage", "tags", "status", "publishedAt"
      ) VALUES (
        ${dto.title.trim()}, ${slug}, ${excerpt}, ${dto.body.trim()},
        ${dto.coverImage ?? null}, ${actor.id}, ${actor.name}, ${actor.image},
        ${tags}::jsonb, ${status}, ${status === "published" ? new Date() : null}
      ) RETURNING *
    `;
    if (!post) throw new Error("Blog post insert returned no row");
    return post;
  }

  adminCreate(dto: CreateBlogPost, actor: BlogActor): Promise<BlogPost> {
    return this.create(dto, actor);
  }

  async update(id: string, dto: UpdateBlogPost, actor: BlogActor): Promise<BlogPost> {
    const post = await this.getById(id);
    this.assertOwner(post.authorId, actor, "BLOG_POST_FORBIDDEN");
    return this.savePost(post, dto);
  }

  async adminUpdate(id: string, dto: UpdateBlogPost): Promise<BlogPost> {
    return this.savePost(await this.getById(id), dto);
  }

  async remove(id: string, actor: BlogActor): Promise<void> {
    const post = await this.getById(id);
    this.assertOwner(post.authorId, actor, "BLOG_POST_FORBIDDEN");
    await this.sql`DELETE FROM "blog_posts" WHERE "id" = ${id}`;
  }

  async adminRemove(id: string): Promise<void> {
    await this.getById(id);
    await this.sql`DELETE FROM "blog_posts" WHERE "id" = ${id}`;
  }

  async listComments(slug: string, query: BlogPage): Promise<Paginated<BlogComment>> {
    const post = await this.getPublishedBySlug(slug);
    const offset = (query.page - 1) * query.pageSize;
    const items = await this.sql<BlogComment[]>`
      SELECT * FROM "blog_comments" WHERE "postId" = ${post.id}
      ORDER BY "createdAt" ASC LIMIT ${query.pageSize} OFFSET ${offset}
    `;
    const [count] = await this.sql<CountRow[]>`
      SELECT COUNT(*)::int AS "total" FROM "blog_comments" WHERE "postId" = ${post.id}
    `;
    return this.page(items, query.page, query.pageSize, count?.total ?? 0);
  }

  async addComment(slug: string, body: string, actor: BlogActor): Promise<BlogComment> {
    const post = await this.getPublishedBySlug(slug);
    const [comment] = await this.sql<BlogComment[]>`
      INSERT INTO "blog_comments" ("postId", "authorId", "author", "authorImage", "body")
      VALUES (${post.id}, ${actor.id}, ${actor.name}, ${actor.image}, ${body.trim()})
      RETURNING *
    `;
    if (!comment) throw new Error("Blog comment insert returned no row");
    return comment;
  }

  async updateComment(id: string, body: string, actor: BlogActor): Promise<BlogComment> {
    const comment = await this.getComment(id);
    this.assertOwner(comment.authorId, actor, "BLOG_COMMENT_FORBIDDEN");
    const [updated] = await this.sql<BlogComment[]>`
      UPDATE "blog_comments" SET "body" = ${body.trim()}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} RETURNING *
    `;
    if (!updated) throw new Error("Blog comment update returned no row");
    return updated;
  }

  async removeComment(id: string, actor: BlogActor): Promise<void> {
    const comment = await this.getComment(id);
    this.assertOwner(comment.authorId, actor, "BLOG_COMMENT_FORBIDDEN");
    await this.sql`DELETE FROM "blog_comments" WHERE "id" = ${id}`;
  }

  private async listPosts(query: BlogPage, authorId: string | null): Promise<Paginated<BlogPost>> {
    const offset = (query.page - 1) * query.pageSize;
    const items = authorId === null
      ? await this.sql<BlogPost[]>`
          SELECT * FROM "blog_posts" ORDER BY "createdAt" DESC
          LIMIT ${query.pageSize} OFFSET ${offset}
        `
      : await this.sql<BlogPost[]>`
          SELECT * FROM "blog_posts" WHERE "authorId" = ${authorId}
          ORDER BY "updatedAt" DESC LIMIT ${query.pageSize} OFFSET ${offset}
        `;
    const [count] = authorId === null
      ? await this.sql<CountRow[]>`SELECT COUNT(*)::int AS "total" FROM "blog_posts"`
      : await this.sql<CountRow[]>`
          SELECT COUNT(*)::int AS "total" FROM "blog_posts" WHERE "authorId" = ${authorId}
        `;
    return this.page(items, query.page, query.pageSize, count?.total ?? 0);
  }

  private async savePost(post: BlogPost, dto: UpdateBlogPost): Promise<BlogPost> {
    const slug = dto.slug !== undefined && dto.slug !== post.slug
      ? await this.availableSlug(dto.slug, post.id)
      : post.slug;
    const status: BlogPostStatus = dto.status ?? post.status;
    const tags = JSON.stringify(dto.tags === undefined ? post.tags : this.cleanTags(dto.tags));
    const [updated] = await this.sql<BlogPost[]>`
      UPDATE "blog_posts" SET
        "title" = ${dto.title?.trim() ?? post.title},
        "slug" = ${slug},
        "excerpt" = ${dto.excerpt?.trim() ?? post.excerpt},
        "body" = ${dto.body?.trim() ?? post.body},
        "coverImage" = ${dto.coverImage === undefined ? post.coverImage : dto.coverImage},
        "tags" = ${tags}::jsonb,
        "status" = ${status},
        "publishedAt" = CASE
          WHEN ${status} = 'published' AND "publishedAt" IS NULL THEN CURRENT_TIMESTAMP
          ELSE "publishedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${post.id}
      RETURNING *
    `;
    if (!updated) throw new Error("Blog post update returned no row");
    return updated;
  }

  private async getComment(id: string): Promise<BlogComment> {
    const [comment] = await this.sql<BlogComment[]>`
      SELECT * FROM "blog_comments" WHERE "id" = ${id} LIMIT 1
    `;
    if (!comment) throw new AppException("BLOG_COMMENT_NOT_FOUND", "Blog comment not found.", 404);
    return comment;
  }

  private assertOwner(authorId: string | null, actor: BlogActor, code: string): void {
    if (!actor.admin && (!authorId || authorId !== actor.id)) {
      throw new AppException(code, "You cannot modify this content.", 403);
    }
  }

  private cleanTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  }

  private async availableSlug(value: string, excludeId?: string): Promise<string> {
    const normalized = value
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 260) || `post-${Date.now()}`;
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const slug = suffix === 1 ? normalized : `${normalized}-${suffix}`;
      const [existing] = await this.sql<Array<{ id: string }>>`
        SELECT "id" FROM "blog_posts" WHERE "slug" = ${slug} LIMIT 1
      `;
      if (!existing || existing.id === excludeId) return slug;
    }
    throw new AppException("BLOG_SLUG_CONFLICT", "Could not create a unique blog URL.", 409);
  }

  private page<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }
}
