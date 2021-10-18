import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsInt, IsNumber } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usedRef: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  refFeePercent: number;

  @ApiPropertyOptional()
  @IsOptional()
  refFeeAsset: Asset;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstname: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  surname: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  street: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  houseNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zip: string;

  @ApiPropertyOptional()
  @IsOptional()
  language: any;

  @ApiPropertyOptional()
  @IsOptional()
  country: any;

  @ApiPropertyOptional()
  @IsOptional()
  currency: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  // TODO: user phonenumber decorator instead of string --> Figure it out
  // @IsPhoneNumber()
  phone: string;
}
