import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  @Transform(Util.trim)
  street: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  houseNumber?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  city: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
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
  @Transform(Util.trim)
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
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
  @Transform(Util.trim)
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
