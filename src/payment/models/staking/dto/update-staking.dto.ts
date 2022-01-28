import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty } from 'class-validator';
import { CreateStakingDto } from './create-staking.dto';

export class UpdateStakingDto extends CreateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;
}
