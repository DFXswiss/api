import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBatchDto {

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

}