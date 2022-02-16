import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';

export class UpdateRefRewardDto extends RefRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  userId: number;
}
