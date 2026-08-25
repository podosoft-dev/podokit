import { createHash } from "node:crypto";
import { Elysia, t } from "elysia";
import { AppException } from "../common/app-exception";
import { AUDIT } from "../audit/audit.module";
import { AUTH } from "../auth/auth.module";
import type { AuthSession } from "../auth/auth.service";
import {
  ACCESS_POLICY,
  DATABASE,
  type AppPlugin,
  type PodokitModule,
  type ServiceKey,
} from "../core/services";
import { RATE_LIMITER } from "../rate-limit/rate-limit.module";
import { STORAGE } from "../storage/storage.module";
import { BlogImageService } from "./blog-image.service";
import { BlogService } from "./blog.service";
import type { BlogActor, BlogPage, CreateBlogPost, UpdateBlogPost } from "./blog.types";

export const BLOG = Symbol("blog") as ServiceKey<BlogService>;
export const BLOG_IMAGES = Symbol("blog-images") as ServiceKey<BlogImageService>;

const MAX_BLOG_IMAGE_BYTES = 5 * 1024 * 1024;
const statusSchema = t.Union([t.Literal("draft"), t.Literal("published")]);
const coverImageSchema = t.Union([
  t.String({
    maxLength: 1000,
    pattern: "^(?:https?://|/api/blog/images/)[^\\s]+$",
  }),
  t.Null(),
]);
const createPostSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 300 }),
  slug: t.Optional(t.String({ maxLength: 300 })),
  excerpt: t.Optional(t.String({ maxLength: 1000 })),
  body: t.String({ minLength: 1, maxLength: 200_000 }),
  coverImage: t.Optional(coverImageSchema),
  tags: t.Optional(t.Array(t.String({ maxLength: 50 }), { maxItems: 20 })),
  status: t.Optional(statusSchema),
});
const updatePostSchema = t.Partial(createPostSchema);
const pageSchema = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  tag: t.Optional(t.String()),
});
const commentPageSchema = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});
const commentSchema = t.Object({ body: t.String({ minLength: 1, maxLength: 2000 }) });

function page(query: { page?: number; pageSize?: number; tag?: string }, defaultSize: number): BlogPage {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? defaultSize,
    ...(query.tag ? { tag: query.tag } : {}),
  };
}

