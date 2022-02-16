import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { StakingRewardDto } from './staking-reward.dto';

export class UpdateStakingRewardDto extends StakingRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  stakingId: number;
}
