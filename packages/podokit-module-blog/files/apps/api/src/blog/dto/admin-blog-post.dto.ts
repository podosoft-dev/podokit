import { IsIn, IsOptional } from "class-validator";
import type { BlogPostStatus } from "../blog-post.entity";
import { CreateBlogPostDto } from "./create-blog-post.dto";
import { UpdateBlogPostDto } from "./update-blog-post.dto";

export class AdminCreateBlogPostDto extends CreateBlogPostDto {
  @IsOptional()
  @IsIn(["draft", "published"])
  status: BlogPostStatus = "draft";
}

export class AdminUpdateBlogPostDto extends UpdateBlogPostDto {
  @IsOptional()
  @IsIn(["draft", "published"])
  status?: BlogPostStatus;
}
