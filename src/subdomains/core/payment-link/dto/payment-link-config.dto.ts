import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentLinkRecipientDto } from './payment-link.dto';

export class PaymentLinkConfigDto {
  @ApiPropertyOptional({ enum: PaymentStandard, isArray: true })
  @IsOptional()
  @IsArray()
  standards?: PaymentStandard[];

  @ApiPropertyOptional({ enum: Blockchain, isArray: true })
  @IsOptional()
  @IsArray()
  blockchains?: Blockchain[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PaymentQuoteStatus)
  minCompletionStatus?: PaymentQuoteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  displayQr?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  fee?: number;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  recipient?: PaymentLinkRecipientDto;

  @ApiPropertyOptional()
  @IsOptional()
  paymentTimeout?: number;
}
