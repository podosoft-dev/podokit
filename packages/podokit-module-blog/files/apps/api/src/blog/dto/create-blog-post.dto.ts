import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from "class-validator";

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
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  coverImage?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags: string[] = [];
}
