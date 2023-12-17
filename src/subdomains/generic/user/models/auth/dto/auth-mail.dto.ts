import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AuthMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mail: string;
}
