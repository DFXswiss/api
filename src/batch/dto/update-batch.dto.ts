import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateBatchDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

}