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

export class KycAddress {
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
  city: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
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
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  lastName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxPhone()
  @Transform(Util.trim)
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
  organizationName?: string;

  @ApiPropertyOptional({ type: KycAddress })
  @ValidateIf((d: KycPersonalData) => d.accountType !== AccountType.PERSONAL)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => KycAddress)
  organizationAddress?: KycAddress;
}
