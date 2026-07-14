import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppException } from "../common/app-exception";
import { StorageService } from "../storage/storage.service";

const IMAGE_KEY_PREFIX = "blog-images/";
const IMAGE_ID_PATTERN = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif)$/;

interface DetectedImage {
  contentType: string;
  extension: string;
}

export interface StoredBlogImage {
  body: Buffer;
  contentType: string;
}

function startsWith(body: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => body[index] === byte);
}

function detectImage(body: Buffer): DetectedImage | null {
  if (startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (startsWith(body, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  const header = body.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (body.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = body.subarray(8, 32).toString("ascii");
    if (brands.includes("avif") || brands.includes("avis")) {
      return { contentType: "image/avif", extension: "avif" };
    }
  }
  return null;
}

function contentTypeFor(id: string): string {
  if (id.endsWith(".png")) return "image/png";
  if (id.endsWith(".jpg")) return "image/jpeg";
  if (id.endsWith(".gif")) return "image/gif";
  if (id.endsWith(".webp")) return "image/webp";
  return "image/avif";
}

@Injectable()
export class BlogImageService {
  constructor(private readonly storage: StorageService) {}

  async upload(body: Buffer): Promise<{ id: string; url: string }> {
    const image = detectImage(body);
    if (!image) {
      throw new AppException(
        "BLOG_IMAGE_TYPE_INVALID",
        "Only PNG, JPEG, GIF, WebP, and AVIF images are supported.",
        400,
      );
    }
    const id = `${randomUUID()}.${image.extension}`;
    await this.storage.put(`${IMAGE_KEY_PREFIX}${id}`, body, image.contentType);
    return { id, url: `/api/blog/images/${id}` };
  }

  async get(id: string): Promise<StoredBlogImage> {
    if (!IMAGE_ID_PATTERN.test(id)) {
      throw new AppException(
        "BLOG_IMAGE_NOT_FOUND",
        "Blog image not found.",
        404,
      );
    }
    try {
      return {
        body: await this.storage.get(`${IMAGE_KEY_PREFIX}${id}`),
        contentType: contentTypeFor(id),
      };
    } catch {
      throw new AppException(
        "BLOG_IMAGE_NOT_FOUND",
        "Blog image not found.",
        404,
      );
    }
  }
}
