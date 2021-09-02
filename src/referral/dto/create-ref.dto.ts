import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class CreateRefDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  ref: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  ip: string;
}