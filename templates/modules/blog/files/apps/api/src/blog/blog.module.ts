import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./post.entity";
import { BlogAdminController, BlogController } from "./blog.controller";
import { BlogService } from "./blog.service";

@Module({
  imports: [TypeOrmModule.forFeature([Post])],
  controllers: [BlogController, BlogAdminController],
  providers: [BlogService],
})
export class BlogModule {}
