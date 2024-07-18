import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class UpdateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.trim)
  label?: string;
}
