import { IsOptional, IsInt, IsEnum, IsEmail, IsString, IsBoolean } from 'class-validator';
import { AccountType } from '../account-type.enum';
import { KycState, KycStatus } from '../user-data.entity';

export class UpdateUserDataDto {
  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsEmail()
  mail: string;

  @IsOptional()
  @IsString()
  phone: string;

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
  @IsInt()
  countryId: number;

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
  @IsInt()
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
  @IsBoolean()
  highRisk: boolean;

  @IsOptional()
  @IsBoolean()
  complexOrgStructure: boolean;

  @IsOptional()
  @IsInt()
  mainBankDataId: number;
}
