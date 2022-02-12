import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';

export class CreateRefRewardDto extends RefRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  userId: number;
}
