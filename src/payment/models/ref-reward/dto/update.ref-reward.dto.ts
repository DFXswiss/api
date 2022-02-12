import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';

export class UpdateRefRewardDto extends RefRewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  userId: number;
}
