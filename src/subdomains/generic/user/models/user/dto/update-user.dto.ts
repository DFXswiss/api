import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Util } from 'src/shared/utils/util';
import { DfxPhoneTransform, IsDfxPhone } from '../../user-data/is-dfx-phone.validator';
import { PhoneCallPreferredTime } from '../../user-data/user-data.enum';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsDfxPhone()
  @Transform(DfxPhoneTransform)
  phone?: string;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  language?: Language;

  @ApiPropertyOptional({ type: EntityDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency?: Fiat;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsEnum(PhoneCallPreferredTime)
  preferredTimes?: PhoneCallPreferredTime[];

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((a: UpdateUserDto) => Boolean(a.rejectCall || !a.repeatCall))
  @IsBoolean()
  rejectCall?: boolean;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((a: UpdateUserDto) => Boolean(a.repeatCall || !a.rejectCall))
  @IsBoolean()
  repeatCall?: boolean;
}

export class UpdateUserMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  @Transform(Util.toLowerCaseTrim)
  mail: string;
}
