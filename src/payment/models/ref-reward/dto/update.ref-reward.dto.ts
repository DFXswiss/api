import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';

export class UpdateRefRewardDto extends RefRewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  userId: number;
}
