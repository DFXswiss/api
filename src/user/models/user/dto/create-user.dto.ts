import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class CreateUserDto {
  //TODO überflüssige löschen

  @IsNotEmpty()
  @Matches(/^(8\w{33}|d\w{33}|d\w{41})$/)
  @IsString()
  address: string;

  @IsNotEmpty()
  @Length(88, 96)
  @IsString()
  signature: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Length(7, 7)
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
  wallet: any;

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

  @IsOptional()
  @IsString()
  ip: string;
}
