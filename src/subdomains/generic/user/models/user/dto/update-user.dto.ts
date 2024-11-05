import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { PaymentLinkConfigDto } from 'src/subdomains/core/payment-link/dto/payment-link-config.dto';
import { DfxPhoneTransform, IsDfxPhone } from '../../user-data/is-dfx-phone.validator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail?: string;

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

export class UpdatePaymentLinksConfigDto {
  @ApiProperty({ type: PaymentLinkConfigDto })
  @IsNotEmpty()
  @Type(() => PaymentLinkConfigDto)
  @ValidateNested()
  config: PaymentLinkConfigDto;
}
