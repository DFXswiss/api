import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum, IsString, IsObject, ValidateIf } from 'class-validator';
import { Country } from 'src/shared/models/country/country.entity';
import { AccountType } from '../../user-data/user-data.entity';

export class IdentUserDataDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  firstname: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  surname: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  street: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  houseNumber: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  zip: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsObject()
  country: Country;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationName: string;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationStreet: string;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationHouseNumber: string;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationLocation: string;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationZip: string;

  @ApiPropertyOptional()
  @ValidateIf((d: IdentUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsObject()
  organizationCountry: Country;
}
