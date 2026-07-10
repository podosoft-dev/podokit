import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FaqItem } from "./faq-item.entity";
import { CreateFaqItemDto } from "./dto/create-faq-item.dto";
import { UpdateFaqItemDto } from "./dto/update-faq-item.dto";

@Injectable()
export class FaqService {
  constructor(@InjectRepository(FaqItem) private readonly items: Repository<FaqItem>) {}

  /** Public: published FAQ entries, by category then order. */
  listPublished(): Promise<FaqItem[]> {
    return this.items.find({
      where: { published: true },
      order: { category: "ASC", order: "ASC" },
    });
  }

  /** Admin: every entry (any status). */
  listAll(): Promise<FaqItem[]> {
    return this.items.find({ order: { category: "ASC", order: "ASC" } });
  }

  create(dto: CreateFaqItemDto): Promise<FaqItem> {
    return this.items.save(this.items.create(dto));
  }

  async update(id: string, dto: UpdateFaqItemDto): Promise<FaqItem> {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw new NotFoundException("FAQ_ITEM_NOT_FOUND");
    Object.assign(item, dto);
    return this.items.save(item);
  }

  async remove(id: string): Promise<void> {
    const result = await this.items.delete({ id });
    if (!result.affected) throw new NotFoundException("FAQ_ITEM_NOT_FOUND");
  }
}