function actorFrom(session: AuthSession): BlogActor {
  const roles = Array.isArray(session.user.role)
    ? session.user.role
    : (session.user.role ?? "").split(",").map((role) => role.trim());
  const name = typeof session.user.name === "string" && session.user.name.trim()
    ? session.user.name.trim()
    : typeof session.user.email === "string" && session.user.email.trim()
      ? session.user.email.trim()
      : "User";
  return {
    id: session.user.id,
    name,
    image: typeof session.user.image === "string" ? session.user.image : null,
    admin: roles.includes("admin"),
  };
}

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function tracker(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

const blogPlugin: AppPlugin = ({ services }) => {
  const auth = services.resolve(AUTH);
  const audit = services.resolve(AUDIT);
  const blog = services.resolve(BLOG);
  const images = services.resolve(BLOG_IMAGES);
  const limiter = services.resolve(RATE_LIMITER);

  const throttle = (
    profile: string,
    userId: string,
    ttlSeconds: number,
    limit: number,
    setHeader: (name: string, value: string) => void,
  ): Promise<void> => limiter.enforceCustom(profile, tracker(userId), ttlSeconds, limit, setHeader);

  return new Elysia({ name: "podokit.blog" })
    .get("/blog", ({ query }) => blog.listPublished(page(query, 10)), {
      query: pageSchema,
      detail: { tags: ["blog"], summary: "List published blog posts" },
    })
    .post("/blog/images", async ({ request, body, set }) => {
      const session = await auth.requireSession(request);
      await throttle("blog-image", session.user.id, 3600, 20, (name, value) => {
        set.headers[name] = value;
      });
      if (body.file.size > MAX_BLOG_IMAGE_BYTES) {
        throw new AppException(
          "BLOG_IMAGE_TOO_LARGE",
          "Blog images must be 5 MB or smaller.",
          413,
        );
      }
      const result = await images.upload(Buffer.from(await body.file.arrayBuffer()));
      await audit.recordRequest("blog.image.upload", request, session, {
        type: "blog-image",
        id: result.id,
      });
      set.status = 201;
      return result;
    }, {
      body: t.Object({ file: t.File() }),
      detail: { tags: ["blog"], summary: "Upload a blog image" },
    })
    .get("/blog/images/:id", async ({ params, set }) => {
      const image = await images.get(params.id);
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return new Response(responseBody(image.body), {
        headers: { "content-type": image.contentType },
      });
    }, {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { tags: ["blog"], summary: "Get a public blog image" },
    })
    .get("/blog/mine", async ({ request, query }) => {
      const session = await auth.requireSession(request);
      return blog.listMine(page(query, 10), actorFrom(session));
    }, {
      query: pageSchema,
      detail: { tags: ["blog"], summary: "List the current author's posts" },
    })
    .get("/blog/manage/:slug", async ({ request, params }) => {
      const session = await auth.requireSession(request);
      return blog.getManageableBySlug(params.slug, actorFrom(session));
    }, {
      params: t.Object({ slug: t.String({ minLength: 1 }) }),
      detail: { tags: ["blog"], summary: "Get an editable blog post" },
    })
    .get("/blog/:postRef/comments", ({ params, query }) => (
      blog.listComments(params.postRef, page(query, 20))
    ), {
      params: t.Object({ postRef: t.String({ minLength: 1 }) }),
      query: commentPageSchema,
      detail: { tags: ["blog"], summary: "List blog comments" },
    })
    .get("/blog/:postRef", ({ params }) => blog.getPublishedBySlug(params.postRef), {
      params: t.Object({ postRef: t.String({ minLength: 1 }) }),
      detail: { tags: ["blog"], summary: "Get a published blog post" },
    })
    .post("/blog", async ({ request, body, set }) => {
      const session = await auth.requireSession(request);
      await throttle("blog-create", session.user.id, 3600, 3, (name, value) => {
        set.headers[name] = value;
      });
      const post = await blog.create(body as CreateBlogPost, actorFrom(session));
      await audit.recordRequest("blog.post.create", request, session, {
        type: "blog-post",
        id: post.id,
        label: post.title,
      });
      set.status = 201;
      return post;
    }, {
      body: createPostSchema,
      detail: { tags: ["blog"], summary: "Create a blog post" },
    })
    .patch("/blog/:postRef", async ({ request, params, body }) => {
      const session = await auth.requireSession(request);
      const post = await blog.update(params.postRef, body as UpdateBlogPost, actorFrom(session));
      await audit.recordRequest("blog.post.update", request, session, {
        type: "blog-post",
        id: post.id,
        label: post.title,
      });
      return post;
    }, {
      params: t.Object({ postRef: t.String({ format: "uuid" }) }),
      body: updatePostSchema,
      detail: { tags: ["blog"], summary: "Update an owned blog post" },
    })
    .delete("/blog/:postRef", async ({ request, params, set }) => {
      const session = await auth.requireSession(request);
      await blog.remove(params.postRef, actorFrom(session));
      await audit.recordRequest("blog.post.delete", request, session, {
        type: "blog-post",
        id: params.postRef,
      });
      set.status = 204;
    }, {
      params: t.Object({ postRef: t.String({ format: "uuid" }) }),
      detail: { tags: ["blog"], summary: "Delete an owned blog post" },
    })
    .post("/blog/:postRef/comments", async ({ request, params, body, set }) => {
      const session = await auth.requireSession(request);
      await throttle("blog-comment", session.user.id, 60, 10, (name, value) => {
        set.headers[name] = value;
      });
      const comment = await blog.addComment(params.postRef, body.body, actorFrom(session));
      await audit.recordRequest("blog.comment.create", request, session, {
        type: "blog-comment",
        id: comment.id,
      });
      set.status = 201;
      return comment;
    }, {
      params: t.Object({ postRef: t.String({ minLength: 1 }) }),
      body: commentSchema,
      detail: { tags: ["blog"], summary: "Add a blog comment" },
    })
    .patch("/blog/comments/:id", async ({ request, params, body }) => {
      const session = await auth.requireSession(request);
      const comment = await blog.updateComment(params.id, body.body, actorFrom(session));
      await audit.recordRequest("blog.comment.update", request, session, {
        type: "blog-comment",
        id: comment.id,
      });
      return comment;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: commentSchema,
      detail: { tags: ["blog"], summary: "Update an owned blog comment" },
    })
    .delete("/blog/comments/:id", async ({ request, params, set }) => {
      const session = await auth.requireSession(request);
      await blog.removeComment(params.id, actorFrom(session));
      await audit.recordRequest("blog.comment.delete", request, session, {
        type: "blog-comment",
        id: params.id,
      });
      set.status = 204;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["blog"], summary: "Delete an owned blog comment" },
    })
    .get("/admin/blog", async ({ request, query }) => {
      await auth.requireAdmin(request);
      return blog.listAll(page(query, 10));
    }, {
      query: pageSchema,
      detail: { tags: ["blog"], summary: "List all blog posts" },
    })
    .get("/admin/blog/:id", async ({ request, params }) => {
      await auth.requireAdmin(request);
      return blog.getById(params.id);
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["blog"], summary: "Get a blog post for administration" },
    })
    .post("/admin/blog", async ({ request, body, set }) => {
      const session = await auth.requireAdmin(request);
      const post = await blog.adminCreate(body as CreateBlogPost, actorFrom(session));
      await audit.recordRequest("blog.admin.create", request, session, {
        type: "blog-post",
        id: post.id,
        label: post.title,
      });
      set.status = 201;
      return post;
    }, {
      body: createPostSchema,
      detail: { tags: ["blog"], summary: "Create a blog post as an administrator" },
    })
    .patch("/admin/blog/:id", async ({ request, params, body }) => {
      const session = await auth.requireAdmin(request);
      const post = await blog.adminUpdate(params.id, body as UpdateBlogPost);
      await audit.recordRequest("blog.admin.update", request, session, {
        type: "blog-post",
        id: post.id,
        label: post.title,
      });
      return post;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: updatePostSchema,
      detail: { tags: ["blog"], summary: "Update a blog post as an administrator" },
    })
    .delete("/admin/blog/:id", async ({ request, params, set }) => {
      const session = await auth.requireAdmin(request);
      await blog.adminRemove(params.id);
      await audit.recordRequest("blog.admin.delete", request, session, {
        type: "blog-post",
        id: params.id,
      });
      set.status = 204;
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["blog"], summary: "Delete a blog post as an administrator" },
    });
};

export const blogModule: PodokitModule = {
  name: "blog",
  configure: (_env, services): void => {
    services.register(BLOG, new BlogService(services.resolve(DATABASE).sql));
    services.register(BLOG_IMAGES, new BlogImageService(services.resolve(STORAGE)));
    const policy = services.resolve(ACCESS_POLICY);
    policy.register("GET", "/blog", "public");
    policy.register("GET", "/blog/images/:id", "public");
    policy.register("GET", "/blog/:postRef/comments", "public");
    policy.register("GET", "/blog/:postRef", "public");
  },
  plugin: blogPlugin,
};
