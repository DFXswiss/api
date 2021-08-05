import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  equals,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  IsInt,
  IsNumber,
} from 'class-validator';
import { UserRole } from 'src/user/user.entity';

export class CreateUserDataDto {
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
  location: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  monthlyValue: number;

  @IsString()
  @IsOptional()
  updated: Date;

  @IsString()
  @IsOptional()
  created: Date;
}