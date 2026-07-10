import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionItem } from "./collection-item.entity";
import {
  ContentCollectionAdminController,
  ContentCollectionController,
} from "./content-collection.controller";
import { ContentCollectionService } from "./content-collection.service";

@Module({
  imports: [TypeOrmModule.forFeature([CollectionItem])],
  controllers: [ContentCollectionController, ContentCollectionAdminController],
  providers: [ContentCollectionService],
})
export class ContentCollectionModule {}
