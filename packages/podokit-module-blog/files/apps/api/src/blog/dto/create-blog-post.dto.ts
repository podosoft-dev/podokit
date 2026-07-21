import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import type { BlogPostStatus } from "../blog-post.entity";

export class CreateBlogPostDto {
  @IsString()
  @Length(1, 300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  excerpt = "";

  @IsString()
  @Length(1, 200000)
  body!: string;

  @IsOptional()
  @Matches(/^(?:https?:\/\/|\/api\/blog\/images\/)[^\s]+$/)
  @MaxLength(1000)
  coverImage?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags: string[] = [];

  @IsOptional()
  @IsIn(["draft", "published"])
  status?: BlogPostStatus;
}
