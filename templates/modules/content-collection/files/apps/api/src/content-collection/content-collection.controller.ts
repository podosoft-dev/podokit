import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { CollectionItem } from "./collection-item.entity";
import { ContentCollectionService } from "./content-collection.service";
import { CreateCollectionItemDto } from "./dto/create-collection-item.dto";
import { UpdateCollectionItemDto } from "./dto/update-collection-item.dto";

function requireAdmin(session: UserSession): void {
  if ((session.user as { role?: string | null }).role !== "admin") {
    throw new ForbiddenException("Admins only");
  }
}

// Public read API: published items only.
@ApiTags("collections")
@Controller("collections")
export class ContentCollectionController {
  constructor(private readonly service: ContentCollectionService) {}

  @Public()
  @Get(":collection")
  list(@Param("collection") collection: string): Promise<CollectionItem[]> {
    return this.service.listPublished(collection);
  }

  @Public()
  @Get(":collection/:slug")
  getOne(
    @Param("collection") collection: string,
    @Param("slug") slug: string,
  ): Promise<CollectionItem> {
    return this.service.getPublished(collection, slug);
  }
}

// Admin CRUD: any status. Admins only.
@ApiTags("collections")
@Controller("admin/collections")
export class ContentCollectionAdminController {
  constructor(private readonly service: ContentCollectionService) {}

  @Get()
  listEvery(@Session() session: UserSession): Promise<CollectionItem[]> {
    requireAdmin(session);
    return this.service.listEvery();
  }

  @Get(":collection")
  listAll(
    @Session() session: UserSession,
    @Param("collection") collection: string,
  ): Promise<CollectionItem[]> {
    requireAdmin(session);
    return this.service.listAll(collection);
  }

  @Post()
  create(
    @Session() session: UserSession,
    @Body() dto: CreateCollectionItemDto,
  ): Promise<CollectionItem> {
    requireAdmin(session);
    return this.service.create(dto);
  }

  @Put(":id")
  update(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: UpdateCollectionItemDto,
  ): Promise<CollectionItem> {
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
