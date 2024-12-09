import { IsEnum, IsOptional } from 'class-validator';
import { RewardStatus } from '../ref-reward.entity';

export class UpdateRefRewardDto {
  @IsOptional()
  @IsEnum(RewardStatus)
  status: RewardStatus;
}
