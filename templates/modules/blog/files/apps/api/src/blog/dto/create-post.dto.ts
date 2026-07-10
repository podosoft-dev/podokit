import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreatePostDto {
  @ApiProperty({ example: "Hello world" })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: "hello-world" })
  @IsString()
  @MaxLength(200)
  slug!: string;

  @ApiPropertyOptional({ example: "A short teaser." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiPropertyOptional({ example: "# Hello\n\n..." })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ example: "/uploads/cover.png" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImage?: string;

  @ApiPropertyOptional({ example: "Jane Doe" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @ApiPropertyOptional({ type: [String], example: ["news", "release"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: ["draft", "published"], example: "draft" })
  @IsOptional()
  @IsIn(["draft", "published"])
  status?: "draft" | "published";

  @ApiPropertyOptional({ type: Object, description: "Project-specific fields." })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
