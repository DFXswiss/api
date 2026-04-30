import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  financialType: string;

  @IsOptional()
  @IsBoolean()
  buyable: boolean;

  @IsOptional()
  @IsBoolean()
  sellable: boolean;
}
