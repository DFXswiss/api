import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { StakingRewardType } from '../staking-reward.entity';
import { StakingRewardDto } from './staking-reward.dto';

export class CreateStakingRewardDto extends StakingRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  txId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  internalId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  stakingId: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingRewardType)
  stakingRewardType: StakingRewardType;
}
