import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsDate, IsNumber } from 'class-validator';
import { RewardDto } from '../../reward/dto/reward.dto';

export abstract class StakingRewardDto extends RewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  apr: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  apy: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  inputDate: Date;
}
