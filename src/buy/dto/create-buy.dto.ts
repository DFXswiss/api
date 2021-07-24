import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  equals,
  IsBoolean,
  IsEmail,
  IsIBAN,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';
import { Asset } from 'src/asset/asset.entity';

export class CreateBuyDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsIBAN()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  asset: number;

  @IsNotEmpty()
  @Length(34, 34)
  @IsString()
  @IsOptional()
  address: string;

  @IsNotEmpty()
  @Length(14, 14)
  @IsOptional()
  @IsString()
  bankUsage: string;
}
