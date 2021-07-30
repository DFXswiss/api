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

export class CreateCountryDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  symbol: string;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  activeLanguage: boolean;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  enable: boolean;

  @IsString()
  @IsOptional()
  created: Date;
}
