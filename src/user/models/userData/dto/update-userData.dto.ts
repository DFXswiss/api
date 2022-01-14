import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsEnum, IsNotEmpty, IsEmail, IsString, IsBoolean } from 'class-validator';
import { AccountType } from '../account-type.enum';
import { KycState, KycStatus } from '../userData.entity';

export class UpdateUserDataDto {
  @IsInt()
  @IsNotEmpty()
  id: number;

  @IsOptional()
  @IsBoolean()
  isMigrated: boolean;

  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsEmail()
  mail: string;

  @IsOptional()
  @IsString()
  firstname: string;

  @IsOptional()
  @IsString()
  surname: string;

  @IsOptional()
  @IsString()
  street: string;

  @IsOptional()
  @IsString()
  houseNumber: string;

  @IsOptional()
  @IsString()
  location: string;

  @IsOptional()
  @IsString()
  zip: string;

  @IsOptional()
  language: any;

  @IsOptional()
  @IsInt()
  countryId: number;

  @IsOptional()
  @IsString()
  // TODO: user phonenumber decorator instead of string --> Figure it out
  // @IsPhoneNumber()
  phone: string;

  @IsOptional()
  @IsString()
  organizationName: string;

  @IsOptional()
  @IsString()
  organizationStreet: string;

  @IsOptional()
  @IsString()
  organizationHouseNumber: string;

  @IsOptional()
  @IsString()
  organizationLocation: string;

  @IsOptional()
  @IsString()
  organizationZip: string;

  @IsOptional()
  organizationCountryId: number;

  @IsOptional()
  @IsInt()
  depositLimit: number;

  @IsOptional()
  @IsInt()
  kycFileId: number;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus;

  @IsOptional()
  @IsEnum(KycState)
  kycState: KycState;

  @IsOptional()
  @IsInt()
  mainBankDataId: number;
}
