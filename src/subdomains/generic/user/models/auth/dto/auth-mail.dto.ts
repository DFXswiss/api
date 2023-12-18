import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class AuthMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  mail: string;
}
