import { describe, expect, it } from "bun:test";
import type { StorageService } from "../storage/storage.service";
import { BlogImageService } from "./blog-image.service";

describe("BlogImageService", () => {
  it("detects image bytes and writes a stable public key", async () => {
    let key = "";
    let contentType = "";
    const storage = {
      put: async (nextKey: string, _body: Buffer, nextContentType: string): Promise<void> => {
        key = nextKey;
        contentType = nextContentType;
      },
    } as unknown as StorageService;
    const service = new BlogImageService(storage);

    const result = await service.upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    expect(key).toMatch(/^blog-images\/[0-9a-f-]{36}\.png$/);
    expect(contentType).toBe("image/png");
    expect(result.url).toBe(`/api/blog/images/${result.id}`);
  });

  it("rejects content whose bytes are not a supported image", async () => {
    const service = new BlogImageService({} as unknown as StorageService);
    expect(service.upload(Buffer.from("not an image"))).rejects.toMatchObject({
      code: "BLOG_IMAGE_TYPE_INVALID",
      statusCode: 400,
    });
  });
});
