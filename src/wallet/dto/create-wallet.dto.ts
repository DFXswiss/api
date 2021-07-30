import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  equals,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';

export class CreateWalletDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 34)
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @Length(88, 88)
  @IsString()
  signature: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  created: Date;
}
