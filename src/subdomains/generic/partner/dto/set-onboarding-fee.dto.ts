import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';

export class SetOnboardingFeeDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  feeId: number;
}
