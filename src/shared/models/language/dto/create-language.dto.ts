import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLanguageDto {

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  foreignName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  symbol: string;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  enable: boolean;
}
