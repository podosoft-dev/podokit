/// <reference types="multer" />
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { PUBLIC_SITE_KEYS, SiteSettingsService } from "./site-settings.service";

function isAdmin(session: UserSession): boolean {
  const role = session.user?.role;
  const roles = Array.isArray(role) ? role : (role ?? "").split(",").map((r: string) => r.trim());
  return roles.includes("admin");
}

const ALLOWED = new Set<string>(PUBLIC_SITE_KEYS);
const MAX_ICON_BYTES = 1024 * 1024; // 1 MB
const ICON_TYPES = new Set(["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"]);

@ApiTags("site")
@Controller("site")
export class SiteSettingsController {
  constructor(private readonly site: SiteSettingsService) {}

  /** Public: the site branding every page needs (title, favicon presence, …). */
  @Public()
  @Get("settings")
  async settings(): Promise<Record<string, string | boolean | null>> {
    const all = await this.site.getAll();
    const out: Record<string, string | boolean | null> = {};
    for (const key of PUBLIC_SITE_KEYS) out[key] = all[key] ?? null;
    out.hasFavicon = (await this.site.get("faviconContentType")) !== null;
    out.faviconVersion = await this.site.faviconVersion();
    return out;
  }

  /** Admin: update one or more site settings. Unknown keys are rejected. */
  @Put("settings")
  async update(
    @Session() session: UserSession,
    @Body() body: Record<string, string>,
  ): Promise<Record<string, string>> {
    if (!isAdmin(session)) throw new ForbiddenException("Admins only");
    const update: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (!ALLOWED.has(key)) throw new BadRequestException(`Unknown setting: ${key}`);
      update[key] = String(value ?? "");
    }
    return this.site.setMany(update);
  }

  /** Admin: upload the browser icon. Stored in object storage; served below. */
  @Post("favicon")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFavicon(
    @Session() session: UserSession,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ version: string | null }> {
    if (!isAdmin(session)) throw new ForbiddenException("Admins only");
    if (!file) throw new BadRequestException("A file field is required (multipart/form-data)");
    if (!ICON_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Icon must be SVG, PNG, or ICO");
    }
    if (file.size > MAX_ICON_BYTES) throw new BadRequestException("Icon must be 1 MB or smaller");
    await this.site.setFavicon(file.buffer, file.mimetype);
    return { version: await this.site.faviconVersion() };
  }

  /** Public: serve the current favicon from object storage (stable URL, no expiry). */
  @Public()
  @Get("favicon")
  async favicon(): Promise<StreamableFile> {
    const icon = await this.site.getFavicon();
    if (!icon) throw new BadRequestException("No favicon set");
    return new StreamableFile(icon.body, { type: icon.contentType });
  }
}
