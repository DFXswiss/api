import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { StakingRewardType } from '../staking-reward.entity';
import { StakingRewardDto } from './staking-reward.dto';

export class UpdateStakingRewardDto extends StakingRewardDto {
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
  stakingId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(StakingRewardType)
  stakingRewardType: StakingRewardType;
}
