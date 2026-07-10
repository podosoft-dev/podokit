// The API tsconfig restricts `types` to ["node"], which suppresses @types/multer's
// global augmentation of Express.Multer.File. Load it explicitly so the type resolves.
/// <reference types="multer" />
import { BadRequestException, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { StorageService } from "../storage/storage.service";

@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<{ key: string; url: string }> {
    if (!file) {
      throw new BadRequestException("A file field is required (multipart/form-data)");
    }
    const safeName = file.originalname.replace(/[^\w.-]+/g, "_");
    const key = `uploads/${randomUUID()}-${safeName}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return { key, url: await this.storage.presignedGetUrl(key) };
  }

  @Get(":key/url")
  async url(@Param("key") key: string): Promise<{ url: string }> {
    return { url: await this.storage.presignedGetUrl(key) };
  }
}
