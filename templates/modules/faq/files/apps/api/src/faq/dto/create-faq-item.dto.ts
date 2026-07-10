import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class CreateFaqItemDto {
  @ApiProperty({ example: "How do I reset my password?" })
  @IsString()
  @MaxLength(500)
  question!: string;

  @ApiPropertyOptional({ example: "Use the **Forgot password** link on the sign-in page." })
  @IsOptional()
  @IsString()
  answer?: string;

  @ApiPropertyOptional({ example: "Account" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ type: Object, description: "Project-specific fields." })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
