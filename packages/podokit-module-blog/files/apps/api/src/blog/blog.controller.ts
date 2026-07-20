/// <reference types="multer" />
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Throttle, type ThrottlerGetTrackerFunction } from "@nestjs/throttler";
import {
  Public,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { AppException } from "../common/app-exception";
import { auth } from "../auth/auth";
import { Audit } from "../audit/audit.decorator";
import { BlogImageService } from "./blog-image.service";
import { BlogService, type BlogActor, type Paginated } from "./blog.service";
import { BlogComment } from "./blog-comment.entity";
import { BlogPost } from "./blog-post.entity";
import {
  AdminCreateBlogPostDto,
  AdminUpdateBlogPostDto,
} from "./dto/admin-blog-post.dto";
import { BlogCommentDto } from "./dto/blog-comment.dto";
import { BlogPageDto, CommentPageDto } from "./dto/blog-page.dto";
import { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import { UpdateBlogPostDto } from "./dto/update-blog-post.dto";

interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | string[] | null;
}

const authenticatedUserTracker: ThrottlerGetTrackerFunction = async (
  request,
): Promise<string> => {
  const httpRequest = request as Request;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(httpRequest.headers),
    });
    if (session?.user.id) return `user:${session.user.id}`;
  } catch {
    // The route guard still enforces authentication; the IP is only a safe fallback tracker.
  }
  return `ip:${httpRequest.ip || httpRequest.socket.remoteAddress || "unknown"}`;
};

const MAX_BLOG_IMAGE_BYTES = 5 * 1024 * 1024;

function actorFrom(session: UserSession): BlogActor {
  const user = session.user as unknown as SessionUser | undefined;
  if (!user?.id)
    throw new AppException("AUTH_REQUIRED", "Authentication is required.", 401);
  const roles = Array.isArray(user.role)
    ? user.role
    : (user.role ?? "").split(",").map((role) => role.trim());
  return {
    id: user.id,
    name: user.name?.trim() || user.email?.trim() || "User",
    image: user.image ?? null,
    admin: roles.includes("admin"),
  };
}

function adminFrom(session: UserSession): BlogActor {
  const actor = actorFrom(session);
  if (!actor.admin)
    throw new AppException("BLOG_ADMIN_REQUIRED", "Admin role required.", 403);
  return actor;
}

@ApiTags("blog")
@Controller()
export class BlogController {
  constructor(
    private readonly blog: BlogService,
    private readonly images: BlogImageService,
  ) {}

  @Public()
  @Get("blog")
  list(@Query() query: BlogPageDto): Promise<Paginated<BlogPost>> {
    return this.blog.listPublished(query);
  }

  @Post("blog/images")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_BLOG_IMAGE_BYTES + 1 } }),
  )
  @Throttle({
    default: {
      limit: 20,
      ttl: 60 * 60 * 1000,
      getTracker: authenticatedUserTracker,
    },
  })
  @Audit("blog.image.upload")
  async uploadImage(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new AppException(
        "BLOG_IMAGE_REQUIRED",
        "An image file is required.",
        400,
      );
    }
    if (file.size > MAX_BLOG_IMAGE_BYTES) {
      throw new AppException(
        "BLOG_IMAGE_TOO_LARGE",
        "Blog images must be 5 MB or smaller.",
        413,
      );
    }
    return this.images.upload(file.buffer);
  }

  @Public()
  @Get("blog/images/:id")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async image(@Param("id") id: string): Promise<StreamableFile> {
    const image = await this.images.get(id);
    return new StreamableFile(image.body, { type: image.contentType });
  }

  @Get("blog/mine")
  mine(
    @Session() session: UserSession,
    @Query() query: BlogPageDto,
  ): Promise<Paginated<BlogPost>> {
    return this.blog.listMine(query, actorFrom(session));
  }

  @Get("blog/manage/:slug")
  manage(
    @Session() session: UserSession,
    @Param("slug") slug: string,
  ): Promise<BlogPost> {
    return this.blog.getManageableBySlug(slug, actorFrom(session));
  }

  @Public()
  @Get("blog/:slug/comments")
  comments(
    @Param("slug") slug: string,
    @Query() query: CommentPageDto,
  ): Promise<Paginated<BlogComment>> {
    return this.blog.listComments(slug, query);
  }

  @Public()
  @Get("blog/:slug")
  bySlug(@Param("slug") slug: string): Promise<BlogPost> {
    return this.blog.getPublishedBySlug(slug);
  }

  @Post("blog")
  @Throttle({
    default: {
      limit: 3,
      ttl: 60 * 60 * 1000,
      getTracker: authenticatedUserTracker,
    },
  })
  @Audit("blog.post.create")
  create(
    @Session() session: UserSession,
    @Body() dto: CreateBlogPostDto,
  ): Promise<BlogPost> {
    return this.blog.create(dto, actorFrom(session));
  }

  @Patch("blog/:id")
  @Audit("blog.post.update")
  update(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: UpdateBlogPostDto,
  ): Promise<BlogPost> {
    return this.blog.update(id, dto, actorFrom(session));
  }

  @Delete("blog/:id")
  @HttpCode(204)
  @Audit("blog.post.delete")
  remove(
    @Session() session: UserSession,
    @Param("id") id: string,
  ): Promise<void> {
    return this.blog.remove(id, actorFrom(session));
  }

  @Post("blog/:slug/comments")
  @Throttle({
    default: {
      limit: 10,
      ttl: 60 * 1000,
      getTracker: authenticatedUserTracker,
    },
  })
  @Audit("blog.comment.create")
  addComment(
    @Session() session: UserSession,
    @Param("slug") slug: string,
    @Body() dto: BlogCommentDto,
  ): Promise<BlogComment> {
    return this.blog.addComment(slug, dto, actorFrom(session));
  }

  @Patch("blog/comments/:id")
  @Audit("blog.comment.update")
  updateComment(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: BlogCommentDto,
  ): Promise<BlogComment> {
    return this.blog.updateComment(id, dto, actorFrom(session));
  }

  @Delete("blog/comments/:id")
  @HttpCode(204)
  @Audit("blog.comment.delete")
  removeComment(
    @Session() session: UserSession,
    @Param("id") id: string,
  ): Promise<void> {
    return this.blog.removeComment(id, actorFrom(session));
  }

  @Get("admin/blog")
  adminList(
    @Session() session: UserSession,
    @Query() query: BlogPageDto,
  ): Promise<Paginated<BlogPost>> {
    adminFrom(session);
    return this.blog.listAll(query);
  }

  @Get("admin/blog/:id")
  adminGet(
    @Session() session: UserSession,
    @Param("id") id: string,
  ): Promise<BlogPost> {
    adminFrom(session);
    return this.blog.getById(id);
  }

  @Post("admin/blog")
  @Audit("blog.admin.create")
  adminCreate(
    @Session() session: UserSession,
    @Body() dto: AdminCreateBlogPostDto,
  ): Promise<BlogPost> {
    return this.blog.adminCreate(dto, adminFrom(session));
  }

  @Patch("admin/blog/:id")
  @Audit("blog.admin.update")
  adminUpdate(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: AdminUpdateBlogPostDto,
  ): Promise<BlogPost> {
    adminFrom(session);
    return this.blog.adminUpdate(id, dto);
  }

  @Delete("admin/blog/:id")
  @HttpCode(204)
  @Audit("blog.admin.delete")
  adminRemove(
    @Session() session: UserSession,
    @Param("id") id: string,
  ): Promise<void> {
    adminFrom(session);
    return this.blog.adminRemove(id);
  }
}
