import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { Util } from 'src/shared/utils/util';
import { GenderType, IdentDocumentType } from 'src/subdomains/generic/kyc/dto/manual-ident-result.dto';
import { LegalEntity, SignatoryPower } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { DfxPhoneTransform, IsDfxPhone } from '../../../user/models/user-data/is-dfx-phone.validator';

export class KycContactData {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  @Transform(Util.trim)
  mail: string;
}

export class KycAddress {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  street: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  houseNumber?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  city: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  zip: string;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country: Country;
}

export class KycPersonalData {
  @ApiProperty({ enum: AccountType })
  @IsNotEmpty()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  lastName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxPhone()
  @Transform(DfxPhoneTransform)
  phone: string;

  @ApiProperty({ type: KycAddress })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => KycAddress)
  address: KycAddress;

  @ApiPropertyOptional()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  organizationName?: string;

  @ApiPropertyOptional({ type: KycAddress })
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => KycAddress)
  organizationAddress?: KycAddress;
}

export class KycInputDataDto extends KycPersonalData {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  mail: string;
}

export class KycLegalEntityData {
  @ApiProperty({ enum: LegalEntity })
  @IsNotEmpty()
  @IsEnum(LegalEntity)
  legalEntity: LegalEntity;
}

export class KycSignatoryPowerData {
  @ApiProperty({ enum: SignatoryPower })
  @IsNotEmpty()
  @IsEnum(SignatoryPower)
  signatoryPower: SignatoryPower;
}

export class BeneficialOwnerData extends KycAddress {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  lastName: string;
}

export class KycBeneficialData {
  @ApiProperty({ description: 'Are there beneficial owners with 25% or more' })
  @IsNotEmpty()
  @IsBoolean()
  hasBeneficialOwners: boolean;

  @ApiProperty({ description: 'Is the account holder a beneficial owner?' })
  @IsNotEmpty()
  @IsBoolean()
  accountHolderIsBeneficialOwner: boolean;

  @ApiPropertyOptional({ type: BeneficialOwnerData })
  @ValidateIf((d: KycBeneficialData) => !d.hasBeneficialOwners && !d.accountHolderIsBeneficialOwner)
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => BeneficialOwnerData)
  managingDirector: BeneficialOwnerData;

  @ApiPropertyOptional({ type: BeneficialOwnerData, isArray: true })
  @ValidateIf((d: KycBeneficialData) => d.hasBeneficialOwners && !d.accountHolderIsBeneficialOwner)
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BeneficialOwnerData)
  beneficialOwners: BeneficialOwnerData[] = [];
}

export class KycOperationalData {
  @ApiProperty({ description: 'Is the organization operationally active?' })
  @IsNotEmpty()
  @IsBoolean()
  isOperational: boolean;

  @ApiPropertyOptional({ description: 'Organization Website URL' })
  @IsOptional()
  @IsString()
  websiteUrl: string;
}

export class KycNationalityData {
  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  nationality: Country;
}

export class KycFileData {
  @ApiProperty({ description: 'Base64 encoded file' })
  @IsNotEmpty()
  @IsString()
  file: string;

  @ApiProperty({ description: 'Name of the file' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  fileName: string;
}

export class KycManualIdentData {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  birthName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  birthday: Date;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  nationality: Country;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  birthplace: string;

  @ApiPropertyOptional({ enum: GenderType })
  @IsOptional()
  @IsEnum(GenderType)
  gender: GenderType;

  @ApiProperty({ enum: IdentDocumentType })
  @IsNotEmpty()
  @IsEnum(IdentDocumentType)
  documentType: IdentDocumentType;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  documentNumber: string;

  @ApiProperty({ type: KycFileData })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => KycFileData)
  document: KycFileData;
}
