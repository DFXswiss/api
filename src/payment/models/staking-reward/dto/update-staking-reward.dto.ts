import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { StakingRewardDto } from './staking-reward.dto';

export class UpdateStakingRewardDto extends StakingRewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  routeId: number;
}
