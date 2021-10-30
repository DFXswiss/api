import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendMailDto {
  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  salutation: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  subject: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  body: string;
}
