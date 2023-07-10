import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsNotEmptyObject, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { Util } from 'src/shared/utils/util';
import { AccountType } from '../../user-data/account-type.enum';
import { IsDfxPhone } from '../../user-data/is-dfx-phone.validator';

export class KycUserDataDto {
  @ApiPropertyOptional({ enum: AccountType })
  @ValidateIf((d: KycUserDataDto) => d.accountType !== undefined)
  @IsNotEmpty()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.firstname !== undefined)
  @IsNotEmpty()
  @IsString()
  firstname: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.surname !== undefined)
  @IsNotEmpty()
  @IsString()
  surname: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.street !== undefined)
  @IsNotEmpty()
  @IsString()
  street: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.houseNumber !== undefined)
  @IsNotEmpty()
  @IsString()
  houseNumber: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.location !== undefined)
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.zip !== undefined)
  @IsNotEmpty()
  @IsString()
  zip: string;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((d: KycUserDataDto) => d.country !== undefined)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country: Country;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.mail !== undefined)
  @IsNotEmpty()
  @IsEmail()
  mail: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.phone !== undefined)
  @IsNotEmpty()
  @IsString()
  @IsDfxPhone()
  @Transform(Util.trim)
  phone: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType && d.organizationName && d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationName: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType && d.organizationStreet && d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationStreet: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (d: KycUserDataDto) => d.accountType && d.organizationHouseNumber && d.accountType !== AccountType.PERSONAL,
  )
  @IsNotEmpty()
  @IsString()
  organizationHouseNumber: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType && d.organizationLocation && d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationLocation: string;

  @ApiPropertyOptional()
  @ValidateIf((d: KycUserDataDto) => d.accountType && d.organizationZip && d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationZip: string;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((d: KycUserDataDto) => d.accountType && d.organizationCountry && d.accountType !== AccountType.PERSONAL)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  organizationCountry: Country;
}
