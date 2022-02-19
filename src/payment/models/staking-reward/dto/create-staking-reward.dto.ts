import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsString } from 'class-validator';
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
}
