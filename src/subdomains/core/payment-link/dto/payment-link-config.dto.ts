import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentLinkRecipientDto } from './payment-link-recipient.dto';

export class UpdatePaymentLinkConfigDto {
  @ApiPropertyOptional({ enum: PaymentStandard, isArray: true })
  @IsOptional()
  @IsEnum(PaymentStandard, { each: true })
  standards?: PaymentStandard[];

  @ApiPropertyOptional({ enum: PaymentLinkBlockchains, isArray: true })
  @IsOptional()
  @IsIn(PaymentLinkBlockchains, { each: true })
  blockchains?: Blockchain[];

  @ApiPropertyOptional({ enum: PaymentQuoteStatus })
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
  scanTimeout?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  paymentTimeout?: number;
}

export class PaymentLinkConfigDto extends UpdatePaymentLinkConfigDto {
  @ApiPropertyOptional()
  fee?: number;
}

export class UserPaymentLinkConfigDto extends PaymentLinkConfigDto {
  @ApiPropertyOptional()
  accessKey: string;
}
