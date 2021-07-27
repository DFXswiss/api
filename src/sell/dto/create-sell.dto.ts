import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateSellDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  fiat: number;

  @IsNotEmpty()
  @Length(34, 34)
  @IsString()
  @IsOptional()
  address: string;

  @IsOptional()
  deposit: number;
}
