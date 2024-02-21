import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { AccountType } from '../account-type.enum';
import { IsDfxPhone } from '../is-dfx-phone.validator';
import { KycIdentificationType, KycLevel, KycStatus, UserData, UserDataStatus } from '../user-data.entity';

export class UpdateUserDataDto {
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @IsOptional()
  @IsEmail()
  mail?: string;

  @IsOptional()
  @IsString()
  @IsDfxPhone()
  @Transform(Util.trim)
  phone?: string;

  @IsOptional()
  @IsString()
  firstname?: string;

  @IsOptional()
  @IsString()
  surname?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  houseNumber?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsInt()
  countryId?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  birthday?: Date;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  language?: Language;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency?: Fiat;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  nationality?: Country;

  @IsOptional()
  @IsString()
  organizationName?: string;

  @IsOptional()
  @IsString()
  organizationStreet?: string;

  @IsOptional()
  @IsString()
  organizationHouseNumber?: string;

  @IsOptional()
  @IsString()
  organizationLocation?: string;

  @IsOptional()
  @IsString()
  organizationZip?: string;

  @IsOptional()
  @IsInt()
  organizationCountryId?: number;

  @IsOptional()
  @IsInt()
  depositLimit?: number;

  @IsOptional()
  @IsInt()
  kycFileId?: number;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @IsOptional()
  @IsInt()
  kycLevel?: KycLevel;

  @IsOptional()
  @IsBoolean()
  highRisk?: boolean;

  @IsOptional()
  @IsBoolean()
  complexOrgStructure?: boolean;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  letterSentDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  amlListAddedDate?: Date;

  @IsOptional()
  @IsEnum(KycIdentificationType)
  identificationType?: KycIdentificationType;

  @IsOptional()
  @IsString()
  internalAmlNote?: string;

  @IsOptional()
  @IsEnum(UserDataStatus)
  status?: UserDataStatus;

  @IsOptional()
  @IsBoolean()
  pep?: boolean;

  @IsOptional()
  @IsEnum(CheckStatus)
  bankTransactionVerification?: CheckStatus;

  @IsOptional()
  @IsString()
  amlAccountType?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  lastNameCheckDate?: Date;

  @IsOptional()
  @IsString()
  relatedUsers?: string;

  @IsOptional()
  @IsString()
  identDocumentId?: string;

  @IsOptional()
  @IsString()
  identDocumentType?: string;

  @IsOptional()
  @IsString()
  verifiedName?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  verifiedCountry?: Country;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  accountOpener?: UserData;

  @IsOptional()
  @IsString()
  accountOpenerAuthorization?: string;

  @IsOptional()
  @IsString()
  allBeneficialOwnersDomicile?: string;

  @IsOptional()
  @IsString()
  allBeneficialOwnersName?: string;

  @IsOptional()
  @IsNumber()
  totalVolumeChfAuditPeriod?: number;

  @IsOptional()
  @IsBoolean()
  olkypayAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  cryptoCryptoAllowed?: boolean;
}
