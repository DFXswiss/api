import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { DfxPhoneTransform, IsDfxPhone } from 'src/subdomains/generic/user/models/user-data/is-dfx-phone.validator';

export enum RealUnitUserType {
  HUMAN = 'HUMAN',
  CORPORATION = 'CORPORATION',
}

export enum RealUnitRegistrationStatus {
  COMPLETED = 'completed',
  PENDING_REVIEW = 'pending_review',
}

export class RealUnitRegistrationResponseDto {
  @ApiProperty({ enum: RealUnitRegistrationStatus })
  status: RealUnitRegistrationStatus;
}

export enum RealUnitLanguage {
  EN = 'EN',
  DE = 'DE',
  FR = 'FR',
  IT = 'IT',
}

export class CountryAndTin {
  @ApiProperty({ description: '2-letter country code' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' })
  country: string;

  @ApiProperty({ description: 'Tax identification number' })
  @IsNotEmpty()
  @IsString()
  tin: string;
}

export class RealUnitRegistrationDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  @Transform(Util.trim)
  email: string;

  @ApiProperty({ description: 'Full name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  name: string;

  @ApiProperty({ enum: RealUnitUserType })
  @IsNotEmpty()
  @IsEnum(RealUnitUserType)
  type: RealUnitUserType;

  @ApiProperty({ description: 'Phone number in international format (e.g. +41...)' })
  @IsNotEmpty()
  @IsString()
  @IsDfxPhone()
  @Transform(DfxPhoneTransform)
  phoneNumber: string;

  @ApiProperty({ description: 'Birthday in yyyy-mm-dd format' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthday must be in yyyy-mm-dd format' })
  birthday: string;

  @ApiProperty({ description: '2-letter country code (e.g. CH, DE)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'nationality must be a 2-letter country code' })
  @Transform(Util.trim)
  nationality: string;

  @ApiProperty({ description: 'Street address including house number' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  addressStreet: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  addressPostalCode: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  addressCity: string;

  @ApiProperty({ description: '2-letter country code (e.g. CH, DE)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'addressCountry must be a 2-letter country code' })
  @Transform(Util.trim)
  addressCountry: string;

  @ApiProperty({ description: 'Whether the user has Swiss tax residence' })
  @IsNotEmpty()
  @IsBoolean()
  swissTaxResidence: boolean;

  @ApiProperty({ description: 'Registration date in yyyy-mm-dd format' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'registrationDate must be in yyyy-mm-dd format' })
  registrationDate: string;

  @ApiProperty({ description: 'Ethereum wallet address (0x...)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'walletAddress must be a valid Ethereum address' })
  walletAddress: string;

  @ApiProperty({ description: 'EIP-712 signature of the registration data' })
  @IsNotEmpty()
  @IsString()
  signature: string;

  @ApiProperty({ enum: RealUnitLanguage })
  @IsNotEmpty()
  @IsEnum(RealUnitLanguage)
  lang: RealUnitLanguage;

  @ApiProperty({ description: 'First name (not signed, must combine with surname to match signed name)' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  firstname: string;

  @ApiProperty({ description: 'Surname (not signed, must combine with firstname to match signed name)' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  surname: string;

  @ApiProperty({ description: 'Street name (not signed, must combine with houseNumber to match signed addressStreet)' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  street: string;

  @ApiPropertyOptional({ description: 'House number (not signed, must combine with street to match signed addressStreet). Can be empty.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  houseNumber?: string;

  @ApiProperty({ enum: AccountType, description: 'Account type (not signed). HUMAN requires Personal/SoleProprietorship, CORPORATION requires Organization.' })
  @IsNotEmpty()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional({ type: [CountryAndTin], description: 'Required if swissTaxResidence is false' })
  @ValidateIf((o: RealUnitRegistrationDto) => !o.swissTaxResidence)
  @IsNotEmpty({ message: 'countryAndTINs is required when swissTaxResidence is false' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountryAndTin)
  countryAndTINs?: CountryAndTin[];

  // --- Organization fields (required if accountType is ORGANIZATION) ---

  @ApiPropertyOptional({ description: 'Organization name. Required if accountType is ORGANIZATION.' })
  @ValidateIf((o: RealUnitRegistrationDto) => o.accountType === AccountType.ORGANIZATION)
  @IsNotEmpty({ message: 'organizationName is required for ORGANIZATION accounts' })
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  organizationName?: string;

  @ApiPropertyOptional({ description: 'Organization street. Required if accountType is ORGANIZATION.' })
  @ValidateIf((o: RealUnitRegistrationDto) => o.accountType === AccountType.ORGANIZATION)
  @IsNotEmpty({ message: 'organizationStreet is required for ORGANIZATION accounts' })
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  organizationStreet?: string;

  @ApiPropertyOptional({ description: 'Organization house number. Can be empty.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  organizationHouseNumber?: string;

  @ApiPropertyOptional({ description: 'Organization city/location. Required if accountType is ORGANIZATION.' })
  @ValidateIf((o: RealUnitRegistrationDto) => o.accountType === AccountType.ORGANIZATION)
  @IsNotEmpty({ message: 'organizationLocation is required for ORGANIZATION accounts' })
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  organizationLocation?: string;

  @ApiPropertyOptional({ description: 'Organization postal code. Required if accountType is ORGANIZATION.' })
  @ValidateIf((o: RealUnitRegistrationDto) => o.accountType === AccountType.ORGANIZATION)
  @IsNotEmpty({ message: 'organizationZip is required for ORGANIZATION accounts' })
  @IsString()
  @MaxLength(256)
  @Transform(Util.sanitize)
  organizationZip?: string;

  @ApiPropertyOptional({ description: '2-letter country code for organization. Required if accountType is ORGANIZATION.' })
  @ValidateIf((o: RealUnitRegistrationDto) => o.accountType === AccountType.ORGANIZATION)
  @IsNotEmpty({ message: 'organizationCountry is required for ORGANIZATION accounts' })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'organizationCountry must be a 2-letter country code' })
  @Transform(Util.trim)
  organizationCountry?: string;
}
