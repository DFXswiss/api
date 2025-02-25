import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { DfxPhoneTransform, IsDfxPhone } from 'src/subdomains/generic/user/models/user-data/is-dfx-phone.validator';
import { PaymentLinkRecipientAddressDto } from './payment-link-recipient-address.dto';

export class PaymentLinkRecipientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  name?: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientAddressDto })
  @IsOptional()
  @Type(() => PaymentLinkRecipientAddressDto)
  @ValidateNested()
  address?: PaymentLinkRecipientAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsDfxPhone()
  @Transform(DfxPhoneTransform)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;
}
