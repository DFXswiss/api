import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';
import { StakingRewardDto } from './staking-reward.dto';

export class CreateStakingRewardDto extends StakingRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  routeId: number;
}
