import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { DfxPhoneTransform, IsDfxPhone } from '../../user-data/is-dfx-phone.validator';

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
}

export class UpdateUserMailDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEmail()
  mail: string;
}
