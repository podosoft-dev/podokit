import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Post as HttpPost,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { Post } from "./post.entity";
import { BlogService } from "./blog.service";
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";

function requireAdmin(session: UserSession): void {
  if ((session.user as { role?: string | null }).role !== "admin") {
    throw new ForbiddenException("Admins only");
  }
}

const xml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);

@ApiTags("blog")
@Controller("blog")
export class BlogController {
  constructor(private readonly service: BlogService) {}

  @Public()
  @Get()
  list(@Query("tag") tag?: string): Promise<Post[]> {
    return this.service.listPublished(tag);
  }

  // Defined before :slug so "rss.xml" isn't captured as a slug.
  @Public()
  @Get("rss.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  async rss(): Promise<string> {
    const site = process.env.PUBLIC_SITE_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:5001";
    const posts = await this.service.listPublished();
    const items = posts
      .map(
        (p) => `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(`${site}/blog/${p.slug}`)}</link>
      <guid>${xml(`${site}/blog/${p.slug}`)}</guid>
      ${p.publishedAt ? `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : ""}
      ${p.excerpt ? `<description>${xml(p.excerpt)}</description>` : ""}
    </item>`,
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog</title>
    <link>${xml(`${site}/blog`)}</link>
    <description>Latest posts</description>
${items}
  </channel>
</rss>`;
  }

  @Public()
  @Get(":slug")
  getOne(@Param("slug") slug: string): Promise<Post> {
    return this.service.getPublished(slug);
  }
}

@ApiTags("blog")
@Controller("admin/blog")
export class BlogAdminController {
  constructor(private readonly service: BlogService) {}

  @Get()
  listAll(@Session() session: UserSession): Promise<Post[]> {
    requireAdmin(session);
    return this.service.listAll();
  }

  @HttpPost()
  create(@Session() session: UserSession, @Body() dto: CreatePostDto): Promise<Post> {
    requireAdmin(session);
    return this.service.create(dto);
  }

  @Put(":id")
  update(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<Post> {
    requireAdmin(session);
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Session() session: UserSession, @Param("id") id: string): Promise<void> {
    requireAdmin(session);
    await this.service.remove(id);
  }
}
