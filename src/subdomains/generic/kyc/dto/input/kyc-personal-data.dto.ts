import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { IsDfxPhone } from '../../../user/models/user-data/is-dfx-phone.validator';

export class KycPersonalData {
  @ApiProperty({ enum: AccountType })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  houseNumber?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  zip: string;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country: Country;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxPhone()
  @Transform(Util.trim)
  phone: string;

  @ApiProperty()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationName?: string;

  @ApiProperty()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationStreet?: string;

  @ApiProperty()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationHouseNumber?: string;

  @ApiProperty()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationLocation?: string;

  @ApiProperty()
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmpty()
  @IsString()
  organizationZip?: string;

  @ApiProperty({ type: EntityDto })
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  organizationCountry?: Country;
}
