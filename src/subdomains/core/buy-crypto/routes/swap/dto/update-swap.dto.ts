import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateSwapDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;
}
