import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateCryptoInputDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  isPayback: boolean;
}
