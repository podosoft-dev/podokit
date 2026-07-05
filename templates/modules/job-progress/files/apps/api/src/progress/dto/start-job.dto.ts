import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class StartJobDto {
  @ApiPropertyOptional({ example: 5, description: "Number of progress steps" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  steps?: number;
}
