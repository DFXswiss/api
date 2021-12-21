import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsInt, IsNumber, Matches, IsEnum } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AccountType } from '../user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(\w{1,3}-\w{1,3})$/)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationStreet: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationHouseNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationLocation: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationZip: string;

  @ApiPropertyOptional()
  @IsOptional()
  organizationCountry: any;
}
