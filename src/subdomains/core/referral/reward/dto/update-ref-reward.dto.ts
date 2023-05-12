import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';
import { RewardStatus } from '../ref-reward.entity';

export class UpdateRefRewardDto extends RefRewardDto {
  @IsOptional()
  @IsString()
  txId: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsInt()
  userId: number;

  @IsOptional()
  @IsEnum(RewardStatus)
  status: RewardStatus;
}
