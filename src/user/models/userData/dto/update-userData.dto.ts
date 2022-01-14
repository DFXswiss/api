import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsEnum, IsEmail, IsString, IsBoolean } from 'class-validator';
import { AccountType } from '../account-type.enum';
import { KycState, KycStatus } from '../userData.entity';

export class UpdateUserDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMigrated: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

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
  countryId: number;

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
  organizationCountryId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  depositLimit: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  kycFileId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(KycState)
  kycState: KycState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  mainBankDataId: number;
}
