import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Post } from "./post.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";

@Injectable()
export class BlogService {
  constructor(@InjectRepository(Post) private readonly posts: Repository<Post>) {}

  /** Public: published posts, newest first, optionally filtered by tag. */
  async listPublished(tag?: string): Promise<Post[]> {
    const posts = await this.posts.find({
      where: { status: "published" },
      order: { publishedAt: "DESC", createdAt: "DESC" },
    });
    return tag ? posts.filter((p) => p.tags.includes(tag)) : posts;
  }

  /** Public: a single published post by slug. */
  async getPublished(slug: string): Promise<Post> {
    const post = await this.posts.findOne({ where: { slug, status: "published" } });
    if (!post) throw new NotFoundException("POST_NOT_FOUND");
    return post;
  }

  /** Admin: every post (any status). */
  listAll(): Promise<Post[]> {
    return this.posts.find({ order: { createdAt: "DESC" } });
  }

  async create(dto: CreatePostDto): Promise<Post> {
    const post = this.posts.create({
      ...dto,
      publishedAt: dto.status === "published" ? new Date() : null,
    });
    return this.posts.save(post);
  }

  async update(id: string, dto: UpdatePostDto): Promise<Post> {
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException("POST_NOT_FOUND");
    if (dto.status === "published" && post.status !== "published" && !post.publishedAt) {
      post.publishedAt = new Date();
    }
    Object.assign(post, dto);
    return this.posts.save(post);
  }

  async remove(id: string): Promise<void> {
    const result = await this.posts.delete({ id });
    if (!result.affected) throw new NotFoundException("POST_NOT_FOUND");
  }
}
