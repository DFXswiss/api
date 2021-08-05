import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  IsInt,
  IsNumber,
} from 'class-validator';

export class UpdateUserDataDto {
    @IsOptional()
    @IsInt()
    id: number;
  
    @IsOptional()
    @IsString()
    name: string;
  
    @IsOptional()
    @IsString()
    location: string;
  
    @IsOptional()
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