import { IsString, Length } from "class-validator";

export class BlogCommentDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}
