import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateVirtualIbanDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  currency: string;
}
