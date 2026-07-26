import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class UpdateAnalyticsConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(["ga4"])
  provider?: "ga4";

  @IsOptional()
  @IsString()
  @Matches(/^G-[A-Z0-9]{4,30}$/)
  measurementId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,30}$/)
  propertyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32_768)
  serviceAccountJson?: string;
}
