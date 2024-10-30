import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { PaymentLinkRecipientAddressDto } from './payment-link-recipient-address.dto';

export class PaymentLinkRecipientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientAddressDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  address?: PaymentLinkRecipientAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
