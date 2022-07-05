import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsEnum, IsString, IsObject, ValidateIf, IsNotEmptyObject, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { AccountType } from '../../user-data/account-type.enum';

export class KycUserDataDto {
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
  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country: Country;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationName: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationStreet: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationHouseNumber: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationLocation: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationZip: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  organizationCountry: Country;
}
