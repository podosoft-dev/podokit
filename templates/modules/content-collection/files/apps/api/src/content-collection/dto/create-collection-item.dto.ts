import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class CreateCollectionItemDto {
  @ApiProperty({ example: "services" })
  @IsString()
  @MaxLength(64)
  collection!: string;

  @ApiProperty({ example: "Web development" })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: "web-development" })
  @IsString()
  @MaxLength(200)
  slug!: string;

  @ApiPropertyOptional({ example: "Modern web apps, end to end." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @ApiPropertyOptional({ example: "# Web development\n\n..." })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ example: "code" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({ example: "/uploads/hero.png" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @ApiPropertyOptional({ example: "#6d28d9" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @ApiPropertyOptional({ example: "engineering" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({ enum: ["draft", "published"], example: "draft" })
  @IsOptional()
  @IsIn(["draft", "published"])
  status?: "draft" | "published";

  @ApiPropertyOptional({ type: Object, description: "Project-specific fields." })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
