import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateCryptoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;
}
