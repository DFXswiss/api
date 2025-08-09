import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, plainToInstance } from 'class-transformer';
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
  IsUrl,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { Util } from 'src/shared/utils/util';
import {
  GoodsCategory,
  GoodsType,
  MerchantCategory,
  StoreType,
} from 'src/subdomains/core/payment-link/enums/merchant.enum';
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
  @Transform(({ value }) => (value ? plainToInstance(EntityDto, { id: value.id }) : value))
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

export class KycSignatoryPowerData {
  @ApiProperty({ enum: SignatoryPower })
  @IsNotEmpty()
  @IsEnum(SignatoryPower)
  signatoryPower: SignatoryPower;
}

export class ContactPersonData extends KycAddress {
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
  isAccountHolderInvolved: boolean;

  @ApiPropertyOptional({ type: ContactPersonData })
  @ValidateIf((d: KycBeneficialData) => !d.hasBeneficialOwners && !d.isAccountHolderInvolved)
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => ContactPersonData)
  managingDirector: ContactPersonData;

  @ApiPropertyOptional({ type: ContactPersonData, isArray: true })
  @ValidateIf((d: KycBeneficialData) => d.hasBeneficialOwners && !d.isAccountHolderInvolved)
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactPersonData)
  beneficialOwners: ContactPersonData[] = [];
}

export class KycOperationalData {
  @ApiProperty({ description: 'Is the organization operationally active?' })
  @IsNotEmpty()
  @IsBoolean()
  isOperational: boolean;

  @ApiPropertyOptional({ description: 'Organization Website URL' })
  @IsOptional()
  @IsUrl()
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

export class KycLegalEntityData {
  @ApiProperty({ description: 'Base64 encoded commercial register file' })
  @IsNotEmpty()
  @IsString()
  file: string;

  @ApiProperty({ description: 'Name of the commercial register file' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  fileName: string;

  @ApiProperty({ enum: LegalEntity })
  @IsNotEmpty()
  @IsEnum(LegalEntity)
  legalEntity: LegalEntity;
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

export class PaymentDataDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  website: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  registrationNumber: string;

  @ApiProperty({ enum: StoreType })
  @IsNotEmpty()
  @IsEnum(StoreType)
  storeType: StoreType;

  @ApiProperty({ enum: MerchantCategory })
  @IsNotEmpty()
  @IsEnum(MerchantCategory)
  merchantCategory: MerchantCategory;

  @ApiProperty({ enum: GoodsType })
  @IsNotEmpty()
  @IsEnum(GoodsType)
  goodsType: GoodsType;

  @ApiProperty({ enum: GoodsCategory })
  @IsNotEmpty()
  @IsEnum(GoodsCategory)
  goodsCategory: GoodsCategory;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  purpose: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  contractAccepted: boolean;
}
