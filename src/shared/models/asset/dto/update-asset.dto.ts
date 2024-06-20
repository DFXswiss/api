import { IsOptional, IsString } from 'class-validator';

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  financialType: string;
}
