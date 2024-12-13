import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { PaymentLinkBlockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentLinkRecipientDto } from './payment-link-recipient.dto';

export class UpdatePaymentLinkConfigDto {
  @ApiPropertyOptional({ enum: PaymentStandard, isArray: true })
  @IsOptional()
  @IsEnum(PaymentStandard, { each: true })
  standards?: PaymentStandard[];

  @ApiPropertyOptional({ enum: PaymentLinkBlockchain, isArray: true })
  @IsOptional()
  @IsEnum(PaymentLinkBlockchain, { each: true })
  blockchains?: PaymentLinkBlockchain[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PaymentQuoteStatus)
  minCompletionStatus?: PaymentQuoteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  displayQr?: boolean;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  @IsOptional()
  @Type(() => PaymentLinkRecipientDto)
  @ValidateNested()
  recipient?: PaymentLinkRecipientDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  paymentTimeout?: number;
}

export class PaymentLinkConfigDto extends UpdatePaymentLinkConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee?: number;
}
