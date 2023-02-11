import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AssetQueryDto {
  @ApiPropertyOptional({ type: String, description: 'Comma-separated blockchain list' })
  @IsOptional()
  @IsString()
  blockchains?: string;
}
