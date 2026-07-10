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
import { FaqItem } from "./faq-item.entity";
import { FaqService } from "./faq.service";
import { CreateFaqItemDto } from "./dto/create-faq-item.dto";
import { UpdateFaqItemDto } from "./dto/update-faq-item.dto";

function requireAdmin(session: UserSession): void {
  if ((session.user as { role?: string | null }).role !== "admin") {
    throw new ForbiddenException("Admins only");
  }
}

@ApiTags("faq")
@Controller("faq")
export class FaqController {
  constructor(private readonly service: FaqService) {}

  @Public()
  @Get()
  list(): Promise<FaqItem[]> {
    return this.service.listPublished();
  }
}

@ApiTags("faq")
@Controller("admin/faq")
export class FaqAdminController {
  constructor(private readonly service: FaqService) {}

  @Get()
  listAll(@Session() session: UserSession): Promise<FaqItem[]> {
    requireAdmin(session);
    return this.service.listAll();
  }

  @Post()
  create(@Session() session: UserSession, @Body() dto: CreateFaqItemDto): Promise<FaqItem> {
    requireAdmin(session);
    return this.service.create(dto);
  }

  @Put(":id")
  update(
    @Session() session: UserSession,
    @Param("id") id: string,
    @Body() dto: UpdateFaqItemDto,
  ): Promise<FaqItem> {
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
