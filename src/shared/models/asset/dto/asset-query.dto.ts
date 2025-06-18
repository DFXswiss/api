import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class AssetQueryDto {
  @ApiPropertyOptional({ type: String, description: 'Comma-separated blockchain list' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  blockchains?: string;

  // hidden flag
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  includePrivate: string;
}
