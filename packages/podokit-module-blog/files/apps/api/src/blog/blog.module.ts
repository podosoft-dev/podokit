import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BlogComment } from "./blog-comment.entity";
import { BlogController } from "./blog.controller";
import { BlogPost } from "./blog-post.entity";
import { BlogService } from "./blog.service";

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogComment])],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
