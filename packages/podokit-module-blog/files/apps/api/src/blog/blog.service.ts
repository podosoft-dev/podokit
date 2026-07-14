import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { AppException } from "../common/app-exception";
import { Repository } from "typeorm";
import { BlogComment } from "./blog-comment.entity";
import { BlogPost } from "./blog-post.entity";
import type { AdminCreateBlogPostDto, AdminUpdateBlogPostDto } from "./dto/admin-blog-post.dto";
import type { BlogCommentDto } from "./dto/blog-comment.dto";
import type { BlogPageDto, CommentPageDto } from "./dto/blog-page.dto";
import type { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import type { UpdateBlogPostDto } from "./dto/update-blog-post.dto";

export interface BlogActor {
  id: string;
  name: string;
  image: string | null;
  admin: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class BlogService {
  constructor(
    @InjectRepository(BlogPost)
    private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogComment)
    private readonly comments: Repository<BlogComment>,
  ) {}

  async listPublished(query: BlogPageDto): Promise<Paginated<BlogPost>> {
    const builder = this.posts
      .createQueryBuilder("post")
      .where("post.status = :status", { status: "published" })
      .orderBy("post.publishedAt", "DESC")
      .addOrderBy("post.createdAt", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    if (query.tag) builder.andWhere("post.tags ? :tag", { tag: query.tag });
    const [items, total] = await builder.getManyAndCount();
    return this.page(items, query.page, query.pageSize, total);
  }

  async listAll(query: BlogPageDto): Promise<Paginated<BlogPost>> {
    const [items, total] = await this.posts.findAndCount({
      order: { createdAt: "DESC" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return this.page(items, query.page, query.pageSize, total);
  }

  async getPublishedBySlug(slug: string): Promise<BlogPost> {
    const post = await this.posts.findOne({ where: { slug, status: "published" } });
    if (!post) throw new AppException("BLOG_POST_NOT_FOUND", "Blog post not found.", 404);
    return post;
  }

  async getById(id: string): Promise<BlogPost> {
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new AppException("BLOG_POST_NOT_FOUND", "Blog post not found.", 404);
    return post;
  }

  async create(dto: CreateBlogPostDto, actor: BlogActor): Promise<BlogPost> {
    const slug = await this.availableSlug(dto.slug || dto.title);
    return this.posts.save(
      this.posts.create({
        ...dto,
        slug,
        excerpt: dto.excerpt.trim(),
        body: dto.body.trim(),
        tags: this.cleanTags(dto.tags),
        authorId: actor.id,
        author: actor.name,
        authorImage: actor.image,
        status: "published",
        publishedAt: new Date(),
      }),
    );
  }

  async adminCreate(dto: AdminCreateBlogPostDto, actor: BlogActor): Promise<BlogPost> {
    const slug = await this.availableSlug(dto.slug || dto.title);
    return this.posts.save(
      this.posts.create({
        ...dto,
        slug,
        excerpt: dto.excerpt.trim(),
        body: dto.body.trim(),
        tags: this.cleanTags(dto.tags),
        authorId: actor.id,
        author: actor.name,
        authorImage: actor.image,
        publishedAt: dto.status === "published" ? new Date() : null,
      }),
    );
  }

  async update(id: string, dto: UpdateBlogPostDto, actor: BlogActor): Promise<BlogPost> {
    const post = await this.getById(id);
    this.assertOwner(post.authorId, actor, "BLOG_POST_FORBIDDEN");
    return this.savePost(post, dto);
  }

  async adminUpdate(id: string, dto: AdminUpdateBlogPostDto): Promise<BlogPost> {
    const post = await this.getById(id);
    const wasPublished = post.status === "published";
    if (dto.status !== undefined) post.status = dto.status;
    const saved = await this.savePost(post, dto);
    if (!wasPublished && saved.status === "published" && !saved.publishedAt) {
      saved.publishedAt = new Date();
      return this.posts.save(saved);
    }
    if (saved.status === "draft") {
      saved.publishedAt = null;
      return this.posts.save(saved);
    }
    return saved;
  }

  async remove(id: string, actor: BlogActor): Promise<void> {
    const post = await this.getById(id);
    this.assertOwner(post.authorId, actor, "BLOG_POST_FORBIDDEN");
    await this.posts.remove(post);
  }

  async adminRemove(id: string): Promise<void> {
    await this.posts.remove(await this.getById(id));
  }

  async listComments(slug: string, query: CommentPageDto): Promise<Paginated<BlogComment>> {
    const post = await this.getPublishedBySlug(slug);
    const [items, total] = await this.comments.findAndCount({
      where: { postId: post.id },
      order: { createdAt: "ASC" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return this.page(items, query.page, query.pageSize, total);
  }

  async addComment(slug: string, dto: BlogCommentDto, actor: BlogActor): Promise<BlogComment> {
    const post = await this.getPublishedBySlug(slug);
    return this.comments.save(
      this.comments.create({
        postId: post.id,
        authorId: actor.id,
        author: actor.name,
        authorImage: actor.image,
        body: dto.body.trim(),
      }),
    );
  }

  async updateComment(id: string, dto: BlogCommentDto, actor: BlogActor): Promise<BlogComment> {
    const comment = await this.getComment(id);
    this.assertOwner(comment.authorId, actor, "BLOG_COMMENT_FORBIDDEN");
    comment.body = dto.body.trim();
    return this.comments.save(comment);
  }

  async removeComment(id: string, actor: BlogActor): Promise<void> {
    const comment = await this.getComment(id);
    this.assertOwner(comment.authorId, actor, "BLOG_COMMENT_FORBIDDEN");
    await this.comments.remove(comment);
  }

  private async savePost(post: BlogPost, dto: UpdateBlogPostDto): Promise<BlogPost> {
    if (dto.title !== undefined) post.title = dto.title.trim();
    if (dto.slug !== undefined && dto.slug !== post.slug) post.slug = await this.availableSlug(dto.slug, post.id);
    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt.trim();
    if (dto.body !== undefined) post.body = dto.body.trim();
    if (dto.coverImage !== undefined) post.coverImage = dto.coverImage;
    if (dto.tags !== undefined) post.tags = this.cleanTags(dto.tags);
    return this.posts.save(post);
  }

  private async getComment(id: string): Promise<BlogComment> {
    const comment = await this.comments.findOne({ where: { id } });
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
      const existing = await this.posts.findOne({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
    }
    throw new AppException("BLOG_SLUG_CONFLICT", "Could not create a unique blog URL.", 409);
  }

  private page<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }
}
