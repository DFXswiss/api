import { IsNumber, IsOptional, IsString } from 'class-validator';

export class OrganizationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  houseNumber?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsNumber()
  countryId?: number;
}
