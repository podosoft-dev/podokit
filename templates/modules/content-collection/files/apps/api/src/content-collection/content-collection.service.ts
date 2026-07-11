import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CollectionItem } from "./collection-item.entity";
import { CreateCollectionItemDto } from "./dto/create-collection-item.dto";
import { UpdateCollectionItemDto } from "./dto/update-collection-item.dto";

@Injectable()
export class ContentCollectionService {
  constructor(
    @InjectRepository(CollectionItem) private readonly items: Repository<CollectionItem>,
  ) {}

  /** Public: distinct collection keys that have at least one published item. */
  async listCollections(): Promise<string[]> {
    const rows = await this.items
      .createQueryBuilder("i")
      .select("DISTINCT i.collection", "collection")
      .where("i.status = :status", { status: "published" })
      .orderBy("i.collection", "ASC")
      .getRawMany<{ collection: string }>();
    return rows.map((r) => r.collection);
  }

  /** Public: published items of a collection, in display order. */
  listPublished(collection: string): Promise<CollectionItem[]> {
    return this.items.find({
      where: { collection, status: "published" },
      order: { order: "ASC", createdAt: "DESC" },
    });
  }

  /** Public: a single published item by slug. */
  async getPublished(collection: string, slug: string): Promise<CollectionItem> {
    const item = await this.items.findOne({ where: { collection, slug, status: "published" } });
    if (!item) throw new NotFoundException("COLLECTION_ITEM_NOT_FOUND");
    return item;
  }

  /** Admin: every item of a collection (any status). */
  listAll(collection: string): Promise<CollectionItem[]> {
    return this.items.find({ where: { collection }, order: { order: "ASC", createdAt: "DESC" } });
  }

  /** Admin: every item across all collections (any status). */
  listEvery(): Promise<CollectionItem[]> {
    return this.items.find({ order: { collection: "ASC", order: "ASC", createdAt: "DESC" } });
  }

  async create(dto: CreateCollectionItemDto): Promise<CollectionItem> {
    const item = this.items.create({
      ...dto,
      publishedAt: dto.status === "published" ? new Date() : null,
    });
    return this.items.save(item);
  }

  async update(id: string, dto: UpdateCollectionItemDto): Promise<CollectionItem> {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw new NotFoundException("COLLECTION_ITEM_NOT_FOUND");
    // Stamp publishedAt the first time an item goes live.
    if (dto.status === "published" && item.status !== "published" && !item.publishedAt) {
      item.publishedAt = new Date();
    }
    Object.assign(item, dto);
    return this.items.save(item);
  }

  async remove(id: string): Promise<void> {
    const result = await this.items.delete({ id });
    if (!result.affected) throw new NotFoundException("COLLECTION_ITEM_NOT_FOUND");
  }
}
