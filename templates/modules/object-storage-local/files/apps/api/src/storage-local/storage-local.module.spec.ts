import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalObjectStore } from "@podosoft/podokit-runtime";

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("local object storage provider", () => {
  it("stores and reads an object without allowing traversal", async () => {
    root = await mkdtemp(join(tmpdir(), "podokit-storage-"));
    const storage = new LocalObjectStore({ rootDirectory: root });
    await storage.put("uploads/hello.txt", "hello", { contentType: "text/plain" });
    expect(await storage.exists("uploads/hello.txt")).toBe(true);
    expect(await storage.getDownloadUrl("uploads/hello.txt")).toBe(
      "/files/content/uploads/hello.txt",
    );
    await expect(storage.put("../outside.txt", "no")).rejects.toThrow("safe relative path");
  });
});
