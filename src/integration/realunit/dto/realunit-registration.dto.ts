import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsEthereumAddress,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum RealUnitUserType {
  HUMAN = 'HUMAN',
  CORPORATION = 'CORPORATION',
}

export class CountryTinDto {
  @ApiProperty({ description: 'Country code (2-letter ISO)', example: 'DE' })
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country: string;

  @ApiProperty({ description: 'Tax Identification Number', example: '12345678' })
  @IsString()
  tin: string;
}

export class RealUnitUserRegistrationDto {
  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Full name (or company name if type is CORPORATION)', example: 'Max Mustermann' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: RealUnitUserType, description: 'User type', example: 'HUMAN' })
  @IsEnum(RealUnitUserType)
  type: RealUnitUserType;

  @ApiProperty({ description: 'Phone number with country code', example: '+41791234567' })
  @IsPhoneNumber()
  phoneNumber: string;

  @ApiProperty({ description: 'Date of birth (yyyy-mm-dd)', example: '1990-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthday must be in yyyy-mm-dd format' })
  birthday: string;

  @ApiProperty({ description: 'Nationality (2-letter country code)', example: 'CH' })
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  nationality: string;

  @ApiProperty({ description: 'Street address including number', example: 'Bahnhofstrasse 1' })
  @IsString()
  addressStreet: string;

  @ApiProperty({ description: 'Postal code', example: '8001' })
  @IsString()
  addressPostalCode: string;

  @ApiProperty({ description: 'City', example: 'Zürich' })
  @IsString()
  addressCity: string;

  @ApiProperty({ description: 'Country (2-letter country code)', example: 'CH' })
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  addressCountry: string;

  @ApiProperty({ description: 'Whether Switzerland is the only tax residence', example: true })
  @IsBoolean()
  swissTaxResidence: boolean;

  @ApiProperty({ description: 'Registration date (yyyy-mm-dd)', example: '2025-12-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'registrationDate must be in yyyy-mm-dd format' })
  registrationDate: string;

  @ApiProperty({ description: 'Ethereum wallet address', example: '0x1234567890abcdef1234567890abcdef12345678' })
  @IsEthereumAddress()
  walletAddress: string;

  @ApiProperty({ description: 'EIP-712 signature of the user data', example: '0x...' })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{130}$/, { message: 'signature must be a valid Ethereum signature' })
  signature: string;

  @ApiPropertyOptional({
    type: [CountryTinDto],
    description: 'Country and TIN pairs (required if swissTaxResidence is false)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountryTinDto)
  countryAndTINs?: CountryTinDto[];
}

export class RealUnitRegistrationResponseDto {
  @ApiProperty({ description: 'Whether the registration was successful' })
  success: boolean;

  @ApiPropertyOptional({ description: 'Registration ID from Aktionariat' })
  registrationId?: string;

  @ApiPropertyOptional({ description: 'Error message if registration failed' })
  error?: string;
}
